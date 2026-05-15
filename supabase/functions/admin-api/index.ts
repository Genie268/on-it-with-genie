import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET") ?? "";
const PUSH_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/send-push`;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/* ── Token verification ─────────────────────────────────────────────── */

const enc = new TextEncoder();

async function deriveKey(): Promise<CryptoKey> {
  const material = enc.encode("oiwg-admin-session:" + SUPABASE_SERVICE_ROLE_KEY);
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function verifyToken(token: string): Promise<boolean> {
  if (!token || !token.includes(".")) return false;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return false;
  try {
    const key = await deriveKey();
    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payloadB64));
    if (!valid) return false;
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && payload.exp < Date.now() / 1000) return false;
    return true;
  } catch {
    return false;
  }
}

/* ── Action handlers ────────────────────────────────────────────────── */

type P = Record<string, unknown>;

async function loadData() {
  const { data: challengers } = await sb.from("challengers").select("*").order("created_at", { ascending: false });
  if (!challengers?.length) return { ok: true, challengers: [], uploads: [], energy_logs: [] };
  const ids = challengers.map((c: P) => c.id);
  const { data: uploads } = await sb.from("uploads").select("*").in("challenger_id", ids);
  const { data: energy_logs } = await sb.from("energy_logs").select("*").in("challenger_id", ids);
  const { data: daily_plans } = await sb.from("daily_plans").select("*").in("challenger_id", ids);
  return { ok: true, challengers, uploads: uploads ?? [], energy_logs: energy_logs ?? [], daily_plans: daily_plans ?? [] };
}

async function loadMessages() {
  const { data: msgs } = await sb.from("chat_messages").select("*").order("created_at", { ascending: false }).limit(50);
  const { data: unread } = await sb.from("chat_messages").select("id,challenger_id").eq("sender", "challenger").is("read_at", null);
  return { ok: true, messages: msgs ?? [], unread: unread ?? [] };
}

async function getThread(p: P) {
  const uid = p.challenger_id as string;
  if (!uid) return { ok: false, error: "missing_challenger_id" };
  const { data: msgs } = await sb.from("chat_messages").select("*").eq("challenger_id", uid).order("created_at", { ascending: true });
  return { ok: true, messages: msgs ?? [] };
}

async function sendMessage(p: P) {
  const uid = p.challenger_id as string;
  const message = (p.message as string) ?? "";
  const voice_url = (p.voice_url as string) || null;
  const reply_to_id = (p.reply_to_id as string) || null;
  if (!uid) return { ok: false, error: "missing_challenger_id" };
  const { error } = await sb.from("chat_messages").insert({
    challenger_id: uid, sender: "genie", message, voice_url, reply_to_id,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function markRead(p: P) {
  const uid = p.challenger_id as string;
  if (!uid) return { ok: false, error: "missing_challenger_id" };
  await sb.from("chat_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("challenger_id", uid)
    .eq("sender", "challenger")
    .is("read_at", null);
  return { ok: true };
}

async function deleteMsg(p: P) {
  const id = p.message_id as string;
  if (!id) return { ok: false, error: "missing_message_id" };
  await sb.from("chat_messages").delete().eq("id", id);
  return { ok: true };
}

async function changePin(p: P) {
  const newPin = typeof p.new_pin === "string" ? p.new_pin.trim() : "";
  if (!newPin || newPin.length < 4) return { ok: false, error: "pin_too_short" };
  await sb.from("app_settings").upsert({ key: "admin_pin", value: newPin }, { onConflict: "key" });
  return { ok: true };
}

async function loadCodes() {
  const { data } = await sb.from("access_codes").select("*").order("created_at", { ascending: false });
  return { ok: true, codes: data ?? [] };
}

async function createCode(p: P) {
  const code = typeof p.code === "string" ? p.code.trim().toUpperCase() : "";
  const pct = typeof p.discount_percent === "number" ? p.discount_percent : -1;
  const maxUses = typeof p.max_uses === "number" ? p.max_uses : 0;
  if (!code) return { ok: false, error: "missing_code" };
  if (pct < 0 || pct > 100) return { ok: false, error: "invalid_discount" };
  const { error } = await sb.from("access_codes").insert({ code, discount_percent: pct, max_uses: maxUses, times_used: 0, active: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function toggleCode(p: P) {
  const id = p.id as string;
  const active = p.active as boolean;
  if (!id) return { ok: false, error: "missing_id" };
  await sb.from("access_codes").update({ active: !active }).eq("id", id);
  return { ok: true };
}

async function deleteCode(p: P) {
  const id = p.id as string;
  if (!id) return { ok: false, error: "missing_id" };
  await sb.from("access_codes").delete().eq("id", id);
  return { ok: true };
}

async function toggleReviewed(p: P) {
  const uid = p.challenger_id as string;
  const dayNum = p.day_number as number;
  if (!uid || !dayNum) return { ok: false, error: "missing_params" };
  const { data: existing } = await sb.from("uploads").select("id,reviewed").eq("challenger_id", uid).eq("day_number", dayNum).single();
  if (!existing) return { ok: false, error: "upload_not_found" };
  const newState = !existing.reviewed;
  await sb.from("uploads").update({ reviewed: newState, reviewed_at: new Date().toISOString() }).eq("id", existing.id);
  return { ok: true, reviewed: newState };
}

async function markAllReviewed(p: P) {
  const items = p.items as Array<{ challenger_id: string; day_number: number }>;
  if (!items?.length) return { ok: true, count: 0 };
  let count = 0;
  for (const item of items) {
    try {
      const { data } = await sb.from("uploads").select("id").eq("challenger_id", item.challenger_id).eq("day_number", item.day_number).single();
      if (data) {
        await sb.from("uploads").update({ reviewed: true, reviewed_at: new Date().toISOString() }).eq("id", data.id);
        count++;
      }
    } catch { /* skip */ }
  }
  return { ok: true, count };
}

async function deleteChallenger(p: P) {
  const uid = p.challenger_id as string;
  if (!uid) return { ok: false, error: "missing_challenger_id" };
  const tables = ["uploads", "energy_logs", "chat_messages", "push_subscriptions", "genie_messages", "daily_plans"];
  for (const t of tables) {
    await sb.from(t).delete().eq("challenger_id", uid);
  }
  await sb.from("challengers").delete().eq("id", uid);
  return { ok: true };
}

async function deleteFree() {
  const { data: challengers } = await sb.from("challengers").select("id,payment_status");
  const free = (challengers ?? []).filter((c: P) =>
    c.payment_status === "free" || c.payment_status === null || c.payment_status === "pending"
  );
  let deleted = 0;
  for (const c of free) {
    const uid = c.id as string;
    const tables = ["uploads", "energy_logs", "chat_messages", "push_subscriptions", "genie_messages", "daily_plans"];
    for (const t of tables) {
      await sb.from(t).delete().eq("challenger_id", uid);
    }
    await sb.from("challengers").delete().eq("id", uid);
    deleted++;
  }
  return { ok: true, deleted, total: free.length };
}

async function loadAnalytics() {
  const { data } = await sb.from("analytics_events").select("event_type,event_data,created_at").order("created_at", { ascending: false }).limit(500);
  return { ok: true, events: data ?? [] };
}

async function healthCheck() {
  const tables = ["challengers", "uploads", "chat_messages", "analytics_events"];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { count } = await sb.from(t).select("*", { count: "exact", head: true });
    counts[t] = count ?? 0;
  }
  let storageFiles = 0;
  try {
    const { data: folders } = await sb.storage.from("uploads").list("", { limit: 100 });
    if (folders) {
      for (const f of folders) {
        if (f.id) { storageFiles++; continue; }
        const { data: files } = await sb.storage.from("uploads").list(f.name, { limit: 500 });
        storageFiles += (files ?? []).length;
      }
    }
  } catch { /* ignore */ }
  return { ok: true, counts, storageFiles };
}

async function sendPush(p: P) {
  if (!ADMIN_SECRET) return { ok: false, error: "push_not_configured" };
  const payload: P = {
    type: p.push_type ?? "personal",
    title: p.title ?? "",
    body: p.body ?? "",
    url: "/",
  };
  if (p.challenger_id) payload.challenger_id = p.challenger_id;
  try {
    const res = await fetch(PUSH_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ADMIN_SECRET}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: "push_failed" };
  }
}

/* ── Router ─────────────────────────────────────────────────────────── */

const ACTIONS: Record<string, (p: P) => Promise<P>> = {
  load_data: loadData,
  load_messages: loadMessages,
  get_thread: getThread,
  send_message: sendMessage,
  mark_read: markRead,
  delete_message: deleteMsg,
  change_pin: changePin,
  load_codes: loadCodes,
  create_code: createCode,
  toggle_code: toggleCode,
  delete_code: deleteCode,
  toggle_reviewed: toggleReviewed,
  mark_all_reviewed: markAllReviewed,
  delete_challenger: deleteChallenger,
  delete_free: deleteFree,
  load_analytics: loadAnalytics,
  health_check: healthCheck,
  send_push: sendPush,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: P;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const token = typeof body.token === "string" ? body.token : "";
  const action = typeof body.action === "string" ? body.action : "";

  if (!token) return json({ ok: false, error: "missing_token" }, 401);
  if (!action) return json({ ok: false, error: "missing_action" }, 400);

  const valid = await verifyToken(token);
  if (!valid) return json({ ok: false, error: "invalid_or_expired_token" }, 401);

  const handler = ACTIONS[action];
  if (!handler) return json({ ok: false, error: "unknown_action" }, 400);

  try {
    const result = await handler(body);
    const status = result.ok ? 200 : 400;
    return json(result, status);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message ?? "internal_error" }, 500);
  }
});
