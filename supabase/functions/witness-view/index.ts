// witness-view — the page a witness lands on from their invite link.
// Unauthenticated: the caller only has an invite_token. Runs with the
// service role so we expose EXACTLY the signal a witness is allowed to see
// (whether the person showed up each day, their streak, and — only for
// on-platform "proof" witnesses — the proof thumbnails). Never notes,
// never the challenger's contact details, never review content.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function dayNumber(startDate: string, dur: number): number {
  const start = new Date(startDate);
  const days = Math.floor((Date.now() - start.getTime()) / 86400000) + 1;
  return Math.max(1, Math.min(dur, days));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const action = typeof body.action === "string" ? body.action : "get";
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const { data: w } = await sb.from("witnesses")
      .select("id, challenger_id, witness_email, depth, status")
      .eq("invite_token", token).single();
    if (!w) return json({ ok: false, error: "not_found" }, 404);
    if (w.status === "revoked") return json({ ok: false, error: "revoked" }, 410);

    // Accept / decline just flip status (only from pending) and return fresh state.
    if (action === "accept" || action === "decline") {
      const next = action === "accept" ? "accepted" : "declined";
      if (w.status === "pending") {
        await sb.from("witnesses")
          .update({ status: next, responded_at: new Date().toISOString() })
          .eq("id", w.id);
        w.status = next;
      }
    }

    const { data: c } = await sb.from("challengers")
      .select("name, start_date, duration, status")
      .eq("id", w.challenger_id).single();
    if (!c) return json({ ok: false, error: "challenger_gone" }, 404);

    const dur = c.duration || 15;
    const dayToday = c.start_date ? dayNumber(c.start_date, dur) : 1;
    const seesProof = w.depth === "proof";

    // Uploads for this challenger. Signal witnesses get a boolean per day;
    // proof witnesses also get one thumbnail per day.
    const { data: ups } = await sb.from("uploads")
      .select("day_number, file_url")
      .eq("challenger_id", w.challenger_id);
    const upByDay: Record<number, { up: boolean; fileUrl: string | null }> = {};
    for (const u of ups ?? []) {
      const d = u.day_number as number;
      if (!upByDay[d]) upByDay[d] = { up: true, fileUrl: null };
      if (seesProof && u.file_url && !upByDay[d].fileUrl) upByDay[d].fileUrl = u.file_url;
    }

    const days: Array<{ n: number; state: string; fileUrl: string | null }> = [];
    let uploaded = 0;
    for (let n = 1; n <= dur; n++) {
      const hit = !!upByDay[n];
      if (hit) uploaded++;
      let state = "future";
      if (hit) state = "up";
      else if (n < dayToday) state = "miss";
      else if (n === dayToday) state = "today";
      days.push({ n, state, fileUrl: hit ? (upByDay[n].fileUrl || null) : null });
    }
    // Streak: consecutive uploaded days ending at the last elapsed day.
    let streak = 0;
    for (let n = dayToday; n >= 1; n--) {
      if (upByDay[n]) streak++;
      else if (n < dayToday) break; // today not-yet-uploaded doesn't break it
    }

    return json({
      ok: true,
      witness: { status: w.status, depth: w.depth, email: w.witness_email },
      challenger: { name: c.name || "Someone", day: dayToday, dur, finished: c.status === "completed" || dayToday >= dur },
      stats: { uploaded, streak, seesProof },
      days,
    });
  } catch (_e) {
    return json({ ok: false, error: "bad_request" }, 400);
  }
});
