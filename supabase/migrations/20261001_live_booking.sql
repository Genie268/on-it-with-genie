-- Live booking for free calls and mentorship (applied 2026-10-01 via Supabase MCP)
create table if not exists public.private_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.private_settings enable row level security;
-- keys: google_ical_url, meet_link, notify_email, genie_whatsapp (service role only)

create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  service text not null check (service in ('free_call','mentorship')),
  weekday int not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_minutes int not null check (slot_minutes > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.availability_rules enable row level security;
create policy "public can read active rules" on public.availability_rules
  for select to anon, authenticated using (active);

create table if not exists public.slot_bookings (
  id uuid primary key default gen_random_uuid(),
  service text not null check (service in ('free_call','mentorship')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('held','confirmed','cancelled','expired')),
  hold_expires_at timestamptz,
  name text not null,
  email text not null,
  phone text,
  note text,
  email_opt_in boolean not null default false,
  hours int,
  plan text,
  amount_kobo int,
  payment_reference text unique,
  manage_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint no_overlapping_slots exclude using gist (
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('held','confirmed'))
);
alter table public.slot_bookings enable row level security;
create index if not exists slot_bookings_starts_idx on public.slot_bookings (starts_at);
create index if not exists slot_bookings_email_idx on public.slot_bookings (lower(email));

create table if not exists public.contacts (
  email text primary key,
  name text,
  phone text,
  first_source text,
  last_source text,
  opted_in boolean not null default false,
  opted_in_at timestamptz,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
alter table public.contacts enable row level security;

insert into public.availability_rules (service, weekday, start_time, end_time, slot_minutes)
select 'free_call', d, '09:00', '10:00', 10 from generate_series(0,6) d;
insert into public.availability_rules (service, weekday, start_time, end_time, slot_minutes)
select 'mentorship', d, '16:00', '19:00', 60 from generate_series(1,5) d;
