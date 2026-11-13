/*
 * capture-organize: runs every minute (pg_cron); Groq sorting only every 5 minutes or when the app asks. Works with no Claude involved.
 * 1. New captures -> Groq gives each a title, kind, 2-3 directions, a next step, minutes and energy.
 * 2. Each one is placed inside a matching block of Genie's day (app_settings.capture_routine),
 *    following app_settings.capture_plan (which block per kind, max items per block).
 * 3. Heads-up pushes 30 minutes and 3 minutes before a block that has captures (never a jolt at the start).
 * 4. Anything not marked done moves to the next free block (nudges + 1).
 * 5. Nightly summary of what's still open.
 * Requires header x-cron-key matching private_settings.cron_key.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const GROQ = Deno.env.get("GROQ_API_KEY") || "";
const VAPID_PUB = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIV = Deno.env.get("VAPID_PRIVATE_KEY") || "";
if (VAPID_PUB && VAPID_PRIV) webpush.setVapidDetails("mailto:oboeugene@gmail.com", VAPID_PUB, VAPID_PRIV);

const LAGOS = 3600_000; // UTC+1, no daylight saving
const KINDS = ["book", "video", "site", "business", "event", "task", "personal", "other"];
type Block = { s: string; e: string; k: string; t: string };

async function settings(keys: string[], table = "app_settings") {
  const { data } = await sb.from(table).select("key,value").in("key", keys);
  const o: Record<string, string> = {};
  (data ?? []).forEach((r: any) => (o[r.key] = r.value));
  return o;
}

function blockStart(dayUtcMidnightLagos: number, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return dayUtcMidnightLagos + (h * 60 + m) * 60_000 - LAGOS;
}

// Find the next block of the right kind that has room. Returns ISO start + label.
function findSlot(kind: string, routine: any, plan: any, taken: Map<string, number>, notBefore: number) {
  const want = plan[kind] || plan.other || "prep";
  const per = Number((plan.limits || {})[kind] ?? plan.per_block) || 2;
  const lagosNow = new Date(notBefore + LAGOS);
  const day0 = Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate());
  for (let d = 0; d < 14; d++) {
    const day = day0 + d * 86400_000;
    const list: Block[] = (new Date(day).getUTCDay() === 0 ? routine.sunday : routine.weekday) || [];
    const onePerDay = (plan.one_per_day || []).includes(kind) || (plan.one_per_day || []).includes(want);
    let seen = false;
    for (const b of list) {
      if (b.k !== want || !b.s) continue;
      if (onePerDay && seen) break;
      seen = true;
      const start = blockStart(day, b.s);
      if (start < notBefore) continue;
      const iso = new Date(start).toISOString();
      const n = taken.get(iso) || 0;
      if (n < per) { taken.set(iso, n + 1); return { iso, label: b.t }; }
    }
  }
  return null;
}

async function askGroq(items: Array<Record<string, string>>) {
  if (!GROQ) return null;
  const system = `You organize voice captures for Genie (Eugene Obo), a personal development coach, TikTok creator and founder in Abuja, Nigeria.
His areas: book ("The Doing Thinker", about self-education in the age of AI), video (TikTok and podcast content ideas), site (his platform eugeneobo.com and its features), business (offers, clients, money, partnerships), event (Forward with Genie in-person events), task (errands and to-dos), personal (relationships, home, health habits), other.
If a capture has kind_from_genie, he told you what it is about: use that kind. For each capture return JSON. Write in plain, sharp English a Nigerian reader understands. No hype, no motivational fluff, no em dashes.
- title: 3 to 7 words
- kind: one of ${KINDS.join(", ")}
- directions: 2 or 3 concrete ways he could take this further (for a video idea: angles or hooks; for a task: just the steps). One sentence each.
- next_step: the very first physical action, under 15 words
- minutes: honest estimate for the next step (5 to 90)
- energy: low, medium or high
- needs_time: false only if it is pure reference with nothing to do
- For kind "video" only, also: suggestions (never a script; he writes his own). Give 3 short hook options built from his own words, then 2 or 3 points he made that are worth keeping, quoted as he said them. Plain text, one per line.
Return {"items":[{"id":...,"title":...,"kind":...,"directions":[...],"next_step":...,"minutes":...,"energy":...,"needs_time":...,"suggestions":...}]}`;
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ}` },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      response_format: { type: "json_object" },
      max_tokens: 4000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(items) },
      ],
    }),
  });
  const j = await r.json().catch(() => null);
  const text = j?.choices?.[0]?.message?.content;
  if (!text) { console.error("groq", JSON.stringify(j)?.slice(0, 300)); return null; }
  try { return JSON.parse(text).items as any[]; } catch { return null; }
}

async function push(title: string, body: string, url = "/capture?tab=plan") {
  if (!VAPID_PUB || !VAPID_PRIV) return 0;
  const { data: subs } = await sb.from("capture_push").select("*");
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, url, tag: "capture-" + Date.now() }));
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("capture_push").delete().eq("endpoint", s.endpoint);
    }
  }
  return sent;
}

const fmt = (iso: string) => new Date(new Date(iso).getTime() + LAGOS).toISOString().slice(11, 16);

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const priv = await settings(["cron_key"], "private_settings");
  let body: any = {};
  try { body = await req.json(); } catch { /* cron sends {} */ }
  // the capture page can ask for an immediate run right after saving, using its own key
  const app = await settings(["capture_routine", "capture_plan", "capture_key", "capture_last_summary"]);
  const okCron = priv.cron_key && req.headers.get("x-cron-key") === priv.cron_key;
  const okApp = app.capture_key && body?.key === app.capture_key;
  if (!okCron && !okApp) return new Response("forbidden", { status: 403, headers: CORS });

  const routine = JSON.parse(app.capture_routine || "{}");
  const plan = JSON.parse(app.capture_plan || "{}");
  const now = Date.now();
  const log: Record<string, number> = { organized: 0, scheduled: 0, rolled: 0, pushed: 0 };

  // current load per block, so we never overfill one
  const { data: booked } = await sb.from("captures").select("scheduled_for").eq("status", "scheduled")
    .gte("scheduled_for", new Date(now - 86400_000).toISOString());
  const taken = new Map<string, number>();
  (booked ?? []).forEach((r: any) => {
    const k = new Date(r.scheduled_for).toISOString();
    taken.set(k, (taken.get(k) || 0) + 1);
  });

  // 1 + 2. organize and place new captures (cron: every 5 minutes; the app can ask right after a save)
  const sortNow = okApp || new Date(now).getUTCMinutes() % 5 === 0;
  const { data: fresh } = !sortNow ? { data: [] as any[] } : await sb.from("captures").select("id, body, captured_at, user_kind").eq("status", "new")
    .order("captured_at").limit(12);
  if (fresh?.length) {
    const out = (await askGroq(fresh.map((f: any) => ({ id: f.id, body: f.body, ...(f.user_kind ? { kind_from_genie: f.user_kind } : {}) })))) || [];
    const byId = new Map(out.map((o: any) => [String(o.id), o]));
    for (const f of fresh as any[]) {
      const o: any = byId.get(f.id);
      const aiOk = !!o;
      const kind = f.user_kind && KINDS.includes(f.user_kind) ? f.user_kind : (aiOk && KINDS.includes(o.kind) ? o.kind : "other");
      const patch: any = {
        kind,
        title: aiOk ? String(o.title || "").slice(0, 120) : f.body.slice(0, 60),
        directions: aiOk && Array.isArray(o.directions) ? o.directions.slice(0, 3) : null,
        next_step: aiOk ? String(o.next_step || "").slice(0, 200) : null,
        minutes: aiOk ? Math.max(5, Math.min(120, Number(o.minutes) || 15)) : null,
        energy: aiOk && ["low", "medium", "high"].includes(o.energy) ? o.energy : null,
        organized_by: aiOk ? "groq" : "none",
      };
      if (aiOk && kind === "video" && o.suggestions) patch.suggestions = String(o.suggestions).slice(0, 2000);
      // if Groq is down, leave it for the next run unless it has waited over an hour
      if (!aiOk && GROQ && now - new Date(f.captured_at).getTime() < 3600_000) continue;
      // book captures are raw material for the book catalog, not tasks: park them
      if ((aiOk && o.needs_time === false) || kind === "book") {
        patch.status = "sorted";
      } else {
        const slot = findSlot(kind, routine, plan, taken, now + 35 * 60_000);
        if (slot) { patch.status = "scheduled"; patch.scheduled_for = slot.iso; patch.block_label = slot.label; patch.warned_at = null; log.scheduled++; }
        else patch.status = "sorted";
      }
      await sb.from("captures").update(patch).eq("id", f.id);
      log.organized++;
    }
  }

  if (plan.reminders_on === false) return Response.json({ ok: true, ...log, reminders: "off" }, { headers: CORS });

  // 4. roll over anything reminded but not done within 2 hours of its block
  const { data: missed } = await sb.from("captures").select("id, kind, nudges")
    .eq("status", "scheduled").not("notified_at", "is", null)
    .lt("scheduled_for", new Date(now - 2 * 3600_000).toISOString());
  for (const m of missed ?? []) {
    const slot = findSlot(m.kind || "other", routine, plan, taken, now + 35 * 60_000);
    if (!slot) continue;
    await sb.from("captures").update({ scheduled_for: slot.iso, block_label: slot.label, notified_at: null, warned_at: null, nudges: (m.nudges || 0) + 1 }).eq("id", m.id);
    log.rolled++;
  }

  // 3. ease him in: heads-up 30 minutes before, then 3 minutes before. Grouped per block.
  const pushGroup = async (rows: any[], stage: "30" | "3") => {
    const groups = new Map<string, any[]>();
    rows.forEach((d: any) => { const k = d.scheduled_for; groups.set(k, [...(groups.get(k) || []), d]); });
    for (const [at, items] of groups) {
      const mins = Math.max(1, Math.round((new Date(at).getTime() - now) / 60_000));
      const block = items[0].block_label ? items[0].block_label.split(":")[0] : "Next block";
      const lead = stage === "30" ? `In ${mins} minutes · ${block}` : `Starting in ${mins} minute${mins === 1 ? "" : "s"} · ${block}`;
      const lines = items.map((i) => {
        const t = i.title || i.body.slice(0, 60);
        if (i.nudges >= 3) return `${t}. This keeps moving: do it or drop it.`;
        if (stage === "30") return i.script || i.suggestions ? `${t}. Your notes are in Capture.` : `${t}. First step: ${i.next_step || "open Capture"}.`;
        return i.next_step ? `${t}. ${i.next_step}` : t;
      });
      log.pushed += await push(lead, lines.join("\n"), "/capture?tab=plan");
      await sb.from("captures").update(stage === "30" ? { warned_at: new Date().toISOString() } : { notified_at: new Date().toISOString(), warned_at: new Date().toISOString() }).in("id", items.map((i) => i.id));
    }
  };
  const cols = "id, title, body, scheduled_for, block_label, nudges, next_step, script, suggestions";
  // 3 minutes before (also catches anything placed at short notice)
  const { data: soon } = await sb.from("captures").select(cols).eq("status", "scheduled").is("notified_at", null)
    .lte("scheduled_for", new Date(now + 3.5 * 60_000).toISOString())
    .gte("scheduled_for", new Date(now - 2 * 3600_000).toISOString());
  await pushGroup(soon ?? [], "3");
  // 30 minutes before (skip if it's already inside the last few minutes)
  const { data: heads } = await sb.from("captures").select(cols).eq("status", "scheduled").is("warned_at", null).is("notified_at", null)
    .lte("scheduled_for", new Date(now + 30.5 * 60_000).toISOString())
    .gt("scheduled_for", new Date(now + 6 * 60_000).toISOString());
  await pushGroup(heads ?? [], "30");

  // 5. nightly summary
  const lagos = new Date(now + LAGOS);
  const hm = lagos.toISOString().slice(11, 16);
  const today = lagos.toISOString().slice(0, 10);
  const at = plan.nightly_summary || "21:55";
  if (hm >= at && hm < "23:59" && app.capture_last_summary !== today) {
    const { data: open } = await sb.from("captures").select("title, scheduled_for")
      .eq("status", "scheduled").order("scheduled_for").limit(50);
    const { count: ideas } = await sb.from("captures").select("id", { count: "exact", head: true }).eq("status", "sorted");
    const next = (open ?? [])[0];
    const msg = `${open?.length || 0} open, ${ideas || 0} parked ideas.` + (next ? ` First up: ${next.title} at ${fmt(next.scheduled_for)}.` : "");
    log.pushed += await push("Tonight's captures", msg);
    await sb.from("app_settings").upsert({ key: "capture_last_summary", value: today });
  }

  return Response.json({ ok: true, ...log }, { headers: CORS });
});
