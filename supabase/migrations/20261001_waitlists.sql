-- Waitlists for services that aren't open yet (event tickets, courses)
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  list text not null,
  email text not null,
  name text,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (list, email)
);
alter table public.waitlist enable row level security;
