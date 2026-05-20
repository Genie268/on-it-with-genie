import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Genie <genie@oiwg.app>";
const VAPID_SUBJECT = (() => {
  const v = Deno.env.get("VAPID_SUBJECT") || "";
  return v.startsWith("mailto:") ? v : "mailto:oboeugene@gmail.com";
})();

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* ── Email helper (Resend) — skips silently if not configured ── */
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

function completionEmailHtml(name: string, duration: number): string {
  const first = name.split(" ")[0] || "Challenger";
  return `
<div style="font-family:-apple-system,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;background:#0a0a0a;color:#ebebeb">
  <div style="text-align:center;margin-bottom:24px">
    <div style="width:48px;height:48px;border-radius:12px;background:#c49a1c;display:inline-flex;align-items:center;justify-content:center;font-weight:900;font-size:22px;color:#000">G</div>
  </div>
  <h1 style="font-size:24px;font-weight:900;text-align:center;margin-bottom:8px;color:#ebebeb">${first}, you did it.</h1>
  <p style="font-size:15px;text-align:center;color:#888;line-height:1.7;margin-bottom:24px">${duration} days. You showed up, uploaded proof, and finished what you started. Most people don't get this far.</p>
  <div style="background:#111;border:1px solid #1e1e1e;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
    <p style="font-size:11px;font-weight:700;letter-spacing:.12em;color:#c49a1c;margin-bottom:8px">CHALLENGE COMPLETE</p>
    <p style="font-size:32px;font-weight:900;color:#c49a1c;margin-bottom:4px">${duration} days</p>
    <p style="font-size:13px;color:#666">of consistent execution</p>
  </div>
  <p style="font-size:14px;color:#aaa;line-height:1.8;margin-bottom:24px">Your proof card is waiting for you in the app. Screenshot it, share it, or just sit with the fact that you proved something to yourself.</p>
  <div style="text-align:center;margin-bottom:24px">
    <a href="https://oiwg.vercel.app" style="display:inline-block;background:#c49a1c;color:#000;font-weight:800;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none">View Your Proof Card</a>
  </div>
  <hr style="border:none;border-top:1px solid #1e1e1e;margin:24px 0">
  <p style="font-size:13px;color:#666;line-height:1.7;margin-bottom:16px"><strong style="color:#aaa">What's next?</strong><br>If you've got another goal burning, you can start a new challenge anytime. Same structure, new target. Or take a break. You've earned it.</p>
  <p style="font-size:11px;color:#444;text-align:center">On It With Genie · You proved it.</p>
</div>`;
}

function ghostNudgeEmailHtml(name: string, daysMissed: number): string {
  const first = name.split(" ")[0] || "Hey";
  return `
<div style="font-family:-apple-system,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;background:#0a0a0a;color:#ebebeb">
  <div style="text-align:center;margin-bottom:24px">
    <div style="width:48px;height:48px;border-radius:12px;background:#c49a1c;display:inline-flex;align-items:center;justify-content:center;font-weight:900;font-size:22px;color:#000">G</div>
  </div>
  <h1 style="font-size:22px;font-weight:900;text-align:center;margin-bottom:8px;color:#ebebeb">${first}, your challenge is still open.</h1>
  <p style="font-size:14px;text-align:center;color:#888;line-height:1.7;margin-bottom:24px">You've been quiet for ${daysMissed} days. The gap is growing, but the door isn't closed.</p>
  <p style="font-size:14px;color:#aaa;line-height:1.8;margin-bottom:24px">You don't need a perfect streak. You need to show up again. One upload. That's all it takes to break the silence.</p>
  <div style="text-align:center;margin-bottom:24px">
    <a href="https://oiwg.vercel.app" style="display:inline-block;background:#c49a1c;color:#000;font-weight:800;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none">Come Back</a>
  </div>
  <p style="font-size:11px;color:#444;text-align:center">On It With Genie</p>
</div>`;
}

/* ── Slot windows (local time, any timezone) ──
   Morning  7-11 AM
   Afternoon 12-3 PM
   Evening  5-9 PM */
function slotForLocalHour(hour: number): number | null {
  if (hour >= 7 && hour < 11) return 1;
  if (hour >= 12 && hour < 15) return 2;
  if (hour >= 17 && hour < 21) return 3;
  return null;
}

/* Compute the current hour (0-23) in a given IANA timezone. Falls back to
   WAT (Africa/Lagos) when the timezone is null or invalid. */
function getLocalHour(timezone: string | null): number | null {
  const tz = timezone || "Africa/Lagos";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", hour12: false,
    }).formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === "hour");
    if (!hourPart) return null;
    const h = parseInt(hourPart.value, 10);
    return isNaN(h) ? null : h % 24;
  } catch {
    return null;
  }
}

function getCurrentSlotForUser(timezone: string | null): number | null {
  const h = getLocalHour(timezone);
  if (h === null) return null;
  return slotForLocalHour(h);
}

/* Get the "today" date string (YYYY-MM-DD) in a given timezone. Used for
   per-user reminder dedup so a user in EST who gets a 9pm-local push isn't
   blocked from a 7am-local push the next morning by UTC date confusion. */
function getLocalDateString(timezone: string | null): string {
  const tz = timezone || "Africa/Lagos";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

/* ── Compute challenger's current day number ── */
function getDayNumber(startDate: string, duration: number): number {
  const start = new Date(startDate);
  const now = new Date();
  const day = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return Math.min(Math.max(day, 1), duration);
}

interface Plan {
  main_step: string;
  skipped: boolean;
}

/* ── Build plan-aware notification messages ── */
function buildMessage(
  slot: number,
  name: string,
  plan: Plan | null,
  hasUploadToday: boolean
): { title: string; body: string } {
  const first = name.split(" ")[0] || "Hey";

  if (slot === 1) {
    // Morning push
    if (!plan) {
      return {
        title: `Morning, ${first}`,
        body: "What are you doing today?",
      };
    }
    return {
      title: `Morning, ${first}`,
      body: `Your plan: ${plan.main_step.substring(0, 80)}. Let's go.`,
    };
  }

  if (slot === 2) {
    // Afternoon push
    if (!plan) {
      return {
        title: `Hey ${first}`,
        body: "No plan yet. Still time.",
      };
    }
    if (!hasUploadToday) {
      return {
        title: `Hey ${first}`,
        body: "Started on your plan? Upload when ready.",
      };
    }
    // Has plan AND upload — no nudge needed, but send encouragement
    return {
      title: `Nice, ${first}`,
      body: "Proof uploaded. Keep that energy.",
    };
  }

  if (slot === 3) {
    // Evening push
    if (hasUploadToday) {
      return {
        title: `Good work, ${first}`,
        body: "Today's proof is in. Rest up.",
      };
    }
    if (plan) {
      return {
        title: `${first}, clock's ticking`,
        body: `You planned to ${plan.main_step.substring(0, 70)}. Upload your proof.`,
      };
    }
    return {
      title: `${first}, don't ghost your goal`,
      body: "Day's almost over. Upload something.",
    };
  }

  return { title: "On It With Genie", body: "Check in on your challenge." };
}

Deno.serve(async (req) => {
  let forceSlot: number | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.force_slot) forceSlot = Number(body.force_slot);
    }
  } catch { /* ignore */ }
  try {
    /* ── Completion detection (runs every invocation) ── */
    {
      // Find active challengers whose challenge period has elapsed
      const { data: activeCandidates, error: compErr } = await sb
        .from("challengers")
        .select("id, name, start_date, duration, status, payment_status")
        .eq("status", "active")
        .in("payment_status", ["paid", "free"]);

      if (compErr) {
        console.error("completion-check query error:", compErr);
      } else if (activeCandidates && activeCandidates.length > 0) {
        const now = new Date();
        const completed = activeCandidates.filter(
          (c: { start_date: string; duration: number }) => {
            const start = new Date(c.start_date);
            const rawDay =
              Math.floor(
                (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
              ) + 1;
            return rawDay > c.duration;
          }
        );

        if (completed.length > 0) {
          const completedIds = completed.map((c: { id: string }) => c.id);

          // Update status to 'completed'
          const { error: updErr } = await sb
            .from("challengers")
            .update({ status: "completed" })
            .in("id", completedIds);

          if (updErr) {
            console.error("completion-check update error:", updErr);
          }

          // Fetch push subscriptions for completed challengers
          const { data: compSubs } = await sb
            .from("push_subscriptions")
            .select("challenger_id, endpoint, p256dh, auth")
            .eq("is_active", true)
            .in("challenger_id", completedIds);

          // Group subscriptions by challenger
          const compSubMap = new Map<string, typeof compSubs>();
          for (const sub of compSubs ?? []) {
            const arr = compSubMap.get(sub.challenger_id) || [];
            arr.push(sub);
            compSubMap.set(sub.challenger_id, arr);
          }

          // Send congratulatory notifications and log analytics
          const analyticsRows: {
            event_type: string;
            event_data: Record<string, unknown>;
          }[] = [];

          await Promise.all(
            completed.map(
              async (c: { id: string; name: string; duration: number }) => {
                const firstName = c.name.split(" ")[0] || "Challenger";
                const payload = JSON.stringify({
                  title: "Challenge Complete!",
                  body: `Congratulations, ${firstName}! You completed your ${c.duration}-day challenge.`,
                  url: "/",
                  tag: "oiwg-completed",
                });

                const cSubs = compSubMap.get(c.id);
                if (cSubs && cSubs.length > 0) {
                  await Promise.all(
                    cSubs.map(
                      async (sub: {
                        endpoint: string;
                        p256dh: string;
                        auth: string;
                      }) => {
                        try {
                          await webpush.sendNotification(
                            {
                              endpoint: sub.endpoint,
                              keys: { p256dh: sub.p256dh, auth: sub.auth },
                            },
                            payload
                          );
                        } catch (err: unknown) {
                          const status = (err as { statusCode?: number })
                            .statusCode;
                          if (status === 410 || status === 404) {
                            await sb
                              .from("push_subscriptions")
                              .update({ is_active: false })
                              .eq("endpoint", sub.endpoint);
                          }
                          console.error(
                            `completion push failed for ${c.id}:`,
                            err
                          );
                        }
                      }
                    )
                  );
                }

                analyticsRows.push({
                  event_type: "challenge_completed",
                  event_data: {
                    challenger_id: c.id,
                    name: c.name,
                    duration: c.duration,
                  },
                });

                // Send completion email
                const { data: cRow } = await sb
                  .from("challengers")
                  .select("email")
                  .eq("id", c.id)
                  .maybeSingle();
                if (cRow?.email) {
                  await sendEmail(
                    cRow.email,
                    `You did it, ${c.name.split(" ")[0]}. ${c.duration} days complete.`,
                    completionEmailHtml(c.name, c.duration)
                  );
                }
              }
            )
          );

          // Insert analytics events
          if (analyticsRows.length > 0) {
            const { error: aErr } = await sb
              .from("analytics_events")
              .insert(analyticsRows);
            if (aErr) {
              console.error("completion analytics insert error:", aErr);
            }
          }

          console.log(
            `Completion check: marked ${completed.length} challenger(s) as completed`
          );
        }
      }
    }

    /* ── Ghosted user nudge (once per user, after 4 days inactive) ── */
    {
      const fourDaysAgo = new Date(Date.now() - 4 * 86400000).toISOString();
      const { data: ghostCandidates } = await sb
        .from("challengers")
        .select("id, name, email, start_date, duration, last_seen")
        .eq("status", "active")
        .in("payment_status", ["paid", "free"])
        .lt("last_seen", fourDaysAgo);

      if (ghostCandidates && ghostCandidates.length > 0) {
        const ghostIds = ghostCandidates.map((c: { id: string }) => c.id);
        // Check which ones already got a ghost nudge (dedup via reminder_logs slot=99)
        const { data: alreadyNudged } = await sb
          .from("reminder_logs")
          .select("challenger_id")
          .in("challenger_id", ghostIds)
          .eq("slot", 99);
        const nudgedSet = new Set((alreadyNudged ?? []).map((r: { challenger_id: string }) => r.challenger_id));
        const toNudge = ghostCandidates.filter((c: { id: string }) => !nudgedSet.has(c.id));

        if (toNudge.length > 0) {
          const nudgeIds = toNudge.map((c: { id: string }) => c.id);
          const { data: nudgeSubs } = await sb
            .from("push_subscriptions")
            .select("challenger_id, endpoint, p256dh, auth")
            .eq("is_active", true)
            .in("challenger_id", nudgeIds);

          const nudgeSubMap = new Map<string, typeof nudgeSubs>();
          for (const sub of nudgeSubs ?? []) {
            const arr = nudgeSubMap.get(sub.challenger_id) || [];
            arr.push(sub);
            nudgeSubMap.set(sub.challenger_id, arr);
          }

          const today = new Date().toISOString().split("T")[0];
          const nudgeLogs: { challenger_id: string; sent_date: string; slot: number }[] = [];

          await Promise.all(
            toNudge.map(async (c: { id: string; name: string; email: string | null; last_seen: string; duration: number }) => {
              const daysSince = Math.floor((Date.now() - new Date(c.last_seen).getTime()) / 86400000);
              const first = c.name.split(" ")[0] || "Hey";

              // Push notification
              const cSubs = nudgeSubMap.get(c.id);
              if (cSubs && cSubs.length > 0) {
                const payload = JSON.stringify({
                  title: `${first}, your challenge is still open`,
                  body: "You've been quiet. One upload breaks the silence.",
                  url: "/",
                  tag: "oiwg-ghost-nudge",
                });
                await Promise.all(
                  cSubs.map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
                    try {
                      await webpush.sendNotification(
                        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                        payload
                      );
                    } catch { /* ignore */ }
                  })
                );
              }

              // Email nudge
              if (c.email) {
                await sendEmail(
                  c.email,
                  `${first}, your challenge is still open`,
                  ghostNudgeEmailHtml(c.name, daysSince)
                );
              }

              nudgeLogs.push({ challenger_id: c.id, sent_date: today, slot: 99 });
            })
          );

          if (nudgeLogs.length > 0) {
            await sb.from("reminder_logs").insert(nudgeLogs);
          }
          console.log(`Ghost nudge: sent to ${nudgeLogs.length} inactive challenger(s)`);
        }
      }
    }

    /* ── Reminder logic ──
       Per-user slot detection: each challenger's slot is computed in their
       own timezone, so morning/afternoon/evening windows fire at their
       local time instead of WAT. The cron fires multiple times across UTC
       hours so every timezone gets covered. A forceSlot=N from admin
       overrides per-user detection and pushes to everyone regardless of
       their local clock (used for "send slot N now" buttons). */

    // Get active challengers with paid/free status
    const { data: challengers, error: cErr } = await sb
      .from("challengers")
      .select("id, name, start_date, duration, status, payment_status, timezone")
      .eq("status", "active")
      .in("payment_status", ["paid", "free"]);

    if (cErr) throw cErr;
    if (!challengers || challengers.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "no active challengers" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    type Challenger = {
      id: string; name: string; start_date: string; duration: number;
      timezone: string | null; _slot: number; _localDate: string;
    };

    // Attach per-user slot + local date. Drop anyone outside their window.
    const withSlot: Challenger[] = [];
    for (const c of challengers) {
      const userSlot = forceSlot || getCurrentSlotForUser(c.timezone);
      if (!userSlot) continue;
      withSlot.push({ ...c, _slot: userSlot, _localDate: getLocalDateString(c.timezone) });
    }

    if (withSlot.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "no users in any reminder window right now" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Dedup against reminder_logs using each user's local date + computed slot.
    // Query covers a 2-day window so we catch users near UTC date boundaries.
    const twoDayWindow = [
      new Date(Date.now() - 86400000).toISOString().split("T")[0],
      new Date().toISOString().split("T")[0],
      new Date(Date.now() + 86400000).toISOString().split("T")[0],
    ];
    const { data: alreadySent } = await sb
      .from("reminder_logs")
      .select("challenger_id, sent_date, slot")
      .in("challenger_id", withSlot.map((c) => c.id))
      .in("sent_date", twoDayWindow);

    const sentKeys = new Set(
      (alreadySent ?? []).map(
        (r: { challenger_id: string; sent_date: string; slot: number }) =>
          `${r.challenger_id}|${r.sent_date}|${r.slot}`
      )
    );

    const eligible = withSlot.filter((c) => !sentKeys.has(`${c.id}|${c._localDate}|${c._slot}`));
    if (eligible.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "all eligible users already reminded for their current slot" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const challengerIds = eligible.map((c) => c.id);

    // Fetch the last 36h of uploads — wider than a single UTC day so we can
    // bucket each by the uploader's local date and check "uploaded today"
    // accurately regardless of timezone.
    const lookback = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const { data: recentUploads } = await sb
      .from("uploads")
      .select("challenger_id, created_at")
      .in("challenger_id", challengerIds)
      .gte("created_at", lookback);

    const uploadedIds = new Set<string>();
    const userTzById = new Map(eligible.map((c) => [c.id, c.timezone] as const));
    const localDateById = new Map(eligible.map((c) => [c.id, c._localDate] as const));
    for (const u of recentUploads ?? []) {
      const tz = userTzById.get(u.challenger_id) ?? "Africa/Lagos";
      const uploadLocalDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz || "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date(u.created_at));
      if (uploadLocalDate === localDateById.get(u.challenger_id)) {
        uploadedIds.add(u.challenger_id);
      }
    }

    // Fetch daily plans for each challenger's current day
    // We need to query all plans for these challengers and match by day_number
    const { data: allPlans } = await sb
      .from("daily_plans")
      .select("challenger_id, day_number, main_step, skipped")
      .in("challenger_id", challengerIds)
      .eq("skipped", false);

    // Build a map: challenger_id -> plan for their current day
    const planMap = new Map<string, Plan>();
    if (allPlans) {
      for (const c of eligible) {
        const dayNum = getDayNumber(c.start_date, c.duration);
        const plan = allPlans.find(
          (p: { challenger_id: string; day_number: number }) =>
            p.challenger_id === c.id && p.day_number === dayNum
        );
        if (plan && plan.main_step) {
          planMap.set(c.id, { main_step: plan.main_step, skipped: plan.skipped });
        }
      }
    }

    // Fetch push subscriptions for eligible challengers
    const { data: subs, error: sErr } = await sb
      .from("push_subscriptions")
      .select("challenger_id, endpoint, p256dh, auth")
      .eq("is_active", true)
      .in("challenger_id", challengerIds);

    if (sErr) throw sErr;

    let sent = 0;
    let failed = 0;
    const expiredEndpoints: string[] = [];
    const logRows: { challenger_id: string; sent_date: string; slot: number }[] = [];

    // Group subs by challenger
    const subsByChallenger = new Map<string, typeof subs>();
    for (const sub of subs ?? []) {
      const arr = subsByChallenger.get(sub.challenger_id) || [];
      arr.push(sub);
      subsByChallenger.set(sub.challenger_id, arr);
    }

    // Send notifications per challenger — each uses their own computed slot.
    await Promise.all(
      eligible.map(async (c) => {
        const cSubs = subsByChallenger.get(c.id);
        if (!cSubs || cSubs.length === 0) return;

        const plan = planMap.get(c.id) || null;
        const hasUpload = uploadedIds.has(c.id);
        const { title, body } = buildMessage(c._slot, c.name, plan, hasUpload);

        const payload = JSON.stringify({
          title,
          body,
          url: "/",
          tag: "oiwg-reminder-" + c._slot,
        });

        let anySent = false;
        await Promise.all(
          cSubs.map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload
              );
              sent++;
              anySent = true;
            } catch (err: unknown) {
              const status = (err as { statusCode?: number }).statusCode;
              if (status === 410 || status === 404) {
                expiredEndpoints.push(sub.endpoint);
              }
              failed++;
            }
          })
        );

        if (anySent) {
          logRows.push({ challenger_id: c.id, sent_date: c._localDate, slot: c._slot });
        }
      })
    );

    // Mark expired subscriptions inactive
    if (expiredEndpoints.length > 0) {
      await sb.from("push_subscriptions").update({ is_active: false }).in("endpoint", expiredEndpoints);
    }

    // Log successful sends
    if (logRows.length > 0) {
      await sb.from("reminder_logs").insert(logRows);
    }

    /* slotsHit: count of users we sent to per slot, useful for admin to
       see "morning: 3, afternoon: 1, evening: 2" in one trigger. */
    const slotsHit: Record<number, number> = {};
    for (const r of logRows) slotsHit[r.slot] = (slotsHit[r.slot] || 0) + 1;

    return new Response(
      JSON.stringify({
        slot: forceSlot || null,
        slots_hit: slotsHit,
        sent,
        failed,
        reminded: logRows.length,
        eligible_users: eligible.length,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-reminders error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
