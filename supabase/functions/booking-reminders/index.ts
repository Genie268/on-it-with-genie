/*
 * booking-reminders: emails people before their call.
 * Runs every minute (pg_cron). For each confirmed booking:
 *   - 30 minutes before: "In 30 minutes"
 *   - 10 minutes before: "In 10 minutes"
 *   - at the start time:  "I'm on the call now"
 * Each reminder is sent once. Someone who books late only gets the reminders still ahead of them.
 * Requires header x-cron-key matching private_settings.cron_key.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "Genie <genie@eugeneobo.com>";
const OFFSET_MS = 60 * 60 * 1000; // Lagos

function label(ms: number) {
  const d = new Date(ms + OFFSET_MS);
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m}${ap}`;
}

async function send(to: string, subject: string, text: string) {
  if (!RESEND) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, text }),
  });
  if (!r.ok) console.error("resend", r.status, await r.text());
  return r.ok;
}

function copy(kind: "30" | "10" | "live", b: any, meet: string) {
  const first = (b.name || "there").split(" ")[0];
  const at = label(Date.parse(b.starts_at));
  const what = b.service === "free_call" ? "video call" : "mentorship session";
  const link = meet || "the link in your confirmation email";
  if (kind === "30") return {
    subject: `In 30 minutes: your ${what} with Genie`,
    text: `Hi ${first},\n\nYour ${what} with me starts at ${at} (Lagos time).\n\nJoin here: ${link}\n\nFind a quiet spot and have your camera ready.\n\nGenie`,
  };
  if (kind === "10") return {
    subject: `10 minutes: your ${what} with Genie`,
    text: `Hi ${first},\n\nWe start at ${at}.\n\nJoin here: ${link}\n\nJoin a minute early and I'll let you in.\n\nGenie`,
  };
  return {
    subject: `I'm on the call now`,
    text: `Hi ${first},\n\nI'm ready for you. Join now: ${link}\n\nGenie`,
  };
}

Deno.serve(async (req) => {
  const { data: rows } = await sb.from("private_settings").select("key,value").in("key", ["cron_key", "meet_link"]);
  const s: Record<string, string> = {};
  (rows ?? []).forEach((r: any) => (s[r.key] = r.value));
  if (!s.cron_key || req.headers.get("x-cron-key") !== s.cron_key) return new Response("forbidden", { status: 403 });

  const now = Date.now();
  const { data: due } = await sb.from("slot_bookings")
    .select("id,service,name,email,starts_at,reminded_30,reminded_10,reminded_live")
    .eq("status", "confirmed")
    .gte("starts_at", new Date(now - 5 * 60_000).toISOString())
    .lte("starts_at", new Date(now + 31 * 60_000).toISOString());

  let sent = 0;
  for (const b of due ?? []) {
    const mins = (Date.parse(b.starts_at) - now) / 60_000;
    let kind: "30" | "10" | "live" | null = null;
    const patch: Record<string, string> = {};
    const stamp = new Date().toISOString();
    if (mins <= 0.5 && !b.reminded_live) {
      kind = "live"; patch.reminded_live = stamp; patch.reminded_10 = b.reminded_10 ?? stamp; patch.reminded_30 = b.reminded_30 ?? stamp;
    } else if (mins > 0.5 && mins <= 10 && !b.reminded_10) {
      kind = "10"; patch.reminded_10 = stamp; patch.reminded_30 = b.reminded_30 ?? stamp;
    } else if (mins > 10 && mins <= 30 && !b.reminded_30) {
      kind = "30"; patch.reminded_30 = stamp;
    }
    if (!kind) continue;
    // Claim the reminder first so an overlapping run can't send it twice
    const col = kind === "live" ? "reminded_live" : kind === "10" ? "reminded_10" : "reminded_30";
    const { data: claimed } = await sb.from("slot_bookings").update(patch).eq("id", b.id).is(col, null).select("id");
    if (!claimed || !claimed.length) continue;
    const c = copy(kind, b, s.meet_link || "");
    if (await send(b.email, c.subject, c.text)) sent++;
  }
  return new Response(JSON.stringify({ ok: true, checked: (due ?? []).length, sent }), { headers: { "Content-Type": "application/json" } });
});
