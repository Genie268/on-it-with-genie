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
 *   save_settings {genie_whatsapp?, booking_window_days?, mentorship_window_days?, squad_revision_days?}
 *   save_rule     {id, start_time, end_time, active}
 *   checkin       {id, value}             Door check-in for an event pass (true/false)
 *   squad_create  {name, code, starts_on, weeks, event?}   New accountability squad
 *   squad_toggle  {id, active}            Open/close a squad (closed = no new joins, no reminders)
 *   squad_media_url {member_id, kind:"video"|"photo", type}   Signed upload URL for a member's declaration video/photo
 *   squad_set_media {member_id, kind, path}                   Attach the uploaded file (path "" removes it)
 *   squad_allow_revision {member_id}      Let a squad member change their goal once (e.g. after a check-in call). Emails them.
 *   free_calls    {open}                  Close free clarity sessions (all free_call hours off, remembered) or reopen them
 *   event_save    {code?, session, title?, date, start, end, venue?, venue_short?, address?, maps?, capacity, registration_open, published?}
 *                                         Create or edit a Forward with Genie session (no code = new one)
 *   intake_save   {open, closes?, next_opens?, cap?}   15-day challenge sign-ups switch
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
  // Communication Gap Test: how people split across the types
  const { data: gapRows } = await sb.from("gap_results").select("type,second,email,name,created_at").order("created_at", { ascending: false }).limit(2000);
  const gapCounts: Record<string, number> = {};
  (gapRows ?? []).forEach((r: any) => (gapCounts[r.type] = (gapCounts[r.type] ?? 0) + 1));
  // how many free calls each person has ever had (to flag repeat bookers)
  const { data: allFree } = await sb.from("slot_bookings").select("name,email,phone_key").eq("service", "free_call").eq("status", "confirmed");
  const norm = (n: string) => (n || "").toLowerCase().replace(/[^a-z]/g, "");
  const byName: Record<string, number> = {};
  (allFree ?? []).forEach((r: any) => { const k = norm(r.name); if (k) byName[k] = (byName[k] ?? 0) + 1; });
  // event passes (latest event first)
  const { data: evRows } = await sb.from("event_registrations").select("id,event,name,email,phone,goal,pass_code,checked_in,checked_in_at,released_at,reminded_at,created_at,ref,invited_by").order("created_at");
  const { data: capRow } = await sb.from("private_settings").select("value").eq("key", "event_capacity").maybeSingle();
  // squads with their members and check-ins
  const [{ data: sqs }, { data: sqm }, { data: sqc }] = await Promise.all([
    sb.from("squads").select("*").order("created_at", { ascending: false }),
    sb.from("squad_members").select("id,squad_id,name,email,phone,goal,deadline,proof,first_step,started_at,started_note,created_at,photo_path,video_path,video_cover_path,show_video,revision_allowed_at,revised_at,first_goal").order("created_at"),
    sb.from("squad_checkins").select("member_id,squad_id,week,status,note"),
  ]);
  const vpaths = (sqm ?? []).map((m: any) => m.video_path).filter(Boolean);
  const signed: Record<string, string> = {};
  if (vpaths.length) { const { data: su } = await sb.storage.from("squad-video").createSignedUrls(vpaths, 6 * 3600); (su ?? []).forEach((x: any) => { if (x.signedUrl) signed[x.path] = x.signedUrl; }); }
  const squads = (sqs ?? []).map((q: any) => ({ ...q,
    week: (() => { const d = Math.floor((Date.parse(new Date(Date.now() + 3600_000).toISOString().slice(0, 10)) - Date.parse(q.starts_on)) / 86400000); return d < 0 ? 0 : Math.floor(d / 7) + 1; })(),
    members: (sqm ?? []).filter((m: any) => m.squad_id === q.id).map((m: any) => ({ ...m, photo: m.photo_path ? URL_ + "/storage/v1/object/public/squad-media/" + m.photo_path : null, video: m.video_path ? (signed[m.video_path] ?? null) : null, cover: m.video_cover_path ? URL_ + "/storage/v1/object/public/squad-media/" + m.video_cover_path : null, checkins: Object.fromEntries((sqc ?? []).filter((c: any) => c.member_id === m.id).map((c: any) => [c.week, { status: c.status, note: c.note }])) })) }));
  const [{ data: evs }, { data: intakeRow }] = await Promise.all([
    sb.from("events").select("*").order("starts_at", { ascending: false }),
    sb.from("public_settings").select("value").eq("key", "intake").maybeSingle(),
  ]);
  return {
    events: evs ?? [],
    intake: intakeRow?.value ?? { open: true, closes: null, next_opens: null, cap: 12 },
    squads,
    ok: true,
    now: new Date().toISOString(),
    event_regs: evRows ?? [],
    event_capacity: Number(capRow?.value) || 15,
    bookings: (bookings ?? []).map((b: any) => {
      const t = Date.parse(b.starts_at);
      return { ...b, date: longDate(t), label: label(t), same_name: b.service === "free_call" && b.status === "confirmed" ? (byName[norm(b.name)] ?? 0) : 0 };
    }),
    plans: (plans ?? []).map((p: any) => ({ ...p, minutes_used: used[p.id] ?? 0, link: `${SITE}/book?plan=${p.token}`, manual: String(p.payment_reference || "").startsWith("MANUAL_") })),
    gap: { total: (gapRows ?? []).length, counts: gapCounts, emails: (gapRows ?? []).filter((r: any) => r.email).length, recent: (gapRows ?? []).slice(0, 30) },
    waitlist: waitlist ?? [],
    contacts: contacts ?? [],
    rules: rules ?? [],
    settings: {
      genie_whatsapp: s.genie_whatsapp ?? "", booking_window_days: s.booking_window_days ?? "3",
      mentorship_window_days: s.mentorship_window_days ?? "30", notify_email: s.notify_email ?? "",
      calendar_synced_at: s.calendar_synced_at ?? "", squad_revision_days: s.squad_revision_days ?? "7",
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

async function checkin(p: P) {
  const id = clean(p.id, 60), v = p.value === true;
  const { error } = await sb.from("event_registrations").update({ checked_in: v, checked_in_at: v ? new Date().toISOString() : null }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

async function squadCreate(p: P) {
  const name = clean(p.name, 60), code = clean(p.code, 20).toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const starts = /^\d{4}-\d{2}-\d{2}$/.test(clean(p.starts_on, 10)) ? clean(p.starts_on, 10) : new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  const weeks = Math.min(12, Math.max(1, Math.round(Number(p.weeks) || 4)));
  if (name.length < 2) return { ok: false, error: "missing_name" };
  if (code.length < 3) return { ok: false, error: "bad_code" };
  const { data, error } = await sb.from("squads").insert({ name, code, starts_on: starts, weeks, event: clean(p.event, 20) || null }).select().single();
  if (error) return { ok: false, error: String(error.code) === "23505" ? "code_taken" : error.message };
  return { ok: true, squad: data };
}
const MEDIA = URL_ + "/storage/v1/object/public/squad-media/";
async function squadMediaUrl(p: P) {
  const id = clean(p.member_id, 60), kind = p.kind === "photo" ? "photo" : p.kind === "cover" ? "cover" : "video", type = clean(p.type, 40);
  const { data: m } = await sb.from("squad_members").select("id, squads(code)").eq("id", id).maybeSingle();
  if (!m) return { ok: false, error: "not_found" };
  const ext = kind === "video" ? (type === "video/quicktime" ? "mov" : type === "video/webm" ? "webm" : "mp4") : (type === "image/png" ? "png" : "jpg");
  const path = `${(m as any).squads.code}/${m.id}/${kind === "video" ? "declaration" : kind}-${Date.now()}.${ext}`;
  // videos go in a private bucket (only short-lived links are handed out); photos and covers stay public
  const { data, error } = await sb.storage.from(kind === "video" ? "squad-video" : "squad-media").createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "upload_failed" };
  return { ok: true, url: data.signedUrl, path };
}
async function squadSetMedia(p: P) {
  const id = clean(p.member_id, 60), kind = p.kind === "photo" ? "photo_path" : p.kind === "cover" ? "video_cover_path" : "video_path", path = clean(p.path, 200);
  if (path && (!path.includes(`/${id}/`) || path.includes(".."))) return { ok: false, error: "bad_path" };
  const upd: Record<string, string | null> = { [kind]: path || null };
  if (kind === "video_path") upd.video_cover_path = null; // a new video needs a new cover
  const { error } = await sb.from("squad_members").update(upd).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
async function freeCalls(p: P) {
  if (p.open === true) {
    const { data: saved } = await sb.from("private_settings").select("value").eq("key", "free_calls_reopen_rules").maybeSingle();
    let ids: string[] = []; try { ids = JSON.parse(saved?.value || "[]"); } catch { ids = []; }
    if (ids.length) await sb.from("availability_rules").update({ active: true }).in("id", ids);
    else await sb.from("availability_rules").update({ active: true }).eq("service", "free_call");
  } else {
    const { data: act } = await sb.from("availability_rules").select("id").eq("service", "free_call").eq("active", true);
    if ((act ?? []).length) await sb.from("private_settings").upsert({ key: "free_calls_reopen_rules", value: JSON.stringify((act ?? []).map((r: any) => r.id)), updated_at: new Date().toISOString() });
    await sb.from("availability_rules").update({ active: false }).eq("service", "free_call");
  }
  return { ok: true };
}
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v), isTime = (v: string) => /^\d{2}:\d{2}$/.test(v);
async function eventSave(p: P) {
  const session = clean(p.session, 6).replace(/\D/g, "").padStart(2, "0");
  const date = clean(p.date, 10), start = clean(p.start, 5), end = clean(p.end, 5);
  if (!session || session === "00") return { ok: false, error: "Add the session number" };
  if (!isDate(date) || !isTime(start) || !isTime(end) || end <= start) return { ok: false, error: "Check the date and times" };
  const cap = Math.round(Number(p.capacity));
  if (!(cap >= 1 && cap <= 1000)) return { ok: false, error: "Capacity must be a number" };
  let maps = clean(p.maps, 300), address = clean(p.address, 200), venue = clean(p.venue, 80), venueShort = clean(p.venue_short, 60);
  if (maps && !/^https?:\/\//.test(maps)) return { ok: false, error: "The map link must start with https://" };
  if (!maps && (venue || address)) maps = "https://maps.google.com/?q=" + encodeURIComponent([venue, address].filter(Boolean).join(" "));
  const row: Record<string, unknown> = {
    title: clean(p.title, 80) || "Forward with Genie", session,
    starts_at: `${date}T${start}:00+01:00`, ends_at: `${date}T${end}:00+01:00`,
    venue: venue || null, venue_short: venueShort || venue || null, address: address || null, maps: maps || null,
    capacity: cap, registration_open: p.registration_open === true, published: p.published !== false, updated_at: new Date().toISOString(),
  };
  const code = clean(p.code, 20);
  if (code) {
    const { error } = await sb.from("events").update(row).eq("code", code);
    return error ? { ok: false, error: error.message } : { ok: true, code };
  }
  const newCode = `fwg-${session}`;
  const { error } = await sb.from("events").insert({ code: newCode, ...row });
  if (error) return { ok: false, error: String(error.code) === "23505" ? `Session ${session} already exists. Edit it instead.` : error.message };
  return { ok: true, code: newCode };
}
async function intakeSave(p: P) {
  const closes = clean(p.closes, 10), next = clean(p.next_opens, 10), cap = Math.round(Number(p.cap));
  if ((closes && !isDate(closes)) || (next && !isDate(next))) return { ok: false, error: "Check the dates" };
  const value = { open: p.open === true, closes: closes || null, next_opens: next || null, cap: cap >= 1 && cap <= 10000 ? cap : null };
  const { error } = await sb.from("public_settings").upsert({ key: "intake", value, updated_at: new Date().toISOString() });
  return error ? { ok: false, error: error.message } : { ok: true, intake: value };
}
async function squadAllowRevision(p: P) {
  const id = clean(p.member_id, 60);
  const { data: m } = await sb.from("squad_members").select("id,name,email,goal,token,created_at,revised_at,squads(code,name)").eq("id", id).maybeSingle();
  if (!m) return { ok: false, error: "Member not found" };
  if ((m as any).revised_at) return { ok: false, error: "They've already used their one change" };
  const { data: d } = await sb.from("private_settings").select("value").eq("key", "squad_revision_days").maybeSingle();
  const days = Number(d?.value) > 0 ? Number(d?.value) : 7;
  if (Date.parse((m as any).created_at) < Date.now() - days * 86400000) return { ok: false, error: `Changes are only allowed within ${days} days of declaring. Change that in Switches & hours.` };
  const { error } = await sb.from("squad_members").update({ revision_allowed_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  const q = (m as any).squads, first = String((m as any).name || "there").trim().split(" ")[0];
  const emailed = await sendEmail((m as any).email, "You can sharpen your goal",
    `Hi ${first},\n\nAfter our conversation, I've opened your goal for one change.\n\nRight now it reads: "${(m as any).goal}"\n\nRewrite it so it's something within your control, with a number anyone can check. Your deadline stays the same, and your squad will see what it was before.\n\nMake the change here:\n${SITE}/squad/${q.code}?me=${(m as any).token}\n\nGenie`);
  return { ok: true, emailed };
}
async function squadToggle(p: P) {
  const { error } = await sb.from("squads").update({ active: p.active === true }).eq("id", clean(p.id, 60));
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
  for (const k of ["booking_window_days", "mentorship_window_days", "squad_revision_days"]) {
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
  list, cancel, attend, checkin, squad_create: squadCreate, squad_toggle: squadToggle, squad_media_url: squadMediaUrl, squad_set_media: squadSetMedia, squad_allow_revision: squadAllowRevision, free_calls: freeCalls, event_save: eventSave, intake_save: intakeSave, grant_call: grantCall, new_plan: newPlan, save_settings: saveSettings, save_rule: saveRule, add_rule: addRule,
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
