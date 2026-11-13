// Genie's capture inbox.
// action "unlock": { pin } -> returns the long-lived capture key (checked against admin_pin once per device)
// action "save":   { key, items: [{ client_id, body, captured_at }] } -> saves, ignores repeats
// action "recent": { key } -> last 20 captures
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

async function setting(key: string): Promise<string> {
  const { data } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string) || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_body" }, 400); }

  const action = String(body.action || "");

  if (action === "unlock") {
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    const valid = await setting("admin_pin");
    if (!pin || !valid || pin !== valid) return json({ ok: false, error: "invalid_pin" }, 401);
    return json({ ok: true, key: await setting("capture_key") });
  }

  const key = typeof body.key === "string" ? body.key : "";
  const validKey = await setting("capture_key");
  if (!key || !validKey || key !== validKey) return json({ ok: false, error: "locked" }, 401);

  if (action === "save") {
    const items = Array.isArray(body.items) ? body.items : [];
    const rows = items
      .map((i: any) => ({
        client_id: String(i?.client_id || "").slice(0, 80) || crypto.randomUUID(),
        body: String(i?.body || "").trim().slice(0, 20000),
        captured_at: i?.captured_at && !isNaN(Date.parse(i.captured_at)) ? i.captured_at : new Date().toISOString(),
      }))
      .filter((r) => r.body);
    if (!rows.length) return json({ ok: true, saved: [] });
    const { error } = await sb.from("captures").upsert(rows, { onConflict: "client_id", ignoreDuplicates: true });
    if (error) return json({ ok: false, error: "db_error" }, 500);
    return json({ ok: true, saved: rows.map((r) => r.client_id) });
  }

  if (action === "recent") {
    const { data, error } = await sb.from("captures")
      .select("client_id, body, captured_at, status").order("captured_at", { ascending: false }).limit(20);
    if (error) return json({ ok: false, error: "db_error" }, 500);
    return json({ ok: true, items: data });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
