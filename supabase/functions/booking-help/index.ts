/*
 * booking-help: "Already booked? Change your time" on the site.
 *
 * POST {action:"find_plan", email}
 *   If that email has paid coaching, emails them their private plan link (where they see,
 *   move and book sessions). Always answers ok, so nobody can check which emails have bookings.
 *   One email per plan every 10 minutes at most.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "Genie <genie@eugeneobo.com>";
const SITE = "https://eugeneobo.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const OFFSET = 3600_000;
function when(ms: number) {
  const d = new Date(ms + OFFSET); let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12;
  return `${new Date(ms).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" })}, ${h}:${m}${ap}`;
}

async function findPlan(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ ok: false, error: "bad_email" }, 400);
  const { data: plans } = await sb.from("mentorship_plans").select("id,token,name,link_sent_at,created_at").eq("email", email).eq("status", "paid").order("created_at", { ascending: false }).limit(5);
  const fresh = (plans ?? []).filter((p: any) => !p.link_sent_at || Date.parse(p.link_sent_at) < Date.now() - 10 * 60_000);
  if (!fresh.length || !RESEND) return json({ ok: true });
  const { data: sess } = await sb.from("slot_bookings").select("plan_id,starts_at").in("plan_id", fresh.map((p: any) => p.id)).eq("status", "confirmed").gte("starts_at", new Date().toISOString()).order("starts_at");
  const first = String(fresh[0].name || "there").trim().split(" ")[0];
  const blocks = fresh.map((p: any) => {
    const up = (sess ?? []).filter((s: any) => s.plan_id === p.id).map((s: any) => `- ${when(Date.parse(s.starts_at))}`);
    return `${up.length ? `Coming up:\n${up.join("\n")}\n` : "No sessions booked right now.\n"}Your link: ${SITE}/book?plan=${p.token}`;
  }).join("\n\n");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: email, subject: "Your coaching link", text:
      `Hi ${first},\n\nHere's your coaching link. Open it to see your sessions, change a time or book the rest of your hours.\n\n${blocks}\n\nTo change a time, tap "Change time" next to the session, then pick a new one. You can do this up to 24 hours before. If it's less than 24 hours away, reply to this email.\n\nGenie` }),
  });
  if (r.ok) await sb.from("mentorship_plans").update({ link_sent_at: new Date().toISOString() }).in("id", fresh.map((p: any) => p.id));
  else console.error("resend", r.status, await r.text());
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const p = await req.json().catch(() => ({}));
    if (p.action === "find_plan") return await findPlan(String(p.email ?? "").trim().toLowerCase().slice(0, 120));
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) { console.error(e); return json({ ok: false, error: "server_error" }, 500); }
});
