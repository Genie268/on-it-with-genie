/*
 * booking-api: live booking for free calls and mentorship.
 *
 * GET  ?service=free_call|mentorship&days=14
 *      Open and taken slots, built from availability_rules, minus
 *      slot_bookings, minus busy times on Genie's Google Calendar (iCal feed).
 * POST {action:"book",    service:"free_call", start, name, email, phone?, note?, opt_in?}
 * POST {action:"hold",    service:"mentorship", start, hours, plan, name, email, phone?, note?, opt_in?}
 *      Holds the first session for 15 minutes and returns a Paystack reference + amount.
 * POST {action:"confirm", reference}   Verifies payment with Paystack and confirms the hold.
 * POST {action:"release", reference}   Frees a hold when the payment window is closed.
 * POST {action:"cancel",  token}       Cancels a booking from the link in the confirmation email.
 * POST {action:"subscribe", email, name?, source}  Waitlist / email list sign-up.
 * POST {action:"check",   email, phone?}  Has this person already used their free call?
 *
 * Rules: bookings only within booking_window_days (private_settings). Free calls need a phone
 * number and are one per person (email or phone), unless contacts.extra_free_calls grants more.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, PAYSTACK_SECRET_KEY
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import IcalExpander from "npm:ical-expander@3.1.0";

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
const SITE = "https://eugeneobo.com";
const FROM = "Genie <genie@eugeneobo.com>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

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

/* ---------- Google Calendar busy times ---------- */
let icsCache: { at: number; text: string } | null = null;
async function busyRanges(from: Date, to: Date): Promise<Array<[number, number]>> {
  const url = (await settings()).google_ical_url;
  if (!url) return [];
  try {
    if (!icsCache || Date.now() - icsCache.at > 120_000) {
      const r = await fetch(url);
      if (!r.ok) throw new Error("ics " + r.status);
      icsCache = { at: Date.now(), text: await r.text() };
    }
    const exp = new IcalExpander({ ics: icsCache.text, maxIterations: 1000 });
    const { events, occurrences } = exp.between(from, to);
    const out: Array<[number, number]> = [];
    const add = (comp: any, start: any, end: any) => {
      if (start.isDate) return; // all-day events don't block slots
      const transp = comp?.getFirstPropertyValue?.("transp");
      if (transp && String(transp).toUpperCase() === "TRANSPARENT") return;
      const status = comp?.getFirstPropertyValue?.("status");
      if (status && String(status).toUpperCase() === "CANCELLED") return;
      out.push([start.toJSDate().getTime(), end.toJSDate().getTime()]);
    };
    for (const e of events) add(e.component, e.startDate, e.endDate);
    for (const o of occurrences) add(o.item.component, o.startDate, o.endDate);
    return out;
  } catch (e) {
    console.error("calendar read failed", e);
    return [];
  }
}

/* ---------- helpers ---------- */
function lagosDate(ms: number) {
  const d = new Date(ms + OFFSET_MS);
  return d.toISOString().slice(0, 10);
}
function lagosWeekday(dateStr: string) {
  return new Date(dateStr + "T12:00:00Z").getUTCDay();
}
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
  return new Date(ms).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos",
  });
}
const clean = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
/* Same number however it's typed: 0803..., +234803..., 234 803 ... all become 8031234567 */
function phoneKey(raw: string) {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length < 7) return "";
  return d.length > 10 ? d.slice(-10) : d.replace(/^0/, "");
}
async function windowDays() {
  const n = Number((await settings()).booking_window_days);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 30) : 3;
}
/* One free call per person, ever, unless Genie grants extra ones. Cancelling before the call frees it up. */
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
  const { data } = await sb.from("availability_rules").select("*").eq("service", service).eq("active", true);
  return (data ?? []) as Rule[];
}

async function buildSlots(service: string, days: number) {
  await expireHolds();
  const rules = await rulesFor(service);
  days = Math.min(days, await windowDays());
  const now = Date.now();
  const today = lagosDate(now);
  const lastDay = addDays(today, days);
  const fromMs = new Date(today + "T00:00:00" + TZ_OFFSET).getTime();
  const toMs = new Date(lastDay + "T23:59:59" + TZ_OFFSET).getTime();

  const [{ data: booked }, busy] = await Promise.all([
    sb.from("slot_bookings").select("starts_at,ends_at").in("status", ["held", "confirmed"])
      .gte("ends_at", new Date(fromMs).toISOString()).lte("starts_at", new Date(toMs).toISOString()),
    busyRanges(new Date(fromMs), new Date(toMs)),
  ]);
  const taken: Array<[number, number]> = [
    ...(booked ?? []).map((b: any) => [Date.parse(b.starts_at), Date.parse(b.ends_at)] as [number, number]),
    ...busy,
  ];
  const overlaps = (a: number, b: number) => taken.some(([s, e]) => a < e && b > s);
  const lead = (LEAD_MINUTES[service] ?? 10) * 60_000;

  const out: Array<{ date: string; slots: Array<{ start: string; label: string; open: boolean }> }> = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    const wd = lagosWeekday(date);
    const slots: Array<{ start: string; label: string; open: boolean }> = [];
    for (const r of rules.filter((x) => x.weekday === wd)) {
      let t = new Date(`${date}T${r.start_time.slice(0, 5)}:00${TZ_OFFSET}`).getTime();
      const end = new Date(`${date}T${r.end_time.slice(0, 5)}:00${TZ_OFFSET}`).getTime();
      const step = r.slot_minutes * 60_000;
      for (; t + step <= end; t += step) {
        if (t < now + lead) continue;
        slots.push({ start: new Date(t).toISOString(), label: label(t), open: !overlaps(t, t + step) });
      }
    }
    slots.sort((a, b) => a.start.localeCompare(b.start));
    if (slots.length) out.push({ date, slots });
  }
  return out;
}

/* Is this exact start a real, open slot for the service? Returns its length in minutes. */
async function validateSlot(service: string, startIso: string): Promise<{ ok: true; minutes: number } | { ok: false; error: string }> {
  const t = Date.parse(startIso);
  if (!Number.isFinite(t)) return { ok: false, error: "bad_time" };
  const lead = (LEAD_MINUTES[service] ?? 10) * 60_000;
  if (t < Date.now() + lead) return { ok: false, error: "too_soon" };
  const date = lagosDate(t);
  if (date > addDays(lagosDate(Date.now()), await windowDays())) return { ok: false, error: "too_far" };
  const wd = lagosWeekday(date);
  const rules = (await rulesFor(service)).filter((r) => r.weekday === wd);
  for (const r of rules) {
    const s = new Date(`${date}T${r.start_time.slice(0, 5)}:00${TZ_OFFSET}`).getTime();
    const e = new Date(`${date}T${r.end_time.slice(0, 5)}:00${TZ_OFFSET}`).getTime();
    const step = r.slot_minutes * 60_000;
    if (t >= s && t + step <= e && (t - s) % step === 0) {
      const busy = await busyRanges(new Date(t - 86400000), new Date(t + 86400000));
      if (busy.some(([bs, be]) => t < be && t + step > bs)) return { ok: false, error: "slot_taken" };
      return { ok: true, minutes: r.slot_minutes };
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
async function sendEmail(to: string, subject: string, text: string, ics?: string, extra: Record<string, unknown> = {}) {
  if (!RESEND || !to) return;
  const body: Record<string, unknown> = { from: FROM, to, subject, text, ...extra };
  if (ics) body.attachments = [{ filename: "invite.ics", content: btoa(unescape(encodeURIComponent(ics))) }];
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.error("resend", r.status, await r.text());
  } catch (e) { console.error("resend failed", e); }
}

async function sendConfirmations(b: any) {
  const s = await settings();
  const meet = s.meet_link || "";
  const when = `${longDate(Date.parse(b.starts_at))} at ${label(Date.parse(b.starts_at))} (Lagos time)`;
  const first = (b.name || "there").split(" ")[0];
  const cancel = `${SITE}/book?cancel=${b.manage_token}`;
  const isFree = b.service === "free_call";
  const title = isFree ? "Clarity call with Genie" : "Mentorship session with Genie";
  const where = meet || "Google Meet (link coming by email)";

  const clientText = isFree
    ? `Hi ${first},\n\nYou're booked for a free 10-minute clarity call with me on ${when}.\n\nJoin here: ${meet || "I'll send the link before the call."}\n\nThis is a video call, so join from a phone or laptop with your camera on, somewhere you can talk.\n\nSet a reminder now. The free call is a one-time thing: if you miss it, you won't be able to book another one.\n\nCome with the one thing you're stuck on. Ten minutes goes fast, so be on time.\n\nCan't make it? Cancel before the call so someone else can take the slot (and you can pick a new time): ${cancel}\n\nGenie`
    : `Hi ${first},\n\nPayment received. Your first mentorship session is on ${when}.\n\nPlan: ${b.hours} hour${b.hours > 1 ? "s" : ""}, ${b.plan}.\nJoin here: ${meet || "I'll send the link before the session."}\n${s.genie_whatsapp ? `\nYou can now reach me directly on WhatsApp: ${s.genie_whatsapp}\n` : ""}\nWe'll set the rest of your sessions together on our first call.\n\nGenie`;

  await sendEmail(b.email, isFree ? `You're booked: ${when}` : `Mentorship confirmed: ${when}`, clientText,
    icsFile(b, { method: "PUBLISH", title, desc: `Join: ${where}`, location: where }));

  const genieText = `${isFree ? "New clarity call" : "New PAID mentorship"} booked.\n\nWho: ${b.name}\nEmail: ${b.email}\nPhone: ${b.phone || "-"}\nWhen: ${when}\n${isFree ? "" : `Plan: ${b.hours}h, ${b.plan}\nPaid: ₦${((b.amount_kobo ?? 0) / 100).toLocaleString("en-NG")}\n`}Email list: ${b.email_opt_in ? "yes" : "no"}\n\nWhat they want to talk about:\n${b.note || "-"}`;
  if (s.notify_email) {
    await sendEmail(s.notify_email, `${isFree ? "Call" : "Mentorship"}: ${b.name}, ${label(Date.parse(b.starts_at))} ${longDate(Date.parse(b.starts_at))}`, genieText,
      icsFile(b, { method: "REQUEST", title: `${isFree ? "Call" : "Mentorship"}: ${b.name}`, desc: genieText, attendee: s.notify_email, location: where }),
      { reply_to: b.email });
  }
}

/* ---------- handlers ---------- */
async function readPerson(p: Record<string, unknown>) {
  const name = clean(p.name, 80);
  const email = clean(p.email, 120).toLowerCase();
  const phone = clean(p.phone, 30);
  const note = clean(p.note, 600);
  const opt_in = p.opt_in === true;
  if (!name) return { error: "missing_name" };
  if (!validEmail(email)) return { error: "bad_email" };
  return { name, email, phone, note, opt_in };
}

async function handleBook(p: Record<string, unknown>) {
  if (p.service !== "free_call") return json({ ok: false, error: "bad_service" }, 400);
  const person = await readPerson(p);
  if ("error" in person) return json({ ok: false, error: person.error }, 400);
  await expireHolds();

  const pk = phoneKey(person.phone);
  if (!pk) return json({ ok: false, error: "missing_phone" }, 400);
  if (!(await freeCallEligible(person.email, pk))) return json({ ok: false, error: "free_call_used" }, 409);

  const start = clean(p.start, 40);
  const v = await validateSlot("free_call", start);
  if (!v.ok) return json({ ok: false, error: v.error }, 409);
  const startsAt = new Date(Date.parse(start));
  const endsAt = new Date(startsAt.getTime() + v.minutes * 60_000);

  const { data, error } = await sb.from("slot_bookings").insert({
    service: "free_call", starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), status: "confirmed",
    name: person.name, email: person.email, phone: person.phone || null, phone_key: pk, note: person.note || null, email_opt_in: person.opt_in,
  }).select().single();
  if (error) {
    if (String(error.message).includes("no_overlapping_slots") || error.code === "23P01") return json({ ok: false, error: "slot_taken" }, 409);
    console.error(error);
    return json({ ok: false, error: "save_failed" }, 500);
  }
  await upsertContact(person.email, person.name, person.phone, "free_call", person.opt_in);
  await sendConfirmations(data);
  return json({ ok: true, booking: { start: data.starts_at, label: label(Date.parse(data.starts_at)), date: longDate(Date.parse(data.starts_at)) } });
}

async function handleHold(p: Record<string, unknown>) {
  if (p.service !== "mentorship") return json({ ok: false, error: "bad_service" }, 400);
  const person = await readPerson(p);
  if ("error" in person) return json({ ok: false, error: person.error }, 400);
  const hours = Number(p.hours);
  if (![1, 2, 4, 8].includes(hours)) return json({ ok: false, error: "bad_hours" }, 400);
  const plan = clean(p.plan, 120) || "Single session";
  await expireHolds();

  const start = clean(p.start, 40);
  const v = await validateSlot("mentorship", start);
  if (!v.ok) return json({ ok: false, error: v.error }, 409);
  const startsAt = new Date(Date.parse(start));
  const endsAt = new Date(startsAt.getTime() + v.minutes * 60_000);
  const reference = "MNT_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const amount_kobo = hours * HOUR_RATE_NAIRA * 100;

  const { data, error } = await sb.from("slot_bookings").insert({
    service: "mentorship", starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), status: "held",
    hold_expires_at: new Date(Date.now() + HOLD_MINUTES * 60_000).toISOString(),
    name: person.name, email: person.email, phone: person.phone || null, note: person.note || null,
    email_opt_in: person.opt_in, hours, plan, amount_kobo, payment_reference: reference, phone_key: phoneKey(person.phone) || null,
  }).select().single();
  if (error) {
    if (String(error.message).includes("no_overlapping_slots") || error.code === "23P01") return json({ ok: false, error: "slot_taken" }, 409);
    console.error(error);
    return json({ ok: false, error: "save_failed" }, 500);
  }
  await upsertContact(person.email, person.name, person.phone, "mentorship_checkout", person.opt_in);
  return json({ ok: true, reference, amount_kobo, email: person.email, hold_minutes: HOLD_MINUTES, id: data.id });
}

async function handleConfirm(p: Record<string, unknown>) {
  const reference = clean(p.reference, 60);
  if (!reference) return json({ ok: false, error: "missing_reference" }, 400);
  const { data: b } = await sb.from("slot_bookings").select("*").eq("payment_reference", reference).maybeSingle();
  if (!b) return json({ ok: false, error: "not_found" }, 404);
  if (b.status === "confirmed") return json({ ok: true, already: true });
  if (!PAYSTACK) return json({ ok: false, error: "server_misconfigured" }, 500);

  const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK}` },
  });
  const v = await r.json().catch(() => ({}));
  const tx = v?.data;
  if (!r.ok || v?.status !== true || tx?.status !== "success") return json({ ok: false, error: "payment_not_successful" }, 400);
  if ((tx.amount ?? 0) < (b.amount_kobo ?? 0) || (tx.currency && tx.currency !== "NGN")) return json({ ok: false, error: "amount_mismatch" }, 400);

  // Paid. Confirm even if the hold lapsed, as long as nobody else took the slot.
  const { data: upd, error } = await sb.from("slot_bookings")
    .update({ status: "confirmed", hold_expires_at: null, updated_at: new Date().toISOString() })
    .eq("id", b.id).select().single();
  if (error) {
    await sendEmail((await settings()).notify_email || "", `ACTION NEEDED: paid mentorship lost its slot (${b.name})`,
      `${b.name} (${b.email}) paid ${reference} but the slot ${b.starts_at} was taken while they paid. Contact them to pick a new time.`);
    return json({ ok: false, error: "slot_lost_after_payment" }, 409);
  }
  await upsertContact(b.email, b.name, b.phone ?? "", "mentorship_paid", b.email_opt_in);
  await sendConfirmations(upd);
  const s = await settings();
  return json({ ok: true, whatsapp: s.genie_whatsapp || null, booking: { start: upd.starts_at, label: label(Date.parse(upd.starts_at)), date: longDate(Date.parse(upd.starts_at)) } });
}

async function handleRelease(p: Record<string, unknown>) {
  const reference = clean(p.reference, 60);
  if (!reference) return json({ ok: false }, 400);
  await sb.from("slot_bookings").update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("payment_reference", reference).eq("status", "held");
  return json({ ok: true });
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
  if (s.notify_email) await sendEmail(s.notify_email, `Cancelled: ${b.name}, ${label(Date.parse(b.starts_at))} ${longDate(Date.parse(b.starts_at))}`,
    `${b.name} cancelled their clarity call. The slot is open again.`);
  return json({ ok: true, when: `${longDate(Date.parse(b.starts_at))} at ${label(Date.parse(b.starts_at))}` });
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
      const days = Math.min(Math.max(Number(u.searchParams.get("days") ?? 14), 1), 30);
      return json({ ok: true, service, tz: "Africa/Lagos", window_days: await windowDays(), days: await buildSlots(service, days) });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
    const p = await req.json().catch(() => ({}));
    switch (p.action) {
      case "book": return await handleBook(p);
      case "hold": return await handleHold(p);
      case "confirm": return await handleConfirm(p);
      case "release": return await handleRelease(p);
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
