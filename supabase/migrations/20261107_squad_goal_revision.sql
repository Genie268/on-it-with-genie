-- Coach-approved goal revision for squad members.
-- Genie unlocks one change after a check-in call; the original goal stays on record.
alter table public.squad_members
  add column if not exists revision_allowed_at timestamptz,
  add column if not exists revised_at timestamptz,
  add column if not exists first_goal text;

-- How many days after declaring Genie can still allow a change (editable in Admin > Bookings > Switches & hours)
insert into public.private_settings (key, value) values ('squad_revision_days', '7')
on conflict (key) do nothing;
