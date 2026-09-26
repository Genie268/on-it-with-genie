-- Admin-only switch: a finished profile the coach turned back on so the
-- member can upload proof for days the coach reopened.
alter table public.challengers
  add column if not exists reactivated boolean not null default false;
