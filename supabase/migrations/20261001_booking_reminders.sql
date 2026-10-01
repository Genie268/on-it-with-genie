-- Reminder tracking + every-minute job that calls the booking-reminders function
alter table public.slot_bookings
  add column if not exists reminded_30 timestamptz,
  add column if not exists reminded_10 timestamptz,
  add column if not exists reminded_live timestamptz;
create index if not exists slot_bookings_upcoming_idx on public.slot_bookings (starts_at) where status = 'confirmed';
insert into public.private_settings (key, value) values ('cron_key', encode(gen_random_bytes(18), 'hex')) on conflict (key) do nothing;
select cron.schedule('booking-reminders', '* * * * *', $$
  select net.http_post(
    url := 'https://vbafqulhbskaswkyjjdn.supabase.co/functions/v1/booking-reminders',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select value from public.private_settings where key='cron_key')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$$);
