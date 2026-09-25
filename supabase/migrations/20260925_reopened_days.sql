-- Coach-reopened days: missed days an admin has opened for a late upload.
-- Read by the member app (miss.js), written only from the admin view.
alter table public.challengers
  add column if not exists reopened_days integer[] not null default '{}';
