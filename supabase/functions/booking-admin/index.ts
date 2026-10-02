/*
 * booking-admin: Genie's controls for the services site (clarity calls, mentorship,
 * waitlists, email list, hours). Uses the same admin session token as admin-api.
 *
 * POST {action, token, ...}
 *   list                                  Everything the Bookings tab shows
 *   cancel        {id, notify}            Cancel a booking; optionally email the person
 *   attend        {id, value}             "showed" | "no_show" | null
 *   grant_call    {email}                 Give someone one more free clarity call
 *   new_plan      {name, email, phone?, hours, notify}   Mentorship hours for a client you already have
 *   save_settings {genie_whatsapp?, booking_window_days?, mentorship_window_days?}
 *   save_rule     {id, start_time, end_time, active}
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });
const SITE = "https://eugeneobo.com";
const FROM = "Genie <genie@eugeneobo.com>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

/* Same token scheme as admin-api / admin-login */
const enc = new TextEncoder();
async function verifyToken(token: string) {
  if (!token || !token.includes(".")) return false;
  const [p, s] = token.split(".");
  try {
    const key = await crypto.subtle.importKey("raw", enc.encode("oiwg-admin-session:" + KEY), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("HMAC", key, Uint8Array.from(atob(s), (c) => c.charCodeAt(0)), enc.encode(p));
    if (!ok) return false;
    const payload = JSON.parse(atob(p));
    return !(payload.exp && payload.exp < Date.now() / 1000);
  } catch { return false; }
}

const OFFSET = 3600_000;
function label(ms: number) { const d = new Date(ms + OFFSET); let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2, "0"); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}:${m}${ap}`; }
function longDate(ms: number) { return new Date(ms).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" }); }
const clean = (v: unknown, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

async function sendEmail(to: string, subject: string, text: string) {
  if (!RESEND || !to) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, text }),
  });
  if (!r.ok) console.error("resend", r.status, await r.text());
  return r.ok;
}
async function settings() {
  const { data } = await sb.from("private_settings").select("key,value");
  const v: Record<string, string> = {}; (data ?? []).forEach((r: any) => (v[r.key] = r.value)); return v;
}

type P = Record<string, unknown>;

async function list() {
  const from = new Date(Date.now() - 21 * 86400000).toISOString();
  const [{ data: bookings }, { data: plans }, { data: waitlist }, { data: contacts }, { data: rules }, s] = await Promise.all([
    sb.from("slot_bookings").select("id,service,status,starts_at,ends_at,minutes,name,email,phone,phone_key,note,plan_id,attended,cancelled_by,created_at")
      .in("status", ["confirmed", "cancelled"]).gte("starts_at", from).order("starts_at"),
    sb.from("mentorship_plans").select("id,token,name,email,phone,hours,minutes_total,amount_kobo,payment_reference,created_at").eq("status", "paid").order("created_at", { ascending: false }),
    sb.from("waitlist").select("list,email,name,created_at").order("created_at", { ascending: false }),
    sb.from("contacts").select("email,name,opted_in,extra_free_calls,first_source,first_seen").order("first_seen", { ascending: false }),
    sb.from("availability_rules").select("id,service,weekday,start_time,end_time,slot_minutes,active").order("service").order("weekday"),
    settings(),
  ]);
  // minutes used per plan
  const ids = (plans ?? []).map((p: any) => p.id);
  const used: Record<string, number> = {};
  if (ids.length) {
    const { data: us } = await sb.from("slot_bookings").select("plan_id,minutes").in("plan_id", ids).in("status", ["held", "confirmed"]);
    (us ?? []).forEach((r: any) => (used[r.plan_id] = (used[r.plan_id] ?? 0) + (r.minutes ?? 60)));
  }
  // how many free calls each person has ever had (to flag repeat bookers)
  const { data: allFree } = await sb.from("slot_bookings").select("name,email,phone_key").eq("service", "free_call").eq("status", "confirmed");
  const norm = (n: string) => (n || "").toLowerCase().replace(/[^a-z]/g, "");
  const byName: Record<string, number> = {};
  (allFree ?? []).forEach((r: any) => { const k = norm(r.name); if (k) byName[k] = (byName[k] ?? 0) + 1; });
  return {
    ok: true,
    now: new Date().toISOString(),
    bookings: (bookings ?? []).map((b: any) => {
      const t = Date.parse(b.starts_at);
      return { ...b, date: longDate(t), label: label(t), same_name: b.service === "free_call" && b.status === "confirmed" ? (byName[norm(b.name)] ?? 0) : 0 };
    }),
    plans: (plans ?? []).map((p: any) => ({ ...p, minutes_used: used[p.id] ?? 0, link: `${SITE}/book?plan=${p.token}`, manual: String(p.payment_reference || "").startsWith("MANUAL_") })),
    waitlist: waitlist ?? [],
    contacts: contacts ?? [],
    rules: rules ?? [],
    settings: {
      genie_whatsapp: s.genie_whatsapp ?? "", booking_window_days: s.booking_window_days ?? "3",
      mentorship_window_days: s.mentorship_window_days ?? "30", notify_email: s.notify_email ?? "",
      calendar_synced_at: s.calendar_synced_at ?? "",
    },
  };
}

async function cancel(p: P) {
  const id = clean(p.id, 60);
  const { data: b } = await sb.from("slot_bookings").select("*").eq("id", id).maybeSingle();
  if (!b) return { ok: false, error: "not_found" };
  if (b.status === "cancelled") return { ok: true, already: true };
  await sb.from("slot_bookings").update({ status: "cancelled", cancelled_by: "genie", updated_at: new Date().toISOString() }).eq("id", id);
  let emailed = false;
  if (p.notify === true && b.email) {
    const t = Date.parse(b.starts_at), first = (b.name || "there").split(" ")[0];
    const what = b.service === "free_call" ? "clarity call" : "mentorship session";
    const tail = b.service === "free_call"
      ? `If you'd still like to talk, you can pick another time here: ${SITE}/book#call`
      : `The time is back on your plan. Pick a new time whenever you're ready.`;
    emailed = await sendEmail(b.email, `Your ${what} on ${longDate(t)} is cancelled`,
      `Hi ${first},\n\nYour ${what} on ${longDate(t)} at ${label(t)} (Lagos time) has been cancelled.\n\n${tail}\n\nGenie`);
  }
  return { ok: true, emailed };
}

async function attend(p: P) {
  const id = clean(p.id, 60);
  const v = p.value === "showed" || p.value === "no_show" ? p.value : null;
  const { error } = await sb.from("slot_bookings").update({ attended: v }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

async function grantCall(p: P) {
  const email = clean(p.email, 120).toLowerCase();
  if (!validEmail(email)) return { ok: false, error: "bad_email" };
  const { data: c } = await sb.from("contacts").select("email,extra_free_calls").eq("email", email).maybeSingle();
  const n = ((c as any)?.extra_free_calls ?? 0) + 1;
  if (c) await sb.from("contacts").update({ extra_free_calls: n }).eq("email", email);
  else await sb.from("contacts").insert({ email, name: clean(p.name, 80) || null, first_source: "granted", last_source: "granted", opted_in: false, extra_free_calls: n });
  return { ok: true, extra_free_calls: n };
}

async function newPlan(p: P) {
  const name = clean(p.name, 80), email = clean(p.email, 120).toLowerCase(), phone = clean(p.phone, 30);
  const hours = Math.round(Number(p.hours) * 2) / 2;
  if (!name) return { ok: false, error: "missing_name" };
  if (!validEmail(email)) return { ok: false, error: "bad_email" };
  if (!(hours >= 0.5 && hours <= 40)) return { ok: false, error: "bad_hours" };
  const { data: plan, error } = await sb.from("mentorship_plans").insert({
    name, email, phone: phone || null, hours: Math.ceil(hours), minutes_total: Math.round(hours * 60),
    amount_kobo: Math.max(0, Math.round(Number(p.amount_naira || 0) * 100)), payment_reference: "MANUAL_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), status: "paid",
  }).select().single();
  if (error) return { ok: false, error: error.message };
  const link = `${SITE}/book?plan=${plan.token}`;
  let emailed = false;
  if (p.notify === true) {
    const first = name.split(" ")[0];
    const mins = Math.round(hours * 60), hrs = mins % 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins / 60} hour${mins > 60 ? "s" : ""}`;
    emailed = await sendEmail(email, "Your mentorship sessions with Genie",
      `Hi ${first},\n\nYou have ${hrs} of mentorship with me. Pick your sessions here, whenever suits you:\n${link}\n\nKeep that link. It's how you book, see and move your sessions.\n\nGenie`);
  }
  return { ok: true, link, emailed };
}

async function saveSettings(p: P) {
  const out: Array<{ key: string; value: string; updated_at: string }> = [], now = new Date().toISOString();
  if (typeof p.genie_whatsapp === "string") out.push({ key: "genie_whatsapp", value: clean(p.genie_whatsapp, 40), updated_at: now });
  for (const k of ["booking_window_days", "mentorship_window_days"]) {
    if (p[k] === undefined) continue;
    const n = Math.round(Number(p[k]));
    if (!(n >= 1 && n <= 60)) return { ok: false, error: "bad_" + k };
    out.push({ key: k, value: String(n), updated_at: now });
  }
  if (out.length) await sb.from("private_settings").upsert(out);
  return { ok: true };
}

async function saveRule(p: P) {
  const id = clean(p.id, 60);
  const re = /^\d{2}:\d{2}$/;
  const st = clean(p.start_time, 5), en = clean(p.end_time, 5);
  if (!re.test(st) || !re.test(en) || st >= en) return { ok: false, error: "bad_time" };
  const { error } = await sb.from("availability_rules").update({ start_time: st, end_time: en, active: p.active === true }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

async function addRule(p: P) {
  const service = p.service === "mentorship" ? "mentorship" : "free_call";
  const weekday = Math.round(Number(p.weekday));
  if (!(weekday >= 0 && weekday <= 6)) return { ok: false, error: "bad_day" };
  const { data: ex } = await sb.from("availability_rules").select("id").eq("service", service).eq("weekday", weekday).maybeSingle();
  if (ex) return { ok: false, error: "exists" };
  const { error } = await sb.from("availability_rules").insert({ service, weekday, start_time: service === "free_call" ? "09:00" : "16:00", end_time: service === "free_call" ? "10:00" : "19:00", slot_minutes: service === "free_call" ? 10 : 30, active: false });
  return error ? { ok: false, error: error.message } : { ok: true };
}

const ACTIONS: Record<string, (p: P) => Promise<P>> = {
  list, cancel, attend, grant_call: grantCall, new_plan: newPlan, save_settings: saveSettings, save_rule: saveRule, add_rule: addRule,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({})) as P;
  if (!(await verifyToken(String(body.token ?? "")))) return json({ ok: false, error: "invalid_or_expired_token" }, 401);
  const h = ACTIONS[String(body.action ?? "")];
  if (!h) return json({ ok: false, error: "unknown_action" }, 400);
  try { const r = await h(body); return json(r, r.ok ? 200 : 400); }
  catch (e) { console.error(e); return json({ ok: false, error: "server_error" }, 500); }
});
