-- Capture inbox, part 2: organizing, slots, reminders
alter table public.captures
  add column if not exists title text,
  add column if not exists directions jsonb,
  add column if not exists next_step text,
  add column if not exists minutes int,
  add column if not exists energy text,
  add column if not exists block_label text,
  add column if not exists nudges int not null default 0,
  add column if not exists notified_at timestamptz,
  add column if not exists organized_by text;

create table if not exists public.capture_push (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.capture_push enable row level security;

-- Editable without Claude: his day (copied from the November Run page) and the placement rules.
insert into public.app_settings (key, value) values
  ('capture_routine', '{"sunday": [{"e": "07:00", "k": "other", "s": "06:30", "t": "Wake, water. Voice note to her with today''s plan"}, {"e": "09:00", "k": "book", "s": "07:00", "t": "Book: today''s chapter"}, {"e": "09:30", "k": "break", "s": "09:00", "t": "Breakfast, get ready"}, {"e": "13:00", "k": "other", "s": "09:30", "t": "Church"}, {"e": "14:30", "k": "break", "s": "13:00", "t": "Lunch and rest"}, {"e": "15:00", "k": "her", "s": "14:30", "t": "Call her"}, {"e": "17:00", "k": "video", "s": "15:00", "t": "Video: script, shoot, edit, post"}, {"e": "17:30", "k": "event", "s": "17:00", "t": "Event promo"}, {"e": "19:15", "k": "break", "s": "17:30", "t": "Free time"}, {"e": "20:00", "k": "prep", "s": "19:15", "t": "Dinner. Plan the week, prep Monday''s video and chapter"}, {"e": "22:00", "k": "her", "s": "20:00", "t": "Call her"}, {"e": "22:30", "k": "other", "s": "22:00", "t": "Transcribe one video, tick the page"}], "weekday": [{"e": "07:00", "k": "other", "s": "06:30", "t": "Wake, water. Voice note to her"}, {"e": "09:00", "k": "book", "s": "07:00", "t": "Book: today''s chapter"}, {"e": "10:00", "k": "break", "s": "09:00", "t": "Go out for breakfast"}, {"e": "10:30", "k": "her", "s": "10:00", "t": "Call her"}, {"e": "12:00", "k": "video", "s": "10:30", "t": "Video: finish script, shoot"}, {"e": "12:30", "k": "her", "s": "12:00", "t": "Call her"}, {"e": "13:30", "k": "video", "s": "12:30", "t": "Video: edit, post"}, {"e": "15:00", "k": "site", "s": "13:30", "t": "Website build"}, {"e": "16:30", "k": "break", "s": "15:00", "t": "Break: go out, eat, chill"}, {"e": "17:00", "k": "her", "s": "16:30", "t": "Call her"}, {"e": "18:30", "k": "event", "s": "17:00", "t": "Event planning and promo / coaching"}, {"e": "19:15", "k": "other", "s": "18:30", "t": "Exercise and shower"}, {"e": "20:00", "k": "prep", "s": "19:15", "t": "Dinner. Prep tomorrow: video idea, chapter notes"}, {"e": "22:00", "k": "her", "s": "20:00", "t": "Call her"}, {"e": "22:30", "k": "other", "s": "22:00", "t": "Transcribe one video, tick the page"}]}'),
  ('capture_plan', '{"book": "book", "video": "prep", "site": "site", "business": "site", "event": "event", "task": "prep", "personal": "prep", "other": "prep", "per_block": 3, "reminders_on": true, "nightly_summary": "21:55"}')
on conflict (key) do nothing;

select cron.schedule('capture-organize', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://vbafqulhbskaswkyjjdn.supabase.co/functions/v1/capture-organize',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select value from public.private_settings where key='cron_key')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
