-- Communication Gap Test results. Written only by the booking-api edge function (service role).
create table if not exists public.gap_results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null,
  second text,
  scores jsonb not null default '{}'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  email text,
  name text,
  opted_in boolean not null default false,
  emailed_at timestamptz,
  booked boolean not null default false
);
alter table public.gap_results enable row level security;
create index if not exists gap_results_created_at_idx on public.gap_results (created_at desc);
