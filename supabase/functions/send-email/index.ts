/*
 * send-email — transactional email via Resend.
 *
 * Called internally by other edge functions (send-reminders, verify-payment, etc).
 * Gracefully skips if RESEND_API_KEY is not configured.
 *
 * Payload:
 *   { to, subject, html, from? }
 *
 * Required env vars:
 *   - RESEND_API_KEY (if not set, emails are silently skipped)
 *   - RESEND_FROM (optional, defaults to "Genie <genie@oiwg.app>")
 */

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Genie <genie@oiwg.app>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!RESEND_API_KEY) {
    return json({ ok: true, skipped: true, reason: "no_api_key" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const to = typeof payload.to === "string" ? payload.to : "";
  const subject = typeof payload.subject === "string" ? payload.subject : "";
  const html = typeof payload.html === "string" ? payload.html : "";
  const from = typeof payload.from === "string" ? payload.from : RESEND_FROM;

  if (!to || !subject || !html) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", res.status, err);
      return json({ ok: false, error: "resend_error", status: res.status }, 502);
    }

    const data = await res.json();
    return json({ ok: true, id: data.id });
  } catch (e) {
    console.error("send-email network error:", e);
    return json({ ok: false, error: "network_error" }, 502);
  }
});
