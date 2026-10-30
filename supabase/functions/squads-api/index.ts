/*
 * squads-api: accountability squads (people who declare a goal together, e.g. at Forward with Genie).
 *
 * GET  ?code=FWG06[&me=TOKEN]          Squad, members' declarations and weekly check-ins (no emails/phones).
 *                                      With a valid token, also "me" (their own row).
 * POST {action:"join", code, name, email, phone, goal, deadline?, proof?, first_step?}
 *                                      Declare (same email again updates the declaration). Returns token.
 * POST {action:"start", token, note}   "First 5 minutes" proof at the event.
 * POST {action:"checkin", token, status:"done"|"partly"|"missed", note?}   This week's check-in.
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

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const first = (n: string) => (n || "there").trim().split(" ")[0];
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
    sb.from("squad_members").select("id,created_at,name,goal,deadline,proof,first_step,started_at,started_note,token,email").eq("squad_id", s.id).order("created_at"),
    sb.from("squad_checkins").select("member_id,week,status,note,created_at").eq("squad_id", s.id),
  ]);
  const byMember: Record<string, Record<number, { status: string; note: string | null }>> = {};
  (chk ?? []).forEach((c: any) => ((byMember[c.member_id] ??= {})[c.week] = { status: c.status, note: c.note }));
  const week = weekOf(s.starts_on);
  let mine = null;
  const members = (mem ?? []).map((m: any) => {
    if (me && m.token === me) mine = { id: m.id, name: m.name, email: m.email, goal: m.goal, deadline: m.deadline, proof: m.proof, first_step: m.first_step, started: !!m.started_at };
    return { id: m.id, name: m.name, goal: m.goal, deadline: m.deadline, proof: m.proof, first_step: m.first_step, started: !!m.started_at, started_note: m.started_note, checkins: byMember[m.id] ?? {} };
  });
  return json({ ok: true, squad: { code: s.code, name: s.name, starts_on: s.starts_on, weeks: s.weeks, week, active: s.active, ends_on: new Date(Date.parse(s.starts_on) + s.weeks * 7 * DAY - DAY).toISOString().slice(0, 10) }, members, me: mine });
}

async function join(p: Record<string, unknown>) {
  const s = await squadBy(clean(p.code, 20));
  if (!s) return json({ ok: false, error: "not_found" }, 404);
  if (!s.active) return json({ ok: false, error: "closed" }, 409);
  const name = clean(p.name, 80), email = clean(p.email, 120).toLowerCase(), phone = clean(p.phone, 30);
  const goal = clean(p.goal, 200), proof = clean(p.proof, 200), firstStep = clean(p.first_step, 200);
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(clean(p.deadline, 10)) ? clean(p.deadline, 10) : null;
  if (!name) return json({ ok: false, error: "missing_name" }, 400);
  if (!validEmail(email)) return json({ ok: false, error: "bad_email" }, 400);
  if (goal.length < 3) return json({ ok: false, error: "missing_goal" }, 400);
  const { data: had } = await sb.from("squad_members").select("id,token").eq("squad_id", s.id).eq("email", email).maybeSingle();
  const row = { squad_id: s.id, name, email, phone: phone || null, goal, deadline, proof: proof || null, first_step: firstStep || null, updated_at: new Date().toISOString() };
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

async function start(p: Record<string, unknown>) {
  const m = await memberBy(clean(p.token, 60));
  if (!m) return json({ ok: false, error: "bad_token" }, 401);
  await sb.from("squad_members").update({ started_at: new Date().toISOString(), started_note: clean(p.note, 200) || null }).eq("id", m.id);
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
      case "start": return await start(p);
      case "checkin": return await checkin(p);
      case "cron": return await cron(req, String(p.kind));
      default: return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
