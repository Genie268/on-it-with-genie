-- Capture inbox, part 4: he tags what a capture is about; Claude asks one question back and gives a verdict.
alter table public.captures
  add column if not exists user_kind text,
  add column if not exists question text,
  add column if not exists answer text,
  add column if not exists answer_at timestamptz,
  add column if not exists verdict text;
