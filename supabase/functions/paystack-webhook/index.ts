/*
 * paystack-webhook: Paystack calls this when a payment succeeds.
 *
 * It confirms the payment even if the person closed the page before it
 * finished (most common with bank transfers, which can take a minute).
 * The signature is checked with the secret key, then the existing
 * confirm paths do the real work, so there is one source of truth:
 *   MNT_*  (coaching)        -> booking-api  {action:"confirm"}
 *   OIWG_* (15-day challenge) -> verify-payment {method:"paystack"} using metadata.challenger_id
 * Both of those re-verify with Paystack and are safe to call twice.
 *
 * Paystack dashboard: Settings > API Keys & Webhooks > Live Webhook URL =
 *   https://vbafqulhbskaswkyjjdn.supabase.co/functions/v1/paystack-webhook
 *
 * Env: SUPABASE_URL, PAYSTACK_SECRET_KEY
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

async function hmac512(body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const call = (fn: string, body: unknown) =>
  fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.text()).catch((e) => String(e));

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  if (!SECRET) return new Response("not configured", { status: 500 });
  const sig = req.headers.get("x-paystack-signature") ?? "";
  if (!sig || sig !== await hmac512(raw)) return new Response("bad signature", { status: 401 });

  let ev: any;
  try { ev = JSON.parse(raw); } catch { return new Response("bad body", { status: 400 }); }
  if (ev?.event !== "charge.success") return new Response("ignored");

  const ref: string = ev?.data?.reference ?? "";
  let meta = ev?.data?.metadata;
  if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch { meta = {}; } }

  if (ref.startsWith("MNT_")) {
    console.log("coaching paid", ref, await call("booking-api", { action: "confirm", reference: ref }));
  } else if (ref.startsWith("OIWG_")) {
    const cid = meta?.challenger_id;
    if (cid) console.log("challenge paid", ref, await call("verify-payment", { method: "paystack", challenger_id: cid, reference: ref, ...(meta?.access_code ? { access_code: String(meta.access_code) } : {}) }));
    else console.log("challenge paid, no challenger_id in metadata", ref);
  } else {
    console.log("charge.success with unknown reference", ref);
  }
  return new Response("ok");
});
