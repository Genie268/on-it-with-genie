-- Capture inbox, part 5: Dump / Organize / Prioritize / Execute
alter table public.captures
  add column if not exists categories text[],          -- he can tag more than one (content + book)
  add column if not exists priority text check (priority in ('now','next','later')),
  add column if not exists priority_by text;           -- 'genie' (his call, Claude leaves it) or 'claude'
update public.captures set categories = array[user_kind] where user_kind is not null and categories is null;
-- Claude's running read of how he thinks: recurring themes, content seams, book threads
insert into public.app_settings (key, value) values ('capture_themes', '') on conflict (key) do nothing;
