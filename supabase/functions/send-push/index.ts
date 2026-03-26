import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")!;
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }

  // Auth check
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${ADMIN_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { type, challenger_id, title, body, url = "/" } = await req.json();

  // Fetch target subscriptions
  let query = sb.from("push_subscriptions").select("*").eq("is_active", true);
  if (type === "personal" && challenger_id) {
    query = query.eq("challenger_id", challenger_id);
  } else if (type === "reminder") {
    // Only challengers who haven't uploaded today
    const today = new Date().toISOString().split("T")[0];
    const { data: uploadedToday } = await sb
      .from("uploads")
      .select("challenger_id")
      .gte("created_at", today + "T00:00:00Z");
    const uploadedIds = (uploadedToday ?? []).map((u: { challenger_id: string }) => u.challenger_id);
    if (uploadedIds.length > 0) {
      query = query.not("challenger_id", "in", `(${uploadedIds.join(",")})`);
    }
  }
  // type === "broadcast" uses no extra filter — sends to all active

  const { data: subs, error } = await query;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const payload = JSON.stringify({ title, body, url, tag: "oiwg-msg" });
  let sent = 0, failed = 0;
  const expiredEndpoints: string[] = [];

  await Promise.all((subs ?? []).map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        expiredEndpoints.push(sub.endpoint);
      }
      failed++;
    }
  }));

  // Mark expired subscriptions inactive
  if (expiredEndpoints.length > 0) {
    await sb.from("push_subscriptions").update({ is_active: false }).in("endpoint", expiredEndpoints);
  }

  return new Response(JSON.stringify({ sent, failed }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
});
