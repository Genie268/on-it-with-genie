import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

const enc = new TextEncoder();

async function deriveKey(): Promise<CryptoKey> {
  const material = enc.encode("oiwg-admin-session:" + SUPABASE_SERVICE_ROLE_KEY);
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signToken(payload: Record<string, unknown>): Promise<string> {
  const key = await deriveKey();
  const payloadB64 = btoa(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return payloadB64 + "." + sigB64;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!pin) return json({ ok: false, error: "missing_pin" }, 400);

  let validPin = "";
  try {
    const { data } = await sb.from("app_settings").select("value").eq("key", "admin_pin").maybeSingle();
    if (data?.value) validPin = data.value;
  } catch {
    return json({ ok: false, error: "db_error" }, 500);
  }

  if (!validPin) return json({ ok: false, error: "no_pin_configured" }, 500);

  if (pin !== validPin) {
    return json({ ok: false, error: "invalid_pin" }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signToken({ iat: now, exp: now + 86400 });

  return json({ ok: true, token, expires_in: 86400 });
});
