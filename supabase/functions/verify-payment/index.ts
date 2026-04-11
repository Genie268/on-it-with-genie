/*
 * verify-payment — server-side payment gate.
 *
 * Only this function (running with service_role) can move a challenger from
 * payment_status='pending' to 'paid' or 'free'. Anon clients are blocked by
 * a trigger on public.challengers.
 *
 * Methods:
 *   - { method:"paystack",    challenger_id, reference, access_code? }
 *     Verifies the reference with Paystack's /transaction/verify API using
 *     the server-side secret key. Amount must be >= expected (tier price,
 *     discounted if a partial access_code is supplied and valid).
 *   - { method:"access_code", challenger_id, access_code }
 *     Only 100%-discount codes. Verified against public.access_codes.
 *
 * Required env vars:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - PAYSTACK_SECRET_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Tier prices in kobo — must match PRICES in js/config.js.
const PRICES: Record<number, number> = { 7: 850000, 15: 1500000, 30: 5000000 };

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

interface AccessCodeRow {
  id: string;
  code: string;
  discount_percent: number | null;
  max_uses: number | null;
  times_used: number | null;
  valid_until: string | null;
  active: boolean | null;
  tier: number | null;
}

async function loadAccessCode(code: string): Promise<
  { ok: true; row: AccessCodeRow } | { ok: false; error: string }
> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { ok: false, error: "missing_code" };

  const { data, error } = await sb
    .from("access_codes")
    .select("*")
    .eq("code", normalized)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return { ok: false, error: "invalid_code" };

  const row = data as AccessCodeRow;
  if (row.valid_until && new Date(row.valid_until).getTime() < Date.now()) {
    return { ok: false, error: "expired_code" };
  }
  if ((row.max_uses ?? 0) > 0 && (row.times_used ?? 0) >= (row.max_uses ?? 0)) {
    return { ok: false, error: "code_exhausted" };
  }
  return { ok: true, row };
}

async function incrementCodeUsage(row: AccessCodeRow) {
  await sb
    .from("access_codes")
    .update({ times_used: (row.times_used ?? 0) + 1 })
    .eq("id", row.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const challenger_id = typeof payload.challenger_id === "string" ? payload.challenger_id : "";
  const method = typeof payload.method === "string" ? payload.method : "";
  const reference = typeof payload.reference === "string" ? payload.reference : "";
  const accessCodeInput =
    typeof payload.access_code === "string" ? payload.access_code : "";

  if (!challenger_id) return json({ ok: false, error: "missing_challenger_id" }, 400);

  // Load challenger record — it must already exist (client creates it during onboarding).
  const { data: challenger, error: cErr } = await sb
    .from("challengers")
    .select("id, duration, payment_status")
    .eq("id", challenger_id)
    .maybeSingle();

  if (cErr || !challenger) return json({ ok: false, error: "challenger_not_found" }, 404);

  // Idempotent short-circuit — already verified.
  if (challenger.payment_status === "paid" || challenger.payment_status === "free") {
    return json({ ok: true, status: challenger.payment_status, already: true });
  }

  const tierPrice = PRICES[challenger.duration as number];
  if (!tierPrice) return json({ ok: false, error: "invalid_tier" }, 400);

  /* ───────────────────────── ACCESS CODE (100%) ───────────────────────── */
  if (method === "access_code") {
    const codeRes = await loadAccessCode(accessCodeInput);
    if (!codeRes.ok) return json({ ok: false, error: codeRes.error }, 400);
    if ((codeRes.row.discount_percent ?? 0) !== 100) {
      return json({ ok: false, error: "not_full_discount" }, 400);
    }

    await incrementCodeUsage(codeRes.row);

    const { error: upErr } = await sb
      .from("challengers")
      .update({
        payment_status: "free",
        payment_ref: `FREE_${Date.now()}`,
        amount_paid: 0,
        access_code: codeRes.row.code,
      })
      .eq("id", challenger_id);

    if (upErr) return json({ ok: false, error: "update_failed" }, 500);
    return json({ ok: true, status: "free" });
  }

  /* ───────────────────────────── PAYSTACK ─────────────────────────────── */
  if (method === "paystack") {
    if (!PAYSTACK_SECRET_KEY) {
      return json({ ok: false, error: "server_misconfigured" }, 500);
    }
    if (!reference) return json({ ok: false, error: "missing_reference" }, 400);

    // If a partial-discount code is attached, resolve it to compute expected amount.
    let expectedAmount = tierPrice;
    let appliedCode: AccessCodeRow | null = null;
    if (accessCodeInput) {
      const codeRes = await loadAccessCode(accessCodeInput);
      if (!codeRes.ok) return json({ ok: false, error: codeRes.error }, 400);
      const pct = codeRes.row.discount_percent ?? 0;
      if (pct < 0 || pct > 100) return json({ ok: false, error: "invalid_code" }, 400);
      // 100% codes should go through method="access_code" — reject here.
      if (pct === 100) return json({ ok: false, error: "use_access_code_method" }, 400);
      expectedAmount = Math.round(tierPrice * (1 - pct / 100));
      appliedCode = codeRes.row;
    }

    // Verify the transaction with Paystack.
    let verifyData: Record<string, unknown>;
    try {
      const verifyRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } },
      );
      if (!verifyRes.ok) {
        return json({ ok: false, error: "paystack_verify_http_" + verifyRes.status }, 502);
      }
      verifyData = await verifyRes.json();
    } catch {
      return json({ ok: false, error: "paystack_verify_network" }, 502);
    }

    const tx = (verifyData as { data?: Record<string, unknown> }).data;
    const verifyOk = (verifyData as { status?: boolean }).status === true;
    if (!verifyOk || !tx || tx.status !== "success") {
      return json({ ok: false, error: "payment_not_successful" }, 400);
    }

    const txAmount = typeof tx.amount === "number" ? tx.amount : -1;
    if (txAmount < expectedAmount) {
      return json(
        { ok: false, error: "amount_mismatch", expected: expectedAmount, got: txAmount },
        400,
      );
    }
    if (tx.currency && tx.currency !== "NGN") {
      return json({ ok: false, error: "currency_mismatch" }, 400);
    }

    // Guard against reference reuse: if another challenger already claims this ref, reject.
    const { data: dupe } = await sb
      .from("challengers")
      .select("id")
      .eq("payment_ref", reference)
      .neq("id", challenger_id)
      .maybeSingle();
    if (dupe) return json({ ok: false, error: "reference_already_used" }, 400);

    if (appliedCode) await incrementCodeUsage(appliedCode);

    const { error: upErr } = await sb
      .from("challengers")
      .update({
        payment_status: "paid",
        payment_ref: reference,
        amount_paid: txAmount,
        access_code: appliedCode?.code ?? null,
      })
      .eq("id", challenger_id);

    if (upErr) return json({ ok: false, error: "update_failed" }, 500);
    return json({ ok: true, status: "paid", amount: txAmount });
  }

  return json({ ok: false, error: "unknown_method" }, 400);
});
