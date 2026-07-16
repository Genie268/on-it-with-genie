// notify-witnesses — tells a person's witnesses when they MISS a day.
// Runs daily (pg_cron), after the day has closed. Silent on success:
// witnesses only ever hear from us on a miss.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Genie <genie@oiwg.app>";
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://eugeneobo.com";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

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

function missEmail(watcherName: string, whoName: string, day: number, token: string): string {
  const w = (watcherName || "").split(" ")[0] || "there";
  const who = whoName || "Someone you're witnessing";
  return `
<div style="font-family:-apple-system,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 22px;background:#0a0a0a;color:#ebebeb">
  <p style="font-size:11px;letter-spacing:.14em;color:#c49a1c;font-weight:800;margin:0 0 14px">A DAY WAS MISSED</p>
  <p style="font-size:16px;line-height:1.6;margin:0 0 18px">${w}, <b>${who}</b> didn't upload proof for day ${day}.</p>
  <p style="font-size:14px;color:#9a9a9a;line-height:1.7;margin:0 0 22px">
    You're their witness. You don't have to do anything. Sometimes just knowing that you know is enough.
  </p>
  <a href="${SITE_URL}/?witness=${token}" style="display:inline-block;background:#c49a1c;color:#000;
    font-weight:800;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:10px">See where they stand</a>
  <p style="font-size:11px;color:#5a5a5a;margin:24px 0 0;line-height:1.6">
    You only hear from us when they miss. Silence means they showed up.
  </p>
</div>`;
}

// Which day-number is a challenger on, given their start date?
function dayNumber(startDate: string, dur: number): number {
  const start = new Date(startDate);
  const days = Math.floor((Date.now() - start.getTime()) / 86400000) + 1;
  return Math.max(1, Math.min(dur, days));
}

Deno.serve(async () => {
  // Only people who turned witnesses on, still active.
  const { data: challengers } = await sb
    .from("challengers")
    .select("id, name, start_date, duration, status, payment_status")
    .eq("witnesses_enabled", true)
    .eq("status", "active")
    .in("payment_status", ["paid", "free"]);

  if (!challengers || challengers.length === 0) {
    return new Response(JSON.stringify({ ok: true, checked: 0, notified: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const ids = challengers.map((c) => c.id);

  // Accepted witnesses for those people.
  const { data: witnesses } = await sb
    .from("witnesses")
    .select("id, challenger_id, witness_email, invite_token, status")
    .in("challenger_id", ids)
    .eq("status", "accepted");

  if (!witnesses || witnesses.length === 0) {
    return new Response(JSON.stringify({ ok: true, checked: ids.length, notified: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Yesterday: the day that just closed. We alert on the miss the morning after.
  let notified = 0;
  const todayStr = new Date().toISOString().split("T")[0];

  for (const c of challengers) {
    if (!c.start_date) continue;
    const dayToday = dayNumber(c.start_date, c.duration);
    const missedDay = dayToday - 1;               // the day that just ended
    if (missedDay < 1) continue;

    // Did they upload proof for that day, on ANY goal?
    const { data: ups } = await sb
      .from("uploads")
      .select("id")
      .eq("challenger_id", c.id)
      .eq("day_number", missedDay)
      .limit(1);
    if (ups && ups.length > 0) continue;           // they showed up — stay silent

    // Dedup: one miss-alert per challenger per day (reminder_logs slot 77).
    const { data: already } = await sb
      .from("reminder_logs")
      .select("id")
      .eq("challenger_id", c.id)
      .eq("sent_date", todayStr)
      .eq("slot", 77)
      .limit(1);
    if (already && already.length > 0) continue;

    const theirWitnesses = witnesses.filter((w) => w.challenger_id === c.id);
    for (const w of theirWitnesses) {
      const ok = await sendEmail(
        w.witness_email,
        `${(c.name || "Someone").split(" ")[0]} missed day ${missedDay}`,
        missEmail(w.witness_email, c.name, missedDay, w.invite_token),
      );
      if (ok) notified++;
    }

    await sb.from("reminder_logs").insert({ challenger_id: c.id, sent_date: todayStr, slot: 77 });
  }

  return new Response(JSON.stringify({ ok: true, checked: ids.length, notified }), {
    headers: { "Content-Type": "application/json" },
  });
});
