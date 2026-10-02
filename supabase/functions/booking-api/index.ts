/*
 * booking-api: live booking for clarity calls and mentorship.
 *
 * GET  ?service=free_call|mentorship[&minutes=60]
 *      Open and taken start times. Built from availability_rules, minus booked slots, minus
 *      busy_blocks (Genie's Google Calendar, synced every 5 minutes by calendar-sync).
 *      Mentorship takes a session length; a start is open only if the whole session fits.
 *
 * Clarity call
 *   POST {action:"book", service:"free_call", start, name, email, phone, note?, opt_in?}
 *   POST {action:"check", email, phone?}          Has this person already used their clarity call?
 *   POST {action:"cancel", token}                 Cancel from the email link (frees the call again).
 *
 * Mentorship (buy hours, book sessions whenever)
 *   POST {action:"hold", service:"mentorship", hours, sessions:[{start,minutes}], name, email, phone?, note?, opt_in?}
 *        Holds every chosen session for 15 minutes (any number, any days, as long as they fit the hours),
 *        creates a pending plan and returns a Paystack reference.
 *   POST {action:"confirm", reference}            Verifies payment, marks the plan paid, confirms its sessions.
 *   POST {action:"release", reference}            Frees a hold when the payment window is closed.
 *   POST {action:"plan", token}                   Hours left and upcoming sessions.
 *   POST {action:"book_sessions", token, sessions:[{start,minutes}]}   Book any number of sessions from what's left.
 *   POST {action:"cancel_session", token, id}     Allowed up to 24 hours before; the time goes back on the plan.
 *
 * Other
 *   POST {action:"subscribe", email, name?, source}   Waitlists (event, courses) and email list.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, PAYSTACK_SECRET_KEY
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const PAYSTACK = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

const TZ_OFFSET = "+01:00"; // Africa/Lagos, no daylight saving
const OFFSET_MS = 60 * 60 * 1000;
const HOUR_RATE_NAIRA = 25000;
const HOLD_MINUTES = 15;
const LEAD_MINUTES: Record<string, number> = { free_call: 10, mentorship: 120 };
const SESSION_LENGTHS = [30, 60, 90, 120];
const PLAN_HOURS = [1, 2, 4, 8];
const CANCEL_NOTICE_H = 24;
const SITE = "https://eugeneobo.com";
const FROM = "Genie <genie@eugeneobo.com>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });

/* ---------- settings ---------- */
let settingsCache: { at: number; v: Record<string, string> } | null = null;
async function settings() {
  if (settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.v;
  const { data } = await sb.from("private_settings").select("key,value");
  const v: Record<string, string> = {};
  (data ?? []).forEach((r: { key: string; value: string }) => (v[r.key] = r.value));
  settingsCache = { at: Date.now(), v };
  return v;
}
async function windowDays(service: string) {
  const s = await settings();
  const raw = service === "mentorship" ? s.mentorship_window_days : s.booking_window_days;
  const n = Number(raw);
  const fallback = service === "mentorship" ? 30 : 3;
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 60) : fallback;
}

/* ---------- helpers ---------- */
function lagosDate(ms: number) { return new Date(ms + OFFSET_MS).toISOString().slice(0, 10); }
function lagosWeekday(dateStr: string) { return new Date(dateStr + "T12:00:00Z").getUTCDay(); }
function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function label(ms: number) {
  const d = new Date(ms + OFFSET_MS);
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m}${ap}`;
}
function longDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" });
}
function mins(n: number) {
  if (n < 60) return `${n} minutes`;
  const h = Math.floor(n / 60), r = n % 60;
  return r ? `${h}h ${r}m` : `${h} hour${h > 1 ? "s" : ""}`;
}
const clean = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
/* Same number however it's typed: 0803..., +234803..., 234 803 ... all become 8031234567 */
function phoneKey(raw: string) {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length < 7) return "";
  return d.length > 10 ? d.slice(-10) : d.replace(/^0/, "");
}

async function freeCallEligible(email: string, pk: string) {
  const { data: c } = await sb.from("contacts").select("extra_free_calls").eq("email", email).maybeSingle();
  const allowed = 1 + ((c as any)?.extra_free_calls ?? 0);
  const ids = new Set<string>();
  const { data: byEmail } = await sb.from("slot_bookings").select("id").eq("service", "free_call").eq("status", "confirmed").eq("email", email);
  (byEmail ?? []).forEach((r: any) => ids.add(r.id));
  if (pk) {
    const { data: byPhone } = await sb.from("slot_bookings").select("id").eq("service", "free_call").eq("status", "confirmed").eq("phone_key", pk);
    (byPhone ?? []).forEach((r: any) => ids.add(r.id));
  }
  return ids.size < allowed;
}

async function expireHolds() {
  await sb.from("slot_bookings").update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("status", "held").lt("hold_expires_at", new Date().toISOString());
}

type Rule = { service: string; weekday: number; start_time: string; end_time: string; slot_minutes: number };
async function rulesFor(service: string): Promise<Rule[]> {
  const { data } = await sb.from("availability_rules").select("service,weekday,start_time,end_time,slot_minutes").eq("service", service).eq("active", true);
  return (data ?? []) as Rule[];
}
async function takenRanges(fromMs: number, toMs: number): Promise<Array<[number, number]>> {
  const fromIso = new Date(fromMs).toISOString(), toIso = new Date(toMs).toISOString();
  const [{ data: booked }, { data: busy }] = await Promise.all([
    sb.from("slot_bookings").select("starts_at,ends_at").in("status", ["held", "confirmed"]).gte("ends_at", fromIso).lte("starts_at", toIso),
    sb.from("busy_blocks").select("starts_at,ends_at").gte("ends_at", fromIso).lte("starts_at", toIso),
  ]);
  return [...(booked ?? []), ...(busy ?? [])].map((b: any) => [Date.parse(b.starts_at), Date.parse(b.ends_at)] as [number, number]);
}
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm.slice(0, 5)}:00${TZ_OFFSET}`).getTime();

function sessionLength(service: string, raw: unknown) {
  if (service === "free_call") return 10;
  const n = Number(raw);
  return SESSION_LENGTHS.includes(n) ? n : 60;
}

/*
 * Clarity calls: show today plus the next few days (booking_window_days). If calls fill up so
 * fewer than that many days still have space, keep opening the next days until enough do,
 * never more than FREE_CALL_MAX_DAYS out. Mentorship: a fixed window (mentorship_window_days).
 */
const FREE_CALL_MAX_DAYS = 14;
async function buildSlots(service: string, minutes: number) {
  await expireHolds();
  const rules = await rulesFor(service);
  const base = await windowDays(service);
  const maxDays = service === "free_call" ? Math.max(base, FREE_CALL_MAX_DAYS) : base;
  const now = Date.now();
  const today = lagosDate(now);
  const fromMs = at(today, "00:00");
  const toMs = at(addDays(today, maxDays), "23:59");
  const taken = await takenRanges(fromMs, toMs);
  const overlaps = (a: number, b: number) => taken.some(([s, e]) => a < e && b > s);
  const lead = (LEAD_MINUTES[service] ?? 10) * 60_000;
  const dur = minutes * 60_000;

  const out: Array<{ date: string; slots: Array<{ start: string; label: string; open: boolean }> }> = [];
  let openDays = 0, last = base;
  for (let i = 0; i <= maxDays; i++) {
    if (i > base && openDays >= base) break; // enough days with space; stop extending
    const date = addDays(today, i);
    const wd = lagosWeekday(date);
    const slots: Array<{ start: string; label: string; open: boolean }> = [];
    for (const r of rules.filter((x) => x.weekday === wd)) {
      const end = at(date, r.end_time);
      const step = r.slot_minutes * 60_000;
      for (let t = at(date, r.start_time); t + dur <= end; t += step) {
        if (t < now + lead) continue;
        slots.push({ start: new Date(t).toISOString(), label: label(t), open: !overlaps(t, t + dur) });
      }
    }
    slots.sort((a, b) => a.start.localeCompare(b.start));
    if (slots.length) out.push({ date, slots });
    if (slots.some((x) => x.open)) openDays++;
    last = i;
  }
  return { days: out, window_days: Math.max(base, last) };
}

/* Is this exact start a real, open slot for a session of this length? */
async function validateSlot(service: string, startIso: string, minutes: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = Date.parse(startIso);
  if (!Number.isFinite(t)) return { ok: false, error: "bad_time" };
  if (t < Date.now() + (LEAD_MINUTES[service] ?? 10) * 60_000) return { ok: false, error: "too_soon" };
  const date = lagosDate(t);
  const reach = service === "free_call" ? (await buildSlots(service, minutes)).window_days : await windowDays(service);
  if (date > addDays(lagosDate(Date.now()), reach)) return { ok: false, error: "too_far" };
  const dur = minutes * 60_000;
  const rules = (await rulesFor(service)).filter((r) => r.weekday === lagosWeekday(date));
  for (const r of rules) {
    const s = at(date, r.start_time), e = at(date, r.end_time), step = r.slot_minutes * 60_000;
    if (t >= s && t + dur <= e && (t - s) % step === 0) {
      const taken = await takenRanges(t - 86400000, t + 86400000);
      if (taken.some(([bs, be]) => t < be && t + dur > bs)) return { ok: false, error: "slot_taken" };
      return { ok: true };
    }
  }
  return { ok: false, error: "not_a_slot" };
}

async function upsertContact(email: string, name: string, phone: string, source: string, optIn: boolean) {
  const key = email.toLowerCase();
  const nowIso = new Date().toISOString();
  const { data: existing } = await sb.from("contacts").select("email,opted_in").eq("email", key).maybeSingle();
  if (existing) {
    const patch: Record<string, unknown> = { last_source: source, last_seen: nowIso };
    if (name) patch.name = name;
    if (phone) patch.phone = phone;
    if (optIn && !existing.opted_in) { patch.opted_in = true; patch.opted_in_at = nowIso; }
    await sb.from("contacts").update(patch).eq("email", key);
  } else {
    await sb.from("contacts").insert({
      email: key, name, phone: phone || null, first_source: source, last_source: source,
      opted_in: optIn, opted_in_at: optIn ? nowIso : null,
    });
  }
}

/* ---------- plans ---------- */
async function planUsage(planId: string) {
  const { data } = await sb.from("slot_bookings").select("id,starts_at,ends_at,minutes,status")
    .eq("plan_id", planId).in("status", ["held", "confirmed"]).order("starts_at");
  const used = (data ?? []).reduce((a: number, b: any) => a + (b.minutes ?? Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000)), 0);
  return { used, sessions: data ?? [] };
}
async function planByToken(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data } = await sb.from("mentorship_plans").select("*").eq("token", token).eq("status", "paid").maybeSingle();
  return data;
}
async function planSummary(plan: any) {
  const { used, sessions } = await planUsage(plan.id);
  const now = Date.now();
  return {
    name: plan.name, email: plan.email, hours: plan.hours,
    minutes_total: plan.minutes_total, minutes_left: Math.max(0, plan.minutes_total - used),
    sessions: sessions.filter((s: any) => s.status === "confirmed").map((s: any) => {
      const st = Date.parse(s.starts_at);
      return {
        id: s.id, start: s.starts_at, date: longDate(st), label: label(st),
        minutes: s.minutes ?? Math.round((Date.parse(s.ends_at) - st) / 60000),
        past: st < now, can_cancel: st - now > CANCEL_NOTICE_H * 3600_000,
      };
    }),
  };
}

/* ---------- session lists ---------- */
type Want = { start: string; minutes: number; t: number };
async function readSessions(raw: unknown, service: string): Promise<{ ok: true; list: Want[] } | { ok: false; error: string; index?: number }> {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, error: "no_sessions" };
  if (raw.length > 16) return { ok: false, error: "too_many_sessions" };
  const list: Want[] = raw.map((x: any) => {
    const start = clean(x?.start, 40);
    return { start, minutes: sessionLength(service, x?.minutes), t: Date.parse(start) };
  }).sort((a, b) => a.t - b.t);
  for (let i = 1; i < list.length; i++) {
    if (list[i].t < list[i - 1].t + list[i - 1].minutes * 60_000) return { ok: false, error: "sessions_overlap", index: i };
  }
  for (let i = 0; i < list.length; i++) {
    const v = await validateSlot(service, list[i].start, list[i].minutes);
    if (!v.ok) return { ok: false, error: v.error, index: i };
  }
  return { ok: true, list };
}
const totalMinutes = (l: Want[]) => l.reduce((a, b) => a + b.minutes, 0);

/* ---------- email ---------- */
function icsFile(b: any, opts: { method: "REQUEST" | "PUBLISH"; title: string; desc: string; attendee?: string; location: string }) {
  const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//with Genie//Bookings//EN", `METHOD:${opts.method}`,
    "BEGIN:VEVENT", `UID:${b.id}@eugeneobo.com`, `DTSTAMP:${f(new Date().toISOString())}`,
    `DTSTART:${f(b.starts_at)}`, `DTEND:${f(b.ends_at)}`,
    `SUMMARY:${esc(opts.title)}`, `DESCRIPTION:${esc(opts.desc)}`, `LOCATION:${esc(opts.location)}`,
    "ORGANIZER;CN=Genie:mailto:genie@eugeneobo.com",
    ...(opts.attendee ? [`ATTENDEE;RSVP=FALSE;PARTSTAT=ACCEPTED:mailto:${opts.attendee}`] : []),
    "STATUS:CONFIRMED", "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}
async function sendEmail(to: string, subject: string, text: string, ics?: string | string[], extra: Record<string, unknown> = {}) {
  if (!RESEND || !to) return;
  const body: Record<string, unknown> = { from: FROM, to, subject, text, ...extra };
  const files = ics ? (Array.isArray(ics) ? ics : [ics]) : [];
  if (files.length) body.attachments = files.map((f, i) => ({ filename: files.length > 1 ? `session-${i + 1}.ics` : "invite.ics", content: btoa(unescape(encodeURIComponent(f))) }));
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.error("resend", r.status, await r.text());
  } catch (e) { console.error("resend failed", e); }
}

async function sendConfirmations(b: any, opts: { plan?: any; minutesLeft?: number; firstOfPlan?: boolean } = {}) {
  const s = await settings();
  const meet = s.meet_link || "";
  const st = Date.parse(b.starts_at);
  const when = `${longDate(st)} at ${label(st)} (Lagos time)`;
  const first = (b.name || "there").split(" ")[0];
  const isFree = b.service === "free_call";
  const len = b.minutes ?? Math.round((Date.parse(b.ends_at) - st) / 60000);
  const title = isFree ? "Clarity call with Genie" : "Mentorship session with Genie";
  const where = meet || "Google Meet (link coming by email)";
  const planLink = opts.plan ? `${SITE}/book?plan=${opts.plan.token}` : "";

  let subject: string, clientText: string;
  if (isFree) {
    const cancel = `${SITE}/book?cancel=${b.manage_token}`;
    subject = `You're booked: ${when}`;
    clientText = `Hi ${first},\n\nYou're booked for a free 10-minute clarity call with me on ${when}.\n\nJoin here: ${meet || "I'll send the link before the call."}\n\nThis is a video call, so join from a phone or laptop with your camera on, somewhere you can talk.\n\nSet a reminder now. The free call is a one-time thing: if you miss it, you won't be able to book another one.\n\nCome with the one thing you're stuck on. Ten minutes goes fast, so be on time.\n\nCan't make it? Cancel before the call so someone else can take the slot (and you can pick a new time): ${cancel}\n\nGenie`;
  } else if (opts.firstOfPlan) {
    subject = `Mentorship confirmed: ${when}`;
    clientText = `Hi ${first},\n\nPayment received. You have ${mins(opts.plan.minutes_total)} with me.\n\nYour first session: ${when}, ${mins(len)}.\nJoin here: ${meet || "I'll send the link before the session."}\n\nYou have ${mins(opts.minutesLeft ?? 0)} left. Book the rest whenever suits you:\n${planLink}\n\nKeep that link. It's how you book, see and move your sessions.\n${s.genie_whatsapp ? `\nYou can now reach me directly on WhatsApp: ${s.genie_whatsapp}\n` : ""}\nGenie`;
  } else {
    subject = `Session booked: ${when}`;
    clientText = `Hi ${first},\n\nYou're booked: ${when}, ${mins(len)}.\nJoin here: ${meet || "I'll send the link before the session."}\n\nTime left on your plan: ${mins(opts.minutesLeft ?? 0)}.\nManage your sessions: ${planLink}\n\nGenie`;
  }
  await sendEmail(b.email, subject, clientText, icsFile(b, { method: "PUBLISH", title, desc: `Join: ${where}`, location: where }));

  const head = isFree ? "New clarity call" : opts.firstOfPlan ? "New PAID mentorship" : "Mentorship session booked";
  const genieText = `${head}.\n\nWho: ${b.name}\nEmail: ${b.email}\nPhone: ${b.phone || "-"}\nWhen: ${when}\nLength: ${mins(len)}\n${opts.plan ? `Plan: ${opts.plan.hours}h, ${mins(opts.minutesLeft ?? 0)} left\n` : ""}${opts.firstOfPlan ? `Paid: ₦${((opts.plan.amount_kobo ?? 0) / 100).toLocaleString("en-NG")}\n` : ""}Email list: ${b.email_opt_in ? "yes" : "no"}\n\nWhat they want to talk about:\n${b.note || "-"}`;
  if (s.notify_email) {
    await sendEmail(s.notify_email, `${isFree ? "Call" : "Mentorship"}: ${b.name}, ${label(st)} ${longDate(st)}`, genieText,
      icsFile(b, { method: "REQUEST", title: `${isFree ? "Call" : "Mentorship"}: ${b.name}`, desc: genieText, attendee: s.notify_email, location: where }),
      { reply_to: b.email });
  }
}

async function sendPlanEmails(plan: any, rows: any[], kind: "paid" | "booked", minutesLeft: number) {
  if (!rows.length && kind === "booked") return;
  const s = await settings();
  const meet = s.meet_link || "";
  const where = meet || "Google Meet (link coming by email)";
  const first = (plan.name || "there").split(" ")[0];
  const link = `${SITE}/book?plan=${plan.token}`;
  rows = [...rows].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const lines = rows.map((b) => { const st = Date.parse(b.starts_at); return `- ${longDate(st)}, ${label(st)}, ${mins(b.minutes ?? 60)}`; }).join("\n");
  const icsList = rows.map((b) => icsFile(b, { method: "PUBLISH", title: "Mentorship session with Genie", desc: `Join: ${where}`, location: where }));
  const leftLine = minutesLeft ? `\nYou have ${mins(minutesLeft)} left. Book it whenever suits you:\n${link}\n` : `\nSee or move your sessions here:\n${link}\n`;
  const subject = kind === "paid"
    ? `Mentorship confirmed: ${rows.length} session${rows.length === 1 ? "" : "s"} booked`
    : `Booked: ${rows.length} session${rows.length === 1 ? "" : "s"}`;
  const text = kind === "paid"
    ? `Hi ${first},\n\nPayment received. You have ${mins(plan.minutes_total)} with me.\n\nYour sessions:\n${lines || "- None booked yet"}\n\nJoin each one here: ${meet || "I'll send the link before your first session."}\n${leftLine}\nKeep that link. It's how you book, see and move your sessions. You can cancel up to 24 hours before and the time goes back on your plan.\n${s.genie_whatsapp ? `\nYou can now reach me directly on WhatsApp: ${s.genie_whatsapp}\n` : ""}\nGenie`
    : `Hi ${first},\n\nYou're booked:\n${lines}\n\nJoin here: ${meet || "I'll send the link before the session."}\n${leftLine}\nGenie`;
  await sendEmail(plan.email, subject, text, icsList);

  if (s.notify_email) {
    const head = kind === "paid" ? `New PAID mentorship: ${plan.name}` : `Mentorship booked: ${plan.name}`;
    const body = `${head}\n\nEmail: ${plan.email}\nPhone: ${plan.phone || "-"}\nPlan: ${plan.hours}h, ${mins(minutesLeft)} still to book\n${kind === "paid" ? `Paid: ₦${((plan.amount_kobo ?? 0) / 100).toLocaleString("en-NG")}\n` : ""}\nSessions:\n${lines}\n\nWhat they want to work on:\n${rows[0]?.note || "-"}`;
    const genieIcs = rows.map((b) => icsFile(b, { method: "REQUEST", title: `Mentorship: ${plan.name}`, desc: body, attendee: s.notify_email, location: where }));
    await sendEmail(s.notify_email, head, body, genieIcs, { reply_to: plan.email });
  }
}

/* ---------- handlers ---------- */
function readPerson(p: Record<string, unknown>) {
  const name = clean(p.name, 80);
  const email = clean(p.email, 120).toLowerCase();
  const phone = clean(p.phone, 30);
  const note = clean(p.note, 600);
  const opt_in = p.opt_in === true;
  if (!name) return { error: "missing_name" as const };
  if (!validEmail(email)) return { error: "bad_email" as const };
  return { name, email, phone, note, opt_in };
}
const overlapErr = (error: any) => String(error?.message).includes("no_overlapping_slots") || error?.code === "23P01";

async function handleBook(p: Record<string, unknown>) {
  if (p.service !== "free_call") return json({ ok: false, error: "bad_service" }, 400);
  const person = readPerson(p);
  if ("error" in person) return json({ ok: false, error: person.error }, 400);
  await expireHolds();
  const pk = phoneKey(person.phone);
  if (!pk) return json({ ok: false, error: "missing_phone" }, 400);
  if (!(await freeCallEligible(person.email, pk))) return json({ ok: false, error: "free_call_used" }, 409);

  const start = clean(p.start, 40);
  const v = await validateSlot("free_call", start, 10);
  if (!v.ok) return json({ ok: false, error: v.error }, 409);
  const startsAt = new Date(Date.parse(start));
  const { data, error } = await sb.from("slot_bookings").insert({
    service: "free_call", starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 600_000).toISOString(),
    status: "confirmed", minutes: 10,
    name: person.name, email: person.email, phone: person.phone || null, phone_key: pk, note: person.note || null, email_opt_in: person.opt_in,
  }).select().single();
  if (error) {
    if (overlapErr(error)) return json({ ok: false, error: "slot_taken" }, 409);
    console.error(error);
    return json({ ok: false, error: "save_failed" }, 500);
  }
  await upsertContact(person.email, person.name, person.phone, "free_call", person.opt_in);
  await sendConfirmations(data);
  return json({ ok: true, booking: { start: data.starts_at, label: label(Date.parse(data.starts_at)), date: longDate(Date.parse(data.starts_at)) } });
}

async function handleHold(p: Record<string, unknown>) {
  if (p.service !== "mentorship") return json({ ok: false, error: "bad_service" }, 400);
  const person = readPerson(p);
  if ("error" in person) return json({ ok: false, error: person.error }, 400);
  const hours = Number(p.hours);
  if (!PLAN_HOURS.includes(hours)) return json({ ok: false, error: "bad_hours" }, 400);
  await expireHolds();
  const r = await readSessions(p.sessions, "mentorship");
  if (!r.ok) return json({ ok: false, error: r.error, index: r.index }, 409);
  if (totalMinutes(r.list) > hours * 60) return json({ ok: false, error: "not_enough_time" }, 409);

  const reference = "MNT_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const amount_kobo = hours * HOUR_RATE_NAIRA * 100;
  const { data: plan, error: pe } = await sb.from("mentorship_plans").insert({
    name: person.name, email: person.email, phone: person.phone || null, hours, minutes_total: hours * 60,
    amount_kobo, payment_reference: reference, status: "pending",
  }).select().single();
  if (pe) { console.error(pe); return json({ ok: false, error: "save_failed" }, 500); }

  const holdUntil = new Date(Date.now() + HOLD_MINUTES * 60_000).toISOString();
  const { error } = await sb.from("slot_bookings").insert(r.list.map((x) => ({
    service: "mentorship", starts_at: new Date(x.t).toISOString(), ends_at: new Date(x.t + x.minutes * 60_000).toISOString(),
    status: "held", hold_expires_at: holdUntil, minutes: x.minutes, plan_id: plan.id, hours,
    name: person.name, email: person.email, phone: person.phone || null, note: person.note || null,
    email_opt_in: person.opt_in, amount_kobo, phone_key: phoneKey(person.phone) || null,
  })));
  if (error) {
    await sb.from("mentorship_plans").update({ status: "abandoned" }).eq("id", plan.id);
    if (overlapErr(error)) return json({ ok: false, error: "slot_taken" }, 409);
    console.error(error);
    return json({ ok: false, error: "save_failed" }, 500);
  }
  await upsertContact(person.email, person.name, person.phone, "mentorship_checkout", person.opt_in);
  return json({ ok: true, reference, amount_kobo, email: person.email, hold_minutes: HOLD_MINUTES });
}

async function handleConfirm(p: Record<string, unknown>) {
  const reference = clean(p.reference, 60);
  if (!reference) return json({ ok: false, error: "missing_reference" }, 400);
  const { data: plan } = await sb.from("mentorship_plans").select("*").eq("payment_reference", reference).maybeSingle();
  if (!plan) return json({ ok: false, error: "not_found" }, 404);
  if (plan.status === "paid") {
    const sum = await planSummary(plan);
    return json({ ok: true, already: true, plan_token: plan.token, plan: sum });
  }
  if (!PAYSTACK) return json({ ok: false, error: "server_misconfigured" }, 500);
  const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${PAYSTACK}` } });
  const v = await r.json().catch(() => ({}));
  const tx = v?.data;
  if (!r.ok || v?.status !== true || tx?.status !== "success") return json({ ok: false, error: "payment_not_successful" }, 400);
  if ((tx.amount ?? 0) < (plan.amount_kobo ?? 0) || (tx.currency && tx.currency !== "NGN")) return json({ ok: false, error: "amount_mismatch" }, 400);

  // Paid. Mark the plan paid first so the hours are never lost, then confirm each held session.
  await sb.from("mentorship_plans").update({ status: "paid", amount_kobo: tx.amount }).eq("id", plan.id);
  plan.status = "paid";
  const { data: holds } = await sb.from("slot_bookings").select("*").eq("plan_id", plan.id).in("status", ["held", "expired"]);
  const confirmed: any[] = [], lost: any[] = [];
  for (const h of holds ?? []) {
    const { data: upd, error } = await sb.from("slot_bookings")
      .update({ status: "confirmed", hold_expires_at: null, updated_at: new Date().toISOString() }).eq("id", h.id).select().single();
    if (error) { lost.push(h); await sb.from("slot_bookings").update({ status: "cancelled" }).eq("id", h.id); }
    else confirmed.push(upd);
  }
  const first = (holds ?? [])[0];
  if (first) await upsertContact(plan.email, plan.name, plan.phone ?? "", "mentorship_paid", !!first.email_opt_in);
  const sum = await planSummary(plan);
  await sendPlanEmails(plan, confirmed, "paid", sum.minutes_left);
  if (lost.length) {
    const s = await settings();
    await sendEmail(s.notify_email || "", `Note: ${lost.length} mentorship time(s) were taken while ${plan.name} paid`,
      `${plan.name} (${plan.email}) paid ${reference}. ${lost.length} of their picked times were taken during payment. That time is back on their plan for them to rebook: ${SITE}/book?plan=${plan.token}`);
  }
  const s = await settings();
  return json({ ok: true, whatsapp: s.genie_whatsapp || null, plan_token: plan.token, plan: sum, lost: lost.length });
}

async function handleRelease(p: Record<string, unknown>) {
  const reference = clean(p.reference, 60);
  if (!reference) return json({ ok: false }, 400);
  const { data: plan } = await sb.from("mentorship_plans").select("id,status").eq("payment_reference", reference).maybeSingle();
  if (plan && plan.status === "pending") {
    await sb.from("slot_bookings").update({ status: "expired", updated_at: new Date().toISOString() }).eq("plan_id", plan.id).eq("status", "held");
  }
  return json({ ok: true });
}

async function handlePlan(p: Record<string, unknown>) {
  const plan = await planByToken(clean(p.token, 60));
  if (!plan) return json({ ok: false, error: "plan_not_found" }, 404);
  return json({ ok: true, plan: await planSummary(plan) });
}

async function handleBookSessions(p: Record<string, unknown>) {
  const plan = await planByToken(clean(p.token, 60));
  if (!plan) return json({ ok: false, error: "plan_not_found" }, 404);
  await expireHolds();
  const raw = Array.isArray(p.sessions) ? p.sessions : [{ start: p.start, minutes: p.minutes }];
  const r = await readSessions(raw, "mentorship");
  if (!r.ok) return json({ ok: false, error: r.error, index: r.index }, 409);
  const { used } = await planUsage(plan.id);
  if (totalMinutes(r.list) > plan.minutes_total - used) return json({ ok: false, error: "not_enough_time" }, 409);
  const note = clean(p.note, 600) || null;
  const { data, error } = await sb.from("slot_bookings").insert(r.list.map((x) => ({
    service: "mentorship", starts_at: new Date(x.t).toISOString(), ends_at: new Date(x.t + x.minutes * 60_000).toISOString(),
    status: "confirmed", minutes: x.minutes, plan_id: plan.id, hours: plan.hours,
    name: plan.name, email: plan.email, phone: plan.phone, note,
  }))).select();
  if (error) {
    if (overlapErr(error)) return json({ ok: false, error: "slot_taken" }, 409);
    console.error(error);
    return json({ ok: false, error: "save_failed" }, 500);
  }
  const sum = await planSummary(plan);
  await sendPlanEmails(plan, data ?? [], "booked", sum.minutes_left);
  return json({ ok: true, plan: sum, booked: (data ?? []).length });
}

async function handleCancelSession(p: Record<string, unknown>) {
  const plan = await planByToken(clean(p.token, 60));
  if (!plan) return json({ ok: false, error: "plan_not_found" }, 404);
  const id = clean(p.id, 60);
  const { data: b } = await sb.from("slot_bookings").select("*").eq("id", id).eq("plan_id", plan.id).maybeSingle();
  if (!b || b.status !== "confirmed") return json({ ok: false, error: "not_found" }, 404);
  if (Date.parse(b.starts_at) - Date.now() < CANCEL_NOTICE_H * 3600_000) return json({ ok: false, error: "too_late_to_cancel" }, 409);
  await sb.from("slot_bookings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", b.id);
  const s = await settings();
  const st = Date.parse(b.starts_at);
  if (s.notify_email) await sendEmail(s.notify_email, `Mentorship moved: ${b.name}, ${label(st)} ${longDate(st)}`,
    `${b.name} cancelled their ${mins(b.minutes ?? 60)} session on ${longDate(st)} at ${label(st)}. The time went back on their plan.`);
  return json({ ok: true, plan: await planSummary(plan) });
}

async function handleCancel(p: Record<string, unknown>) {
  const token = clean(p.token, 60);
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ ok: false, error: "bad_token" }, 400);
  const { data: b } = await sb.from("slot_bookings").select("*").eq("manage_token", token).maybeSingle();
  if (!b) return json({ ok: false, error: "not_found" }, 404);
  if (b.status === "cancelled") return json({ ok: true, already: true });
  if (b.service !== "free_call") return json({ ok: false, error: "paid_contact_genie" }, 400);
  if (Date.parse(b.starts_at) < Date.now()) return json({ ok: false, error: "already_past" }, 400);
  await sb.from("slot_bookings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", b.id);
  const s = await settings();
  const st = Date.parse(b.starts_at);
  if (s.notify_email) await sendEmail(s.notify_email, `Cancelled: ${b.name}, ${label(st)} ${longDate(st)}`,
    `${b.name} cancelled their clarity call. The slot is open again.`);
  return json({ ok: true, when: `${longDate(st)} at ${label(st)}` });
}

async function handleCheck(p: Record<string, unknown>) {
  const email = clean(p.email, 120).toLowerCase();
  if (!validEmail(email)) return json({ ok: false, error: "bad_email" }, 400);
  return json({ ok: true, eligible: await freeCallEligible(email, phoneKey(clean(p.phone, 30))) });
}

const WAITLISTS: Record<string, { subject: string; body: (first: string) => string }> = {
  event: {
    subject: "You're on the list for Forward with Genie",
    body: (first) => `Hi ${first},\n\nYou're on the list for Forward with Genie, my monthly in-person session in Abuja.\n\nI'll email you as soon as tickets open. The room only holds about 10 people, so when that email lands, move quickly.\n\nGenie`,
  },
  courses: {
    subject: "You're on the communication course waitlist",
    body: (first) => `Hi ${first},\n\nYou're on the waitlist for my communication courses.\n\nI'll email you once, when the first course opens. You'll hear about it before anyone else.\n\nGenie`,
  },
};

async function handleSubscribe(p: Record<string, unknown>) {
  const email = clean(p.email, 120).toLowerCase();
  const name = clean(p.name, 80);
  const source = clean(p.source, 30);
  if (!validEmail(email)) return json({ ok: false, error: "bad_email" }, 400);
  if (source === "newsletter") {
    await upsertContact(email, name, "", "newsletter", true);
    return json({ ok: true });
  }
  const list = WAITLISTS[source];
  if (!list) return json({ ok: false, error: "bad_source" }, 400);
  const { data: inserted, error } = await sb.from("waitlist")
    .upsert({ list: source, email, name: name || null }, { onConflict: "list,email", ignoreDuplicates: true })
    .select("id");
  if (error) { console.error(error); return json({ ok: false, error: "save_failed" }, 500); }
  const isNew = (inserted ?? []).length > 0;
  await upsertContact(email, name, "", "waitlist_" + source, false);
  if (isNew) await sendEmail(email, list.subject, list.body((name || "there").split(" ")[0]));
  return json({ ok: true, already: !isNew });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      const service = u.searchParams.get("service") ?? "free_call";
      if (!["free_call", "mentorship"].includes(service)) return json({ ok: false, error: "bad_service" }, 400);
      const minutes = sessionLength(service, u.searchParams.get("minutes"));
      const r = await buildSlots(service, minutes);
      return json({ ok: true, service, minutes, tz: "Africa/Lagos", ...r }, 200, { "Cache-Control": "no-store" });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
    const p = await req.json().catch(() => ({}));
    switch (p.action) {
      case "book": return await handleBook(p);
      case "hold": return await handleHold(p);
      case "confirm": return await handleConfirm(p);
      case "release": return await handleRelease(p);
      case "plan": return await handlePlan(p);
      case "book_session":
      case "book_sessions": return await handleBookSessions(p);
      case "cancel_session": return await handleCancelSession(p);
      case "cancel": return await handleCancel(p);
      case "subscribe": return await handleSubscribe(p);
      case "check": return await handleCheck(p);
      default: return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
