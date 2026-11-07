-- Goal Test results (eugeneobo.com/goal). Written only by the goal-api edge function (service role).
create table if not exists public.goal_results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  goal text not null,
  answers jsonb not null default '{}'::jsonb,
  score int not null,
  weakest text,
  source text,
  will text,
  by_date date,
  proof text,
  first_step text,
  email text,
  name text,
  opted_in boolean not null default false,
  emailed_at timestamptz
);
alter table public.goal_results enable row level security;
create index if not exists goal_results_created_at_idx on public.goal_results (created_at desc);
