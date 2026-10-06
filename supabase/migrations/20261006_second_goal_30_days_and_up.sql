-- Oct 2026: 3-month tier (90 days) added. Slot 2 (a second goal) is now
-- open to any challenge of 30 days or more, not only exactly 30.
alter policy goals_insert on public.goals with check (
  exists (select 1 from challengers c
          where c.id = goals.challenger_id
            and c.payment_status = any (array['paid','free'])
            and (goals.slot = 1 or (goals.slot = 2 and c.duration >= 30))));

alter policy goals_update on public.goals
  using (exists (select 1 from challengers c
                 where c.id = goals.challenger_id
                   and c.payment_status = any (array['paid','free'])))
  with check (exists (select 1 from challengers c
                      where c.id = goals.challenger_id
                        and c.payment_status = any (array['paid','free'])
                        and (goals.slot = 1 or (goals.slot = 2 and c.duration >= 30))));
