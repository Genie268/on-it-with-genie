-- Sundays closed for clarity calls; mentorship on a 30-minute grid; per-service booking window
update public.availability_rules set active = false where service = 'free_call' and weekday = 0;
update public.availability_rules set slot_minutes = 30 where service = 'mentorship';
insert into public.private_settings (key, value) values ('mentorship_window_days','30') on conflict (key) do nothing;

-- Google Calendar busy times, refreshed every 5 minutes by calendar-sync
create table if not exists public.busy_blocks (
  id bigserial primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null
);
create index if not exists busy_blocks_range_idx on public.busy_blocks (starts_at, ends_at);
alter table public.busy_blocks enable row level security;

-- Mentorship plans: hours bought once, booked across sessions
create table if not exists public.mentorship_plans (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  hours int not null,
  minutes_total int not null,
  amount_kobo int not null,
  payment_reference text unique,
  created_at timestamptz not null default now()
);
alter table public.mentorship_plans enable row level security;
alter table public.slot_bookings
  add column if not exists plan_id uuid references public.mentorship_plans(id),
  add column if not exists minutes int;
create index if not exists slot_bookings_plan_idx on public.slot_bookings (plan_id);

select cron.schedule('calendar-sync', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://vbafqulhbskaswkyjjdn.supabase.co/functions/v1/calendar-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select value from public.private_settings where key='cron_key')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$$);
