// witness-invite — emails someone a request to witness a challenger.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Genie <genie@oiwg.app>";
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://eugeneobo.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function inviteHtml(who: string, message: string, token: string, onPlatform: boolean): string {
  const seeLine = onPlatform
    ? "You'll see their proof land each day, and their streak."
    : "You'll see whether they showed up each day, and their streak.";
  return `
<div style="font-family:-apple-system,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 22px;background:#0a0a0a;color:#ebebeb">
  <p style="font-size:11px;letter-spacing:.14em;color:#c49a1c;font-weight:800;margin:0 0 14px">YOU'VE BEEN ASKED TO WITNESS</p>
  <p style="font-size:16px;line-height:1.6;margin:0 0 16px"><b>${who}</b> wants you to witness them keep a commitment.</p>
  ${message ? `<p style="font-size:14px;color:#d0d0d0;line-height:1.7;font-style:italic;border-left:2px solid #c49a1c;padding-left:14px;margin:0 0 18px">${message.replace(/[<>]/g, "")}</p>` : ""}
  <p style="font-size:13px;color:#9a9a9a;line-height:1.7;margin:0 0 22px">
    ${seeLine} You can't grade them or message them. You just witness. You'll hear from us only when they miss a day.
  </p>
  <a href="${SITE_URL}/?witness=${token}" style="display:inline-block;background:#c49a1c;color:#000;
    font-weight:800;font-size:14px;text-decoration:none;padding:13px 22px;border-radius:10px">Accept &amp; witness them</a>
  <p style="font-size:11px;color:#5a5a5a;margin:24px 0 0">If you'd rather not, ignore this. Nothing happens.</p>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { witness_id, message } = await req.json();
    if (!witness_id) return json({ ok: false, error: "missing_id" }, 400);

    const { data: w } = await sb.from("witnesses")
      .select("id, witness_email, invite_token, witness_challenger_id, challenger_id")
      .eq("id", witness_id).single();
    if (!w) return json({ ok: false, error: "not_found" }, 404);

    const { data: c } = await sb.from("challengers").select("name").eq("id", w.challenger_id).single();
    const who = c?.name || "Someone";

    const ok = await sendEmail(
      w.witness_email,
      `${who.split(" ")[0]} asked you to witness them`,
      inviteHtml(who, String(message || ""), w.invite_token, !!w.witness_challenger_id),
    );
    return json({ ok });
  } catch (e) {
    return json({ ok: false, error: "bad_request" }, 400);
  }
});

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY || !to) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
    });
    return res.ok;
  } catch { return false; }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
