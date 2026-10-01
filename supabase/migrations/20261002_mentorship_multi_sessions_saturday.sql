-- Mentorship plans can be pending (times held while paying), paid, or abandoned.
alter table public.mentorship_plans add column if not exists status text not null default 'paid'
  check (status in ('pending','paid','abandoned'));
-- Saturdays open for mentorship (same hours as weekdays until Genie sets his own)
insert into public.availability_rules (service, weekday, start_time, end_time, slot_minutes)
select 'mentorship', 6, '16:00', '19:00', 30
where not exists (select 1 from public.availability_rules where service='mentorship' and weekday=6);
update public.availability_rules set active = true where service='mentorship' and weekday=6;
