/*
 * calendar-sync: copies busy times from Genie's Google Calendar into public.busy_blocks.
 * Runs every 5 minutes (pg_cron), so the booking page never waits on Google.
 * Skips all-day events, "free" events, cancelled events, and invites this platform sent
 * itself (UID ends with @eugeneobo.com), since those bookings are already tracked.
 * Requires header x-cron-key matching private_settings.cron_key.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import IcalExpander from "npm:ical-expander@3.1.0";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const DAYS_AHEAD = 45;

Deno.serve(async (req) => {
  const { data: rows } = await sb.from("private_settings").select("key,value").in("key", ["cron_key", "google_ical_url"]);
  const s: Record<string, string> = {};
  (rows ?? []).forEach((r: any) => (s[r.key] = r.value));
  if (!s.cron_key || req.headers.get("x-cron-key") !== s.cron_key) return new Response("forbidden", { status: 403 });
  if (!s.google_ical_url) return new Response(JSON.stringify({ ok: false, error: "no_calendar" }), { status: 200 });

  const r = await fetch(s.google_ical_url);
  if (!r.ok) {
    console.error("ics fetch", r.status);
    return new Response(JSON.stringify({ ok: false, error: "ics_" + r.status }), { status: 502 });
  }
  const ics = await r.text();
  const from = new Date(Date.now() - 86400000);
  const to = new Date(Date.now() + DAYS_AHEAD * 86400000);
  const exp = new IcalExpander({ ics, maxIterations: 2000 });
  const { events, occurrences } = exp.between(from, to);

  const blocks: Array<{ starts_at: string; ends_at: string }> = [];
  const add = (comp: any, start: any, end: any) => {
    if (start.isDate) return;
    const transp = comp?.getFirstPropertyValue?.("transp");
    if (transp && String(transp).toUpperCase() === "TRANSPARENT") return;
    const status = comp?.getFirstPropertyValue?.("status");
    if (status && String(status).toUpperCase() === "CANCELLED") return;
    const uid = String(comp?.getFirstPropertyValue?.("uid") ?? "");
    if (uid.endsWith("@eugeneobo.com")) return;
    blocks.push({ starts_at: start.toJSDate().toISOString(), ends_at: end.toJSDate().toISOString() });
  };
  for (const e of events) add(e.component, e.startDate, e.endDate);
  for (const o of occurrences) add(o.item.component, o.startDate, o.endDate);

  // Replace the whole set. Insert first, then remove old rows, so the table is never empty mid-sync.
  const stamp = new Date().toISOString();
  const { data: before } = await sb.from("busy_blocks").select("id").order("id", { ascending: false }).limit(1);
  const maxOld = before?.[0]?.id ?? 0;
  if (blocks.length) {
    const { error } = await sb.from("busy_blocks").insert(blocks);
    if (error) { console.error(error); return new Response(JSON.stringify({ ok: false, error: "insert" }), { status: 500 }); }
  }
  await sb.from("busy_blocks").delete().lte("id", maxOld);
  await sb.from("private_settings").upsert({ key: "calendar_synced_at", value: stamp, updated_at: stamp });

  return new Response(JSON.stringify({ ok: true, blocks: blocks.length }), { headers: { "Content-Type": "application/json" } });
});
