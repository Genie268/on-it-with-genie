-- Reminders ease him in: a heads-up 30 minutes before a block, then 3 minutes before.
alter table public.captures add column if not exists warned_at timestamptz;
-- every minute so the 3-minute heads-up lands on time; Groq work still only runs every 5 minutes
select cron.unschedule('capture-organize');
select cron.schedule('capture-organize', '* * * * *', $$
  select net.http_post(
    url := 'https://vbafqulhbskaswkyjjdn.supabase.co/functions/v1/capture-organize',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select value from public.private_settings where key='cron_key')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
