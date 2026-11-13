-- Genie's personal capture inbox. Only the capture-api edge function (service role) touches it.
create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  client_id text unique,               -- id made on the device, so an offline retry never saves twice
  body text not null,
  captured_at timestamptz not null default now(),  -- when he said it (device time)
  received_at timestamptz not null default now(),  -- when it reached the server
  status text not null default 'new' check (status in ('new','sorted','scheduled','done','dropped')),
  kind text,                           -- content, book, task, business, personal... set during sorting
  notes text,                          -- Claude's development of the idea
  scheduled_for timestamptz,           -- slot found for it, if any
  done_at timestamptz
);
create index if not exists captures_status_idx on public.captures (status, captured_at desc);
alter table public.captures enable row level security;
-- no policies: anon/auth clients cannot read or write; edge function uses service role

-- long random key the capture page keeps on the device after one PIN check
insert into public.app_settings (key, value)
select 'capture_key', encode(gen_random_bytes(24), 'hex')
where not exists (select 1 from public.app_settings where key = 'capture_key');
