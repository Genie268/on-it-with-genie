/*
 * goal-api: the Goal Test at eugeneobo.com/goal.
 *
 * POST {action:"save", goal, answers, score, weakest, source?}   Store a result, returns its id.
 * POST {action:"email", id, email, name?, opt_in, will, by, proof?, first_step?}
 *      Save the sharpened sentence, email it to them (once), add them to contacts.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "Genie <genie@eugeneobo.com>";
const SITE = "https://eugeneobo.com";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const isId = (t: string) => /^[0-9a-f-]{36}$/i.test(t);
const KEYS = ["finish", "date", "control", "time", "first", "proof"];
const TIPS: Record<string, string> = {
  finish: "Put a number on it. If a stranger can't check it, neither can you.",
  date: "Give it a date inside 30 days. A goal with no date is a wish.",
  control: "Make it about what you do, not what other people decide.",
  time: "Block the hours now, or shrink the goal to fit the time you really have.",
  first: "Shrink the first step until you could do it tonight.",
  proof: "Pick proof people can see: a link, a post, a photo.",
};
const niceDate = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

async function sendEmail(to: string, subject: string, text: string) {
  if (!RESEND || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: FROM, to, subject, text }) });
    if (!r.ok) console.error("resend", r.status, await r.text());
    return r.ok;
  } catch (e) { console.error("resend failed", e); return false; }
}

async function save(p: Record<string, unknown>) {
  const goal = clean(p.goal, 300);
  if (goal.length < 3) return json({ ok: false, error: "missing_goal" }, 400);
  const score = Math.round(Number(p.score));
  if (!(score >= 0 && score <= 100)) return json({ ok: false, error: "bad_score" }, 400);
  const a = (p.answers && typeof p.answers === "object") ? p.answers as Record<string, unknown> : {};
  const answers: Record<string, number> = {};
  for (const k of KEYS) { const n = Number(a[k]); if (Number.isInteger(n) && n >= 0 && n <= 5) answers[k] = n; }
  const weakest = KEYS.includes(clean(p.weakest, 20)) ? clean(p.weakest, 20) : null;
  const { data, error } = await sb.from("goal_results").insert({ goal, answers, score, weakest, source: clean(p.source, 30) || null }).select("id").single();
  if (error) { console.error(error); return json({ ok: false, error: "save_failed" }, 500); }
  return json({ ok: true, id: data.id });
}

async function email(p: Record<string, unknown>) {
  const id = clean(p.id, 60), to = clean(p.email, 120).toLowerCase(), name = clean(p.name, 80), optIn = p.opt_in === true;
  if (!isId(id)) return json({ ok: false, error: "bad_id" }, 400);
  if (!validEmail(to)) return json({ ok: false, error: "bad_email" }, 400);
  const will = clean(p.will, 200), by = /^\d{4}-\d{2}-\d{2}$/.test(clean(p.by, 10)) ? clean(p.by, 10) : null;
  const proof = clean(p.proof, 200), firstStep = clean(p.first_step, 200);
  if (will.length < 3) return json({ ok: false, error: "missing_goal" }, 400);
  const { data: row } = await sb.from("goal_results").select("id,score,weakest,emailed_at").eq("id", id).maybeSingle();
  if (!row) return json({ ok: false, error: "not_found" }, 404);
  await sb.from("goal_results").update({ email: to, name: name || null, opted_in: optIn, will, by_date: by, proof: proof || null, first_step: firstStep || null }).eq("id", id);
  const { data: c } = await sb.from("contacts").select("email,opted_in").eq("email", to).maybeSingle();
  const now = new Date().toISOString();
  if (c) await sb.from("contacts").update({ last_source: "goal_test", last_seen: now, ...(name ? { name } : {}), ...(optIn && !c.opted_in ? { opted_in: true, opted_in_at: now } : {}) }).eq("email", to);
  else await sb.from("contacts").insert({ email: to, name: name || null, first_source: "goal_test", last_source: "goal_test", opted_in: optIn, ...(optIn ? { opted_in_at: now } : {}) });
  if (row.emailed_at) return json({ ok: true, already: true });
  const first = (name || "there").split(" ")[0];
  const line = `${by ? `By ${niceDate(by)}, I` : "I"} will ${will.replace(/^i will\s+/i, "")}.`;
  const ok = await sendEmail(to, "Your goal, sharpened",
    `Hi ${first},\n\nHere's the goal you sharpened in the Goal Test:\n\n${line}${proof ? `\nProof: ${proof}` : ""}${firstStep ? `\nFirst step: ${firstStep}` : ""}\n\nYour score: ${row.score}/100.${row.weakest && row.score < 100 ? `\nWatch this: ${TIPS[row.weakest]}` : ""}\n\nSay it out loud to one person today. A goal nobody knows about is easy to drop.\n\nWant a room full of people who'll ask you about it every week? Come to Forward with Genie:\n${SITE}/events\n\nGenie`);
  if (ok) await sb.from("goal_results").update({ emailed_at: now }).eq("id", id);
  return json({ ok: true, emailed: ok });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const p = await req.json().catch(() => ({}));
    if (p.action === "save") return await save(p);
    if (p.action === "email") return await email(p);
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) { console.error(e); return json({ ok: false, error: "server_error" }, 500); }
});
