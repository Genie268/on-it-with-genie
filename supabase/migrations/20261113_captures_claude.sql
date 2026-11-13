-- Capture inbox, part 3: Claude develops captures; Groq is the fallback.
alter table public.captures
  add column if not exists script text,
  add column if not exists format text,
  add column if not exists grade text,
  add column if not exists claude_at timestamptz;

-- video ideas go to the shoot block (first video block of the day), one per day
update public.app_settings
set value = (value::jsonb || '{"video":"video","one_per_day":["video"],"limits":{"video":1}}'::jsonb)::text,
    updated_at = now()
where key = 'capture_plan';
