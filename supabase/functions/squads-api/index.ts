/*
 * squads-api: accountability squads (people who declare a goal together, e.g. at Forward with Genie).
 *
 * GET  ?code=FWG06[&me=TOKEN]          Squad, members' declarations and weekly check-ins (no emails/phones).
 *                                      With a valid token, also "me" (their own row).
 * POST {action:"join", code, name, email, phone, goal, deadline?, proof?, first_step?}
 *                                      Declare (same email again updates the declaration). Returns token.
 * POST {action:"who", code, reg_id}   Registered attendee picks their name: returns first name + registered goal.
 *      join also accepts reg_id instead of name/email/phone (taken from their event registration, and marks them Arrived).
 * POST {action:"start", token, note}   "First 5 minutes" proof at the event.
 * POST {action:"checkin", token, status:"done"|"partly"|"missed", note?}   This week's check-in.
 * POST {action:"upload_url", token, kind:"photo"|"post", type}   Signed upload URL into squad-media/<code>/<member>/...
 * POST {action:"set_photo", token, path}            Profile photo.
 * POST {action:"post", token, text?, photo_path?}   Progress post (text and/or photo). Max 12 a day.
 * POST {action:"cheer", post_id}                    +1 on a post.
 * POST {action:"unpost", token, post_id}            Hide your own post.
 * POST {action:"show_video", token, show}           Show/hide your declaration video on your profile.
 * POST {action:"set_partner", token, partner_id}    Pick a squad member to hold you accountable (they get an email). "" clears it.
 * POST {action:"want_coach", token}                Wants Genie as their coach: tells Genie, client sends them to /app.
 * POST {action:"nudge", token, member_id}          Any squad member nudges another who's gone quiet (email, max once per 12h per person).
 * Declarations lock 24 hours after they're made (EDIT_HOURS): after that "join" with the same email returns "locked".
 * POST {action:"cron", kind:"remind"|"summary"} + x-cron-key
 *      remind  (Fri 6pm Lagos): members who haven't checked in this week
 *      summary (Sat 9am Lagos): Genie gets who checked in and who didn't
 * Weeks run from starts_on: week 1 is starts_on .. starts_on+6.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "Genie <genie@eugeneobo.com>";
const SITE = "https://eugeneobo.com";
const DAY = 86400_000;
const EDIT_HOURS = 24;   // a declaration can be changed for this long, then it's locked
const canEdit = (createdAt: string) => Date.parse(createdAt) > Date.now() - EDIT_HOURS * 3600_000;
const MEDIA = Deno.env.get("SUPABASE_URL") + "/storage/v1/object/public/squad-media/";
const media = (p: string | null) => (p ? MEDIA + p : null);

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const first = (n: string) => (n || "there").trim().split(" ")[0];
const shortName = (n: string) => { const w = String(n || "").trim().split(/\s+/).map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : (w[0] || ""); };
const isToken = (t: string) => /^[0-9a-f-]{36}$/i.test(t);

/* Lagos is UTC+1 all year */
const lagosToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
function weekOf(startsOn: string, today = lagosToday()) {
  const d = Math.floor((Date.parse(today) - Date.parse(startsOn)) / DAY);
  return d < 0 ? 0 : Math.floor(d / 7) + 1;
}
const niceDate = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

async function sendEmail(to: string, subject: string, text: string, extra: Record<string, unknown> = {}) {
  if (!RESEND || !to) return;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: FROM, to, subject, text, ...extra }) });
    if (!r.ok) console.error("resend", r.status, await r.text());
  } catch (err) { console.error("resend failed", err); }
}
async function setting(key: string) {
  const { data } = await sb.from("private_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? "";
}
async function squadBy(code: string) {
  const { data } = await sb.from("squads").select("*").eq("code", code.toUpperCase()).maybeSingle();
  return data;
}
async function memberBy(token: string) {
  if (!isToken(token)) return null;
  const { data } = await sb.from("squad_members").select("*, squads(*)").eq("token", token).maybeSingle();
  return data;
}
const squadLink = (code: string, token?: string) => `${SITE}/squad/${code}${token ? `?me=${token}` : ""}`;

async function view(code: string, me: string) {
  const s = await squadBy(code);
  if (!s) return json({ ok: false, error: "not_found" }, 404);
  const [{ data: mem }, { data: chk }] = await Promise.all([
    sb.from("squad_members").select("id,created_at,name,goal,deadline,proof,first_step,started_at,started_note,token,email,photo_path,video_path,video_cover_path,show_video,partner_id,nudged_at").eq("squad_id", s.id).order("created_at"),
    sb.from("squad_checkins").select("member_id,week,status,note,created_at").eq("squad_id", s.id),
  ]);
  const { data: posts } = await sb.from("squad_posts").select("id,created_at,member_id,text,photo_path,cheers").eq("squad_id", s.id).eq("hidden", false).order("created_at", { ascending: false }).limit(400);
  const byMember: Record<string, Record<number, { status: string; note: string | null }>> = {};
  (chk ?? []).forEach((c: any) => ((byMember[c.member_id] ??= {})[c.week] = { status: c.status, note: c.note }));
  const week = weekOf(s.starts_on);
  const genieEmail = String(await setting("notify_email")).toLowerCase();
  const coach = (mem ?? []).find((m: any) => String(m.email).toLowerCase() === genieEmail);
  // declaration videos live in a private bucket; hand out links that expire in a few hours
  const vpaths = (mem ?? []).filter((m: any) => m.show_video && m.video_path).map((m: any) => m.video_path);
  const signed: Record<string, string> = {};
  if (vpaths.length) { const { data: su } = await sb.storage.from("squad-video").createSignedUrls(vpaths, 4 * 3600); (su ?? []).forEach((x: any) => { if (x.signedUrl) signed[x.path] = x.signedUrl; }); }
  let mine = null;
  const members = (mem ?? []).map((m: any) => {
    if (me && m.token === me) mine = { id: m.id, can_edit: canEdit(m.created_at), name: m.name, email: m.email, goal: m.goal, deadline: m.deadline, proof: m.proof, first_step: m.first_step, started: !!m.started_at, photo: media(m.photo_path), has_video: !!m.video_path, show_video: m.show_video, partner_id: m.partner_id };
    return { id: m.id, name: m.name, goal: m.goal, deadline: m.deadline, proof: m.proof, first_step: m.first_step, started: !!m.started_at, started_note: m.started_note, checkins: byMember[m.id] ?? {}, photo: media(m.photo_path), video: m.show_video && m.video_path ? (signed[m.video_path] ?? null) : null, cover: m.show_video ? media(m.video_cover_path) : null, partner_id: m.partner_id, coach: !!coach && m.id === coach.id, nudged_recently: !!m.nudged_at && Date.parse(m.nudged_at) > Date.now() - 12 * 3600_000 };
  });
  // registered attendees of the linked event who haven't joined yet (first name + initial only)
  let attendees: { id: string; label: string }[] = [];
  if (s.event) {
    const joined = new Set((mem ?? []).map((m: any) => String(m.email).toLowerCase()));
    const { data: regs } = await sb.from("event_registrations").select("id,name,email").eq("event", s.event).is("released_at", null).order("name");
    attendees = (regs ?? []).filter((r: any) => !joined.has(String(r.email).toLowerCase())).map((r: any) => ({ id: r.id, label: shortName(r.name) }));
  }
  return json({ ok: true, attendees, posts: (posts ?? []).map((x: any) => ({ id: x.id, at: x.created_at, member_id: x.member_id, text: x.text, photo: media(x.photo_path), cheers: x.cheers })), squad: { code: s.code, name: s.name, starts_on: s.starts_on, weeks: s.weeks, week, active: s.active, price: s.price, ends_on: new Date(Date.parse(s.starts_on) + s.weeks * 7 * DAY - DAY).toISOString().slice(0, 10), coach: { name: "Genie", photo: coach ? media(coach.photo_path) : null, member_id: coach ? coach.id : null } }, members, me: mine });
}

async function join(p: Record<string, unknown>) {
  const s = await squadBy(clean(p.code, 20));
  if (!s) return json({ ok: false, error: "not_found" }, 404);
  if (!s.active) return json({ ok: false, error: "closed" }, 409);
  let name = clean(p.name, 80), email = clean(p.email, 120).toLowerCase(), phone = clean(p.phone, 30);
  const regId = isToken(clean(p.reg_id, 60)) ? clean(p.reg_id, 60) : "";
  if (regId && s.event) {
    const { data: r } = await sb.from("event_registrations").select("id,name,email,phone").eq("id", regId).eq("event", s.event).maybeSingle();
    if (!r) return json({ ok: false, error: "not_found" }, 404);
    name = r.name.trim().replace(/\s+/g, " "); email = String(r.email).toLowerCase(); phone = r.phone || "";
    await sb.from("event_registrations").update({ checked_in: true, checked_in_at: new Date().toISOString() }).eq("id", r.id).eq("checked_in", false);
  }
  const goal = clean(p.goal, 200), proof = clean(p.proof, 200), firstStep = clean(p.first_step, 200);
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(clean(p.deadline, 10)) ? clean(p.deadline, 10) : null;
  if (!name) return json({ ok: false, error: "missing_name" }, 400);
  if (!validEmail(email)) return json({ ok: false, error: "bad_email" }, 400);
  if (goal.length < 3) return json({ ok: false, error: "missing_goal" }, 400);
  const { data: had } = await sb.from("squad_members").select("id,token,created_at").eq("squad_id", s.id).eq("email", email).maybeSingle();
  if (had && !canEdit(had.created_at)) return json({ ok: false, error: "locked" }, 409);
  const row: Record<string, unknown> = { squad_id: s.id, name, email, phone: phone || null, goal, deadline, proof: proof || null, first_step: firstStep || null, updated_at: new Date().toISOString() };
  if (regId) row.reg_id = regId;
  let token: string;
  if (had) {
    await sb.from("squad_members").update(row).eq("id", had.id);
    token = had.token;
  } else {
    const { data, error } = await sb.from("squad_members").insert(row).select("token").single();
    if (error) { console.error(error); return json({ ok: false, error: "save_failed" }, 500); }
    token = data.token;
    const { data: c } = await sb.from("contacts").select("email").eq("email", email).maybeSingle();
    if (!c) await sb.from("contacts").insert({ email, name, phone: phone || null, first_source: "squad", last_source: "squad", opted_in: false });
    await sendEmail(email, `You're in ${s.name}`,
      `Hi ${first(name)},\n\nYou declared it in front of your squad:\n\n"${goal}"${deadline ? `\nBy ${niceDate(deadline)}` : ""}${proof ? `\nProof it's done: ${proof}` : ""}${firstStep ? `\nFirst step: ${firstStep}` : ""}\n\nYour squad page (keep this link, it's how you check in every week):\n${squadLink(s.code, token)}\n\nEvery Friday you'll get a nudge to check in. Your squad sees who did and who didn't.\n\nGenie`);
  }
  return json({ ok: true, token, updated: !!had });
}

async function who(p: Record<string, unknown>) {
  const s = await squadBy(clean(p.code, 20));
  const regId = clean(p.reg_id, 60);
  if (!s || !s.event || !isToken(regId)) return json({ ok: false, error: "not_found" }, 404);
  const { data: r } = await sb.from("event_registrations").select("name,goal").eq("id", regId).eq("event", s.event).maybeSingle();
  if (!r) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, first: first(shortName(r.name)), goal: r.goal || "" });
}

async function start(p: Record<string, unknown>) {
  const m = await memberBy(clean(p.token, 60));
  if (!m) return json({ ok: false, error: "bad_token" }, 401);
  await sb.from("squad_members").update({ started_at: new Date().toISOString(), started_note: clean(p.note, 200) || null }).eq("id", m.id);
  return json({ ok: true });
}

async function uploadUrl(p: Record<string, unknown>) {
  const m = await memberBy(clean(p.token, 60));
  if (!m) return json({ ok: false, error: "bad_token" }, 401);
  const kind = p.kind === "post" ? "post" : "photo";
  const type = clean(p.type, 40);
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const path = `${m.squads.code}/${m.id}/${kind}-${Date.now()}.${ext}`;
  const { data, error } = await sb.storage.from("squad-media").createSignedUploadUrl(path);
  if (error || !data) { console.error(error); return json({ ok: false, error: "upload_failed" }, 500); }
  return json({ ok: true, url: data.signedUrl, path });
}
const ownsPath = (m: any, path: string, kind: string) => path.startsWith(`${m.squads.code}/${m.id}/${kind}-`) && !path.includes("..");

async function setPhoto(p: Record<string, unknown>) {
  const m = await memberBy(clean(p.token, 60));
  if (!m) return json({ ok: false, error: "bad_token" }, 401);
  const path = clean(p.path, 200);
  if (!ownsPath(m, path, "photo")) return json({ ok: false, error: "bad_path" }, 400);
  await sb.from("squad_members").update({ photo_path: path }).eq("id", m.id);
  return json({ ok: true, photo: media(path) });
}

async function post(p: Record<string, unknown>) {
  const m = await memberBy(clean(p.token, 60));
  if (!m) return json({ ok: false, error: "bad_token" }, 401);
  const text = clean(p.text, 500), path = clean(p.photo_path, 200);
  if (!text && !path) return json({ ok: false, error: "empty" }, 400);
  if (path && !ownsPath(m, path, "post")) return json({ ok: false, error: "bad_path" }, 400);
  const { count } = await sb.from("squad_posts").select("id", { count: "exact", head: true }).eq("member_id", m.id).gte("created_at", new Date(Date.now() - DAY).toISOString());
  if ((count ?? 0) >= 12) return json({ ok: false, error: "too_many" }, 429);
  const { data, error } = await sb.from("squad_posts").insert({ squad_id: m.squad_id, member_id: m.id, text: text || null, photo_path: path || null }).select("id").single();
  if (error) { console.error(error); return json({ ok: false, error: "save_failed" }, 500); }
  return json({ ok: true, id: data.id });
}

async function cheer(p: Record<string, unknown>) {
  const id = clean(p.post_id, 60);
  if (!isToken(id)) return json({ ok: false, error: "bad_post" }, 400);
  const { data, error } = await sb.rpc("squad_cheer", { pid: id });
  if (error) { console.error(error); return json({ ok: false, error: "failed" }, 500); }
  return json({ ok: true, cheers: data });
}

async function unpost(p: Record<string, unknown>) {
  const m = await memberBy(clean(p.token, 60));
  if (!m) return json({ ok: false, error: "bad_token" }, 401);
  await sb.from("squad_posts").update({ hidden: true }).eq("id", clean(p.post_id, 60)).eq("member_id", m.id);
  return json({ ok: true });
}

async function showVideo(p: Record<string, unknown>) {
  const m = await memberBy(clean(p.token, 60));
  if (!m) return json({ ok: false, error: "bad_token" }, 401);
  await sb.from("squad_members").update({ show_video: p.show === true }).eq("id", m.id);
  return json({ ok: true });
}

async function setPartner(p: Record<string, unknown>) {
  const m = await memberBy(clean(p.token, 60));
  if (!m) return json({ ok: false, error: "bad_token" }, 401);
  const pid = clean(p.partner_id, 60);
  if (!pid) { await sb.from("squad_members").update({ partner_id: null, partner_set_at: null }).eq("id", m.id); return json({ ok: true }); }
  if (!isToken(pid) || pid === m.id) return json({ ok: false, error: "bad_partner" }, 400);
  const { data: partner } = await sb.from("squad_members").select("id,name,email,token,squad_id").eq("id", pid).maybeSingle();
  if (!partner || partner.squad_id !== m.squad_id) return json({ ok: false, error: "bad_partner" }, 400);
  if (m.partner_id === pid) return json({ ok: true, already: true });
  await sb.from("squad_members").update({ partner_id: pid, partner_set_at: new Date().toISOString() }).eq("id", m.id);
  await sendEmail(partner.email, `${first(m.name)} wants you to hold them accountable`,
    `Hi ${first(partner.name)},\n\n${m.name} in ${m.squads.name} picked you to hold them accountable.\n\nTheir goal: "${m.goal}"${m.deadline ? `\nBy ${niceDate(m.deadline)}` : ""}\n\nYou'll see their check-ins on your squad page, and you can send them a nudge when they go quiet:\n${squadLink(m.squads.code, partner.token)}\n\nGenie`);
  return json({ ok: true });
}

async function wantCoach(p: Record<string, unknown>) {
  const m = await memberBy(clean(p.token, 60));
  if (!m) return json({ ok: false, error: "bad_token" }, 401);
  const firstTime = !m.wants_coach_at;
  await sb.from("squad_members").update({ wants_coach_at: new Date().toISOString() }).eq("id", m.id);
  const to = await setting("notify_email");
  if (to && firstTime) await sendEmail(to, `${m.name} wants you to hold them accountable`,
    `${m.name} (${m.squads.name}) tapped "Genie holds me accountable" and was sent to the challenge.\n\nGoal: "${m.goal}"${m.deadline ? ` by ${niceDate(m.deadline)}` : ""}\nEmail: ${m.email}\nPhone: ${m.phone || "-"}\n\nIf they don't pay in a day or two, reach out.`, { reply_to: m.email });
  return json({ ok: true });
}

async function nudge(p: Record<string, unknown>) {
  const me = await memberBy(clean(p.token, 60));
  if (!me) return json({ ok: false, error: "bad_token" }, 401);
  const { data: t } = await sb.from("squad_members").select("id,name,email,goal,token,partner_id,nudged_at,squad_id").eq("id", clean(p.member_id, 60)).maybeSingle();
  if (!t || t.squad_id !== me.squad_id || t.id === me.id) return json({ ok: false, error: "not_in_squad" }, 403);
  if (t.nudged_at && Date.parse(t.nudged_at) > Date.now() - 12 * 3600_000) return json({ ok: false, error: "too_soon" }, 429);
  await sb.from("squad_members").update({ nudged_at: new Date().toISOString() }).eq("id", t.id);
  await sendEmail(t.email, `${first(me.name)} is checking on you`,
    `Hi ${first(t.name)},\n\n${first(me.name)} from ${me.squads.name} is checking on you. How is this going?\n\n"${t.goal}"\n\nPost what you did today (a line or a photo) so your squad can see it:\n${squadLink(me.squads.code, t.token)}\n\nGenie`, { reply_to: me.email });
  return json({ ok: true });
}

async function checkin(p: Record<string, unknown>) {
  const m = await memberBy(clean(p.token, 60));
  if (!m) return json({ ok: false, error: "bad_token" }, 401);
  const s = m.squads;
  const status = String(p.status);
  if (!["done", "partly", "missed"].includes(status)) return json({ ok: false, error: "bad_status" }, 400);
  let week = weekOf(s.starts_on);
  if (week < 1) week = 1;
  if (week > s.weeks) return json({ ok: false, error: "over" }, 409);
  const { error } = await sb.from("squad_checkins").upsert({ squad_id: s.id, member_id: m.id, week, status, note: clean(p.note, 300) || null, created_at: new Date().toISOString() }, { onConflict: "member_id,week" });
  if (error) { console.error(error); return json({ ok: false, error: "save_failed" }, 500); }
  return json({ ok: true, week });
}

async function cron(req: Request, kind: string) {
  const key = await setting("cron_key");
  if (!key || req.headers.get("x-cron-key") !== key) return new Response("forbidden", { status: 403 });
  const { data: squads } = await sb.from("squads").select("*").eq("active", true);
  const out: Record<string, number> = { reminded: 0, summaries: 0 };
  const genie = await setting("notify_email");
  for (const s of squads ?? []) {
    // Friday reminder is for the week ending tomorrow; Saturday summary is for the week that just ended
    const week = kind === "summary" ? weekOf(s.starts_on, new Date(Date.now() + 3600_000 - DAY).toISOString().slice(0, 10)) : weekOf(s.starts_on);
    if (week < 1 || week > s.weeks) continue;
    const [{ data: mem }, { data: chk }] = await Promise.all([
      sb.from("squad_members").select("id,name,email,goal,token").eq("squad_id", s.id),
      sb.from("squad_checkins").select("member_id,status,note").eq("squad_id", s.id).eq("week", week),
    ]);
    const done: Record<string, any> = {}; (chk ?? []).forEach((c: any) => (done[c.member_id] = c));
    if (kind === "remind") {
      for (const m of mem ?? []) {
        if (done[m.id]) continue;
        await sendEmail(m.email, `${s.name}: week ${week} check-in`,
          `Hi ${first(m.name)},\n\nWeek ${week} closes tonight. Your squad will see whether you checked in.\n\nYour goal: "${m.goal}"\n\nCheck in here (takes 20 seconds, be honest):\n${squadLink(s.code, m.token)}\n\nGenie`);
        out.reminded++;
      }
    } else if (genie && (mem ?? []).length) {
      const label = (st: string) => (st === "done" ? "Done" : st === "partly" ? "Partly" : "Missed");
      const lines = (mem ?? []).map((m: any) => `${done[m.id] ? label(done[m.id].status) : "No check-in"}: ${m.name}${done[m.id]?.note ? ` ("${done[m.id].note}")` : ""}`);
      const n = Object.keys(done).length;
      await sendEmail(genie, `${s.name}, week ${week}: ${n} of ${(mem ?? []).length} checked in`,
        `${s.name}, week ${week} of ${s.weeks}\n\n${lines.join("\n")}\n\nWall: ${SITE}/squad/${s.code}?wall=1`);
      out.summaries++;
    }
  }
  return json({ ok: true, ...out });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      return await view(clean(u.searchParams.get("code"), 20), clean(u.searchParams.get("me"), 60));
    }
    const p = await req.json().catch(() => ({}));
    switch (p.action) {
      case "join": return await join(p);
      case "who": return await who(p);
      case "start": return await start(p);
      case "checkin": return await checkin(p);
      case "upload_url": return await uploadUrl(p);
      case "set_photo": return await setPhoto(p);
      case "post": return await post(p);
      case "cheer": return await cheer(p);
      case "unpost": return await unpost(p);
      case "show_video": return await showVideo(p);
      case "set_partner": return await setPartner(p);
      case "want_coach": return await wantCoach(p);
      case "nudge": return await nudge(p);
      case "cron": return await cron(req, String(p.kind));
      default: return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
