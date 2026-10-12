-- Free call appeals: people who missed their one free call can ask Genie for another.
create table if not exists public.free_call_appeals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  booking_id uuid references public.slot_bookings(id) on delete set null,
  name text,
  email text not null,
  phone_key text,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  decide_token uuid not null default gen_random_uuid() unique,
  decided_at timestamptz
);
create index if not exists free_call_appeals_email_idx on public.free_call_appeals (email);
create index if not exists free_call_appeals_phone_idx on public.free_call_appeals (phone_key);
alter table public.free_call_appeals enable row level security;
-- No policies: only the booking functions (service role) read or write appeals.

-- Paid sessions: Monday to Saturday, 10am to 6pm (Lagos).
update public.availability_rules set start_time = '10:00', end_time = '18:00', active = true
 where service = 'mentorship' and weekday between 1 and 6;
