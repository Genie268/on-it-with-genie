import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = (() => {
  const v = Deno.env.get("VAPID_SUBJECT") || "";
  return v.startsWith("mailto:") ? v : "mailto:oboeugene@gmail.com";
})();

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* ── Determine current slot based on WAT (UTC+1) ── */
function getCurrentSlot(): number | null {
  const now = new Date();
  const watHour = (now.getUTCHours() + 1) % 24;
  if (watHour >= 7 && watHour < 11) return 1;   // morning
  if (watHour >= 12 && watHour < 15) return 2;  // afternoon
  if (watHour >= 17 && watHour < 21) return 3;  // evening
  return null;
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

Deno.serve(async (_req) => {
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

    /* ── Reminder logic ── */
    const slot = getCurrentSlot();
    if (!slot) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "outside reminder window" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const today = new Date().toISOString().split("T")[0];

    // Get active challengers with paid/free status
    const { data: challengers, error: cErr } = await sb
      .from("challengers")
      .select("id, name, start_date, duration, status, payment_status")
      .eq("status", "active")
      .in("payment_status", ["paid", "free"]);

    if (cErr) throw cErr;
    if (!challengers || challengers.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "no active challengers" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Get already-sent reminders for today + this slot (dedup)
    const { data: alreadySent } = await sb
      .from("reminder_logs")
      .select("challenger_id")
      .eq("sent_date", today)
      .eq("slot", slot);

    const sentIds = new Set((alreadySent ?? []).map((r: { challenger_id: string }) => r.challenger_id));

    // Filter out challengers already reminded this slot
    const eligible = challengers.filter((c: { id: string }) => !sentIds.has(c.id));
    if (eligible.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "all already sent for slot " + slot }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const challengerIds = eligible.map((c: { id: string }) => c.id);

    // Fetch today's uploads for all eligible challengers
    const { data: todayUploads } = await sb
      .from("uploads")
      .select("challenger_id")
      .in("challenger_id", challengerIds)
      .gte("created_at", today + "T00:00:00Z");

    const uploadedIds = new Set((todayUploads ?? []).map((u: { challenger_id: string }) => u.challenger_id));

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

    // Send notifications per challenger
    await Promise.all(
      eligible.map(async (c: { id: string; name: string; start_date: string; duration: number }) => {
        const cSubs = subsByChallenger.get(c.id);
        if (!cSubs || cSubs.length === 0) return;

        const plan = planMap.get(c.id) || null;
        const hasUpload = uploadedIds.has(c.id);
        const { title, body } = buildMessage(slot, c.name, plan, hasUpload);

        const payload = JSON.stringify({
          title,
          body,
          url: "/",
          tag: "oiwg-reminder-" + slot,
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
          logRows.push({ challenger_id: c.id, sent_date: today, slot });
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

    return new Response(
      JSON.stringify({ slot, sent, failed, reminded: logRows.length }),
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
