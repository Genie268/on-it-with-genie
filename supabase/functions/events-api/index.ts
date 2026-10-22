/*
 * events-api: free passes for in-person events (Forward with Genie).
 *
 * GET  ?event=fwg-06                 -> { ok, left, full }
 * POST { action:"register", event, name, email, phone, goal? }
 *      -> { ok, pass:{ code, name }, already? }   or { ok:false, error:"full" }
 *      Same email twice returns the same pass. Emails the pass (PDF + .ics), tells Genie.
 * POST { action:"release", token }    Frees a seat (link in the reminder email), alerts the waitlist.
 * POST { action:"waitlist", event, name, email }   Wants a seat if one opens / the next session.
 * POST { action:"cron" } + x-cron-key  Every 15 min: day-before reminder (6pm the evening before),
 *      follow-up email 4h after the end to people Genie checked in at the door.
 *
 * Capacity comes from private_settings.event_capacity (default 15).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "Genie <genie@eugeneobo.com>";
const SITE = "https://eugeneobo.com";

const EVENTS: Record<string, { title: string; session: string; start: string; end: string; when: string; short: string; time: string; venue: string; venueShort: string; address: string; maps: string }> = {
  "fwg-06": {
    title: "Forward with Genie", session: "06",
    start: "2026-10-31T11:00:00+01:00", end: "2026-10-31T12:30:00+01:00",
    when: "Saturday 31 October, 11:00am to 12:30pm", short: "Sat 31 Oct", time: "11:00am to 12:30pm",
    venue: "Busy Mart", venueShort: "Busy Mart, Jabi", address: "Suite TF2, 44 Ebitu Ukiwe, Jabi, Abuja",
    maps: "https://maps.google.com/?q=Busy+Mart+44+Ebitu+Ukiwe+Jabi+Abuja",
  },
};

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

async function capacity() {
  const { data } = await sb.from("private_settings").select("value").eq("key", "event_capacity").maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : 15;
}
async function taken(event: string) {
  const { count } = await sb.from("event_registrations").select("id", { count: "exact", head: true }).eq("event", event).is("released_at", null);
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
// PDF standard fonts only cover basic Latin: turn Ọ/ẹ/ṣ etc into plain letters, drop anything else
const latin = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "").trim();
async function passPdf(e: typeof EVENTS[string], name: string, code: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${e.title} pass ${code}`); doc.setAuthor("Genie");
  const W = 360, H = 450, pg = doc.addPage([W, H]);
  const big = await doc.embedFont(StandardFonts.HelveticaBold), sans = await doc.embedFont(StandardFonts.Helvetica), mono = await doc.embedFont(StandardFonts.Courier), monoB = await doc.embedFont(StandardFonts.CourierBold);
  const ink = rgb(15 / 255, 15 / 255, 16 / 255), red = rgb(215 / 255, 64 / 255, 28 / 255), cream = rgb(232 / 255, 227 / 255, 218 / 255), white = rgb(1, 1, 1), dim = rgb(.62, .61, .58), dim2 = rgb(.45, .45, .43);
  const fit = (t: string, f: any, size: number, max: number) => { let s = size; while (f.widthOfTextAtSize(t, s) > max && s > 8) s -= 1; return s; };
  pg.drawRectangle({ x: 0, y: 0, width: W, height: H, color: cream });
  const cx = 22, cy = 22, cw = W - 44, ch = H - 44;
  pg.drawRectangle({ x: cx, y: cy, width: cw, height: ch, color: ink });
  pg.drawRectangle({ x: cx, y: cy, width: 7, height: ch, color: red });
  const L = cx + 26, R = cx + cw - 20, top = cy + ch;
  pg.drawText(e.title.toUpperCase(), { x: L, y: top - 34, size: 8.5, font: mono, color: dim });
  const sess = "SESSION " + e.session; pg.drawText(sess, { x: R - mono.widthOfTextAtSize(sess, 8.5), y: top - 34, size: 8.5, font: mono, color: dim });
  let s = fit("FORWARD", big, 52, R - L); pg.drawText("FORWARD", { x: L, y: top - 90, size: s, font: big, color: red });
  const nm = latin(name).toUpperCase() || "GUEST"; s = fit(nm, big, 30, R - L); pg.drawText(nm, { x: L, y: top - 140, size: s, font: big, color: white });
  const cols: [string, string][] = [["DATE", e.short], ["TIME", e.time.split(" ")[0]], ["VENUE", e.venueShort]], colW = (R - L) / 3;
  cols.forEach(([k, v], i) => { const X = L + i * colW; pg.drawText(k, { x: X, y: top - 176, size: 8, font: mono, color: dim2 });
    pg.drawText(v, { x: X, y: top - 193, size: fit(v, big, 12, colW - 6), font: big, color: white }); });
  pg.drawLine({ start: { x: cx + 7, y: top - 222 }, end: { x: cx + cw, y: top - 222 }, thickness: 1, color: dim2, dashArray: [5, 4] });
  pg.drawText("PASS CODE", { x: L, y: top - 252, size: 8, font: mono, color: dim2 });
  pg.drawText(code, { x: L, y: top - 286, size: fit(code, monoB, 30, R - L), font: monoB, color: white });
  pg.drawText("Show this at the door. Bring one goal.", { x: L, y: top - 318, size: 10.5, font: sans, color: rgb(.85, .84, .81) });
  pg.drawText(e.address, { x: L, y: top - 340, size: fit(e.address, sans, 8.5, R - L), font: sans, color: dim });
  pg.drawText(e.when, { x: L, y: top - 354, size: 8.5, font: sans, color: dim });
  pg.drawText("EUGENEOBO.COM/EVENTS", { x: L, y: cy + 20, size: 8, font: mono, color: dim2 });
  return await doc.save();
}

const b64 = (u8: Uint8Array) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
async function sendEmail(to: string, subject: string, text: string, attach?: string, extra: Record<string, unknown> = {}, files: { filename: string; content: string }[] = []) {
  if (!RESEND || !to) return;
  const body: Record<string, unknown> = { from: FROM, to, subject, text, ...extra };
  const att = [...files];
  if (attach) att.push({ filename: "forward-with-genie.ics", content: btoa(unescape(encodeURIComponent(attach))) });
  if (att.length) body.attachments = att;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) console.error("resend", r.status, await r.text());
  } catch (err) { console.error("resend failed", err); }
}

const first = (n: string) => (n || "there").trim().split(" ")[0];
const fmtWhen = (e: typeof EVENTS[string]) => `${e.when}\n${e.venue}, ${e.address}\nDirections: ${e.maps}`;
async function notifyEmail() {
  const { data } = await sb.from("private_settings").select("value").eq("key", "notify_email").maybeSingle();
  return data?.value ?? "";
}

/* someone freed a seat: tell the waitlist (each person at most once every 6 hours) */
async function alertWaitlist(event: string) {
  const e = EVENTS[event]; if (!e || Date.parse(e.start) < Date.now()) return 0;
  const cutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data: wl } = await sb.from("waitlist").select("id,email,name,notified_at").eq("list", "event");
  const { data: regs } = await sb.from("event_registrations").select("email").eq("event", event).is("released_at", null);
  const have = new Set((regs ?? []).map((r: any) => r.email));
  let n = 0;
  for (const w of wl ?? []) {
    if (have.has(w.email) || (w.notified_at && w.notified_at > cutoff)) continue;
    await sendEmail(w.email, `A seat just opened: ${e.title}, ${e.short}`,
      `Hi ${first(w.name)},\n\nSomeone gave up their seat for ${e.title} (Session ${e.session}).\n\n${fmtWhen(e)}\n\nFirst person to grab it gets it: ${SITE}/events\n\nGenie`);
    await sb.from("waitlist").update({ notified_at: new Date().toISOString() }).eq("id", w.id);
    n++;
  }
  return n;
}

async function release(p: Record<string, unknown>) {
  const token = clean(p.token, 60);
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ ok: false, error: "bad_token" }, 400);
  const { data: r } = await sb.from("event_registrations").select("id,event,name,email,released_at").eq("release_token", token).maybeSingle();
  if (!r) return json({ ok: false, error: "not_found" }, 404);
  const e = EVENTS[r.event];
  if (r.released_at) return json({ ok: true, already: true, name: r.name, event: r.event });
  if (e && Date.parse(e.start) < Date.now()) return json({ ok: false, error: "over" }, 409);
  await sb.from("event_registrations").update({ released_at: new Date().toISOString() }).eq("id", r.id);
  const told = await alertWaitlist(r.event);
  const to = await notifyEmail(), cap = await capacity(), n = await taken(r.event);
  if (to) await sendEmail(to, `Seat freed: ${r.name} can't come`, `${r.name} (${r.email}) freed their seat for ${e?.title ?? r.event}.\n\n${n} of ${cap} seats now taken. ${told ? `Told ${told} people on the waitlist.` : "Nobody on the waitlist to tell."}`);
  return json({ ok: true, name: r.name, event: r.event });
}

async function joinWaitlist(p: Record<string, unknown>) {
  const event = clean(p.event, 20), e = EVENTS[event];
  const email = clean(p.email, 120).toLowerCase(), name = clean(p.name, 80);
  if (!validEmail(email)) return json({ ok: false, error: "bad_email" }, 400);
  const { data: ins, error } = await sb.from("waitlist").upsert({ list: "event", email, name: name || null }, { onConflict: "list,email", ignoreDuplicates: true }).select("id");
  if (error) { console.error(error); return json({ ok: false, error: "save_failed" }, 500); }
  const isNew = (ins ?? []).length > 0;
  const { data: c } = await sb.from("contacts").select("email").eq("email", email).maybeSingle();
  if (!c) await sb.from("contacts").insert({ email, name: name || null, first_source: "waitlist_event", last_source: "waitlist_event", opted_in: false });
  const over = !e || Date.parse(e.end) < Date.now();
  if (isNew) await sendEmail(email, "You're on the list for Forward with Genie",
    `Hi ${first(name)},\n\nYou're on the list for Forward with Genie, my in-person session in Abuja.\n\n${over ? "I'll email you as soon as passes for the next session are out." : "If a seat opens for this one, you'll get an email straight away. Otherwise you'll hear first when the next session opens."} The room is small, so move quickly when that email lands.\n\nGenie`);
  return json({ ok: true, already: !isNew });
}

async function cron(req: Request) {
  const { data: k } = await sb.from("private_settings").select("value").eq("key", "cron_key").maybeSingle();
  if (!k?.value || req.headers.get("x-cron-key") !== k.value) return new Response("forbidden", { status: 403 });
  const now = Date.now(), done = { reminded: 0, followed: 0 };
  for (const [code, e] of Object.entries(EVENTS)) {
    const start = Date.parse(e.start), end = Date.parse(e.end), remindAt = start - 17 * 3600_000; // 6pm the evening before
    if (now >= remindAt && now < start) {
      const { data: rows } = await sb.from("event_registrations").select("*").eq("event", code).is("released_at", null).is("reminded_at", null);
      for (const r of rows ?? []) {
        await sb.from("event_registrations").update({ reminded_at: new Date().toISOString() }).eq("id", r.id);
        if (Date.parse(r.created_at) >= remindAt) continue; // signed up after 6pm, their pass email is fresh
        let pdf: { filename: string; content: string }[] = [];
        try { pdf = [{ filename: `${r.pass_code}.pdf`, content: b64(await passPdf(e, r.name, r.pass_code)) }]; } catch (err) { console.error("pdf", err); }
        await sendEmail(r.email, `Tomorrow: ${e.title}, ${e.time.split(" ")[0]}`,
          `Hi ${first(r.name)},\n\nSee you tomorrow.\n\n${fmtWhen(e)}\n\nYour pass: ${r.pass_code} (attached again). Come 10 minutes early so we start on time.\n\nBring the one goal you keep pushing to next week${r.goal ? ` ("${r.goal}")` : ""}.\n\nCan't make it any more? Free your seat so someone on the waitlist can come: ${SITE}/events?release=${r.release_token}\n\nGenie`, undefined, {}, pdf);
        done.reminded++;
      }
    }
    if (now >= end + 4 * 3600_000 && now < end + 3 * 86400_000) {
      const { data: rows } = await sb.from("event_registrations").select("*").eq("event", code).eq("checked_in", true).is("followed_at", null);
      for (const r of rows ?? []) {
        await sb.from("event_registrations").update({ followed_at: new Date().toISOString() }).eq("id", r.id);
        const goal = r.goal ? `You came in with this: "${r.goal}".` : "You came in with a goal.";
        await sendEmail(r.email, "The goal you brought",
          `Hi ${first(r.name)},\n\nThanks for coming to ${e.title}.\n\n${goal}\n\nMost people leave a room like that fired up and have done nothing by Tuesday. Make sure you're not one of them.\n\nIf you want someone checking on you every day until it's done, that's what the 15-day challenge is for. One goal, proof every day, and I review it myself.\n\nStart here: ${SITE}/app\n\nGenie`);
        done.followed++;
      }
    }
  }
  return json({ ok: true, ...done });
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
    if (p.action === "cron") return await cron(req);
    if (p.action === "release") return await release(p);
    if (p.action === "waitlist") return await joinWaitlist(p);
    if (p.action !== "register") return json({ ok: false, error: "unknown_action" }, 400);
    const event = clean(p.event, 20), e = EVENTS[event];
    if (!e) return json({ ok: false, error: "no_event" }, 404);
    if (Date.parse(e.end) < Date.now()) return json({ ok: false, error: "over" }, 409);
    const name = clean(p.name, 80), email = clean(p.email, 120).toLowerCase(), phone = clean(p.phone, 30), goal = clean(p.goal, 300);
    if (!name) return json({ ok: false, error: "missing_name" }, 400);
    if (!validEmail(email)) return json({ ok: false, error: "bad_email" }, 400);
    if (phone.replace(/\D/g, "").length < 7) return json({ ok: false, error: "missing_phone" }, 400);

    const { data: had } = await sb.from("event_registrations").select("id,pass_code,name,released_at").eq("event", event).eq("email", email).maybeSingle();
    const cap = await capacity();
    if (had && !had.released_at) return json({ ok: true, already: true, pass: { code: had.pass_code, name: had.name } });
    if ((await taken(event)) >= cap) return json({ ok: false, error: "full" }, 409);
    if (had) { // freed their seat earlier, now wants it back
      await sb.from("event_registrations").update({ released_at: null, reminded_at: null }).eq("id", had.id);
      return json({ ok: true, already: true, pass: { code: had.pass_code, name: had.name } });
    }

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

    let pdf: { filename: string; content: string }[] = [];
    try { pdf = [{ filename: `${row.pass_code}.pdf`, content: b64(await passPdf(e, name, row.pass_code)) }]; } catch (err) { console.error("pdf failed", err); }
    await sendEmail(email, `Your pass: ${e.title}, ${e.when.split(",")[0]}`,
      `Hi ${first(name)},\n\nYou're in. Here's your pass.\n\n${e.title} · Session ${e.session}\n${e.when}\n${e.venue}, ${e.address}\nDirections: ${e.maps}\n\nPass code: ${row.pass_code}\nYour pass is attached. Save it to your phone and show it at the door.\n\nBring the one goal you keep pushing to next week${goal ? ` (you said: "${goal}")` : ""}. Entry is free.\n\nCan't come any more? Free your seat so someone on the waitlist can come: ${SITE}/events?release=${row.release_token}\n\nGenie`,
      ics(e, row.pass_code), {}, pdf);
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
