/*
 * events-api: free passes for in-person events (Forward with Genie).
 *
 * GET  ?event=fwg-06                 -> { ok, left, full }
 * POST { action:"register", event, name, email, phone, goal? }
 *      -> { ok, pass:{ code, name }, already? }   or { ok:false, error:"full" }
 *      Same email twice returns the same pass. Emails the pass, tells Genie.
 *
 * Capacity comes from private_settings.event_capacity (default 15).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "Genie <genie@eugeneobo.com>";
const SITE = "https://eugeneobo.com";

const EVENTS: Record<string, { title: string; session: string; start: string; end: string; when: string; venue: string; address: string; maps: string }> = {
  "fwg-06": {
    title: "Forward with Genie", session: "06",
    start: "2026-10-31T11:00:00+01:00", end: "2026-10-31T12:30:00+01:00",
    when: "Saturday 31 October, 11:00am to 12:30pm",
    venue: "Busy Mart", address: "Suite TF2, 44 Ebitu Ukiwe, Jabi, Abuja",
    maps: "https://maps.google.com/?q=Busy+Mart+44+Ebitu+Ukiwe+Jabi+Abuja",
  },
};

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

async function capacity() {
  const { data } = await sb.from("private_settings").select("value").eq("key", "event_capacity").maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : 15;
}
async function taken(event: string) {
  const { count } = await sb.from("event_registrations").select("id", { count: "exact", head: true }).eq("event", event);
  return count ?? 0;
}
function passCode(session: string) {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(4));
  return `FWG${session}-` + Array.from(r, (x) => abc[x % abc.length]).join("");
}
function ics(e: typeof EVENTS[string], code: string) {
  const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//with Genie//Events//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${code}@eugeneobo.com`, `DTSTAMP:${f(new Date().toISOString())}`, `DTSTART:${f(e.start)}`, `DTEND:${f(e.end)}`,
    `SUMMARY:${e.title} (Session ${e.session})`, `DESCRIPTION:Your pass: ${code}. Bring one goal.`, `LOCATION:${e.venue}\\, ${e.address.replace(/,/g, "\\,")}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Forward with Genie in 2 hours", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}
async function sendEmail(to: string, subject: string, text: string, attach?: string, extra: Record<string, unknown> = {}) {
  if (!RESEND || !to) return;
  const body: Record<string, unknown> = { from: FROM, to, subject, text, ...extra };
  if (attach) body.attachments = [{ filename: "forward-with-genie.ics", content: btoa(unescape(encodeURIComponent(attach))) }];
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) console.error("resend", r.status, await r.text());
  } catch (err) { console.error("resend failed", err); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method === "GET") {
      const event = new URL(req.url).searchParams.get("event") ?? "";
      if (!EVENTS[event]) return json({ ok: false, error: "no_event" }, 404);
      const cap = await capacity(), n = await taken(event);
      return json({ ok: true, left: Math.max(0, cap - n), full: n >= cap });
    }
    const p = await req.json().catch(() => ({}));
    if (p.action !== "register") return json({ ok: false, error: "unknown_action" }, 400);
    const event = clean(p.event, 20), e = EVENTS[event];
    if (!e) return json({ ok: false, error: "no_event" }, 404);
    if (Date.parse(e.end) < Date.now()) return json({ ok: false, error: "over" }, 409);
    const name = clean(p.name, 80), email = clean(p.email, 120).toLowerCase(), phone = clean(p.phone, 30), goal = clean(p.goal, 300);
    if (!name) return json({ ok: false, error: "missing_name" }, 400);
    if (!validEmail(email)) return json({ ok: false, error: "bad_email" }, 400);
    if (phone.replace(/\D/g, "").length < 7) return json({ ok: false, error: "missing_phone" }, 400);

    const { data: had } = await sb.from("event_registrations").select("pass_code,name").eq("event", event).eq("email", email).maybeSingle();
    if (had) return json({ ok: true, already: true, pass: { code: had.pass_code, name: had.name } });

    const cap = await capacity();
    if ((await taken(event)) >= cap) return json({ ok: false, error: "full" }, 409);

    let code = passCode(e.session), row = null;
    for (let i = 0; i < 4 && !row; i++) {
      const { data, error } = await sb.from("event_registrations").insert({ event, name, email, phone, goal: goal || null, pass_code: code }).select().single();
      if (!error) row = data;
      else if (String(error.code) === "23505" && String(error.message).includes("event_email")) {
        const { data: again } = await sb.from("event_registrations").select("pass_code,name").eq("event", event).eq("email", email).maybeSingle();
        if (again) return json({ ok: true, already: true, pass: { code: again.pass_code, name: again.name } });
      } else code = passCode(e.session);
    }
    if (!row) return json({ ok: false, error: "save_failed" }, 500);

    // keep them on the email list as a contact (not opted in to newsletters)
    const { data: c } = await sb.from("contacts").select("email").eq("email", email).maybeSingle();
    if (c) await sb.from("contacts").update({ last_source: "event", last_seen: new Date().toISOString(), name, phone }).eq("email", email);
    else await sb.from("contacts").insert({ email, name, phone, first_source: "event", last_source: "event", opted_in: false });

    const first = name.split(" ")[0];
    await sendEmail(email, `Your pass: ${e.title}, ${e.when.split(",")[0]}`,
      `Hi ${first},\n\nYou're in. Here's your pass.\n\n${e.title} · Session ${e.session}\n${e.when}\n${e.venue}, ${e.address}\nDirections: ${e.maps}\n\nPass code: ${row.pass_code}\nShow it at the door.\n\nBring the one goal you keep pushing to next week${goal ? ` (you said: "${goal}")` : ""}. Entry is free.\n\nCan't come any more? Reply to this email so someone else can take your seat.\n\nGenie`,
      ics(e, row.pass_code));
    const { data: s } = await sb.from("private_settings").select("value").eq("key", "notify_email").maybeSingle();
    const count = await taken(event);
    if (s?.value) await sendEmail(s.value, `Seat ${count} of ${cap}: ${name}`,
      `${name} got a pass for ${e.title} (Session ${e.session}).\n\nEmail: ${email}\nPhone: ${phone}\nGoal: ${goal || "-"}\nPass: ${row.pass_code}\n\n${count} of ${cap} seats taken.`, undefined, { reply_to: email });

    return json({ ok: true, pass: { code: row.pass_code, name } });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
