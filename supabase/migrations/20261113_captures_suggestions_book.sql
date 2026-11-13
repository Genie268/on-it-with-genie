-- Capture inbox, part 6: suggestions instead of finished scripts; book captures become a catalog
alter table public.captures
  add column if not exists suggestions text,   -- hooks, angles, beats in his own words; he writes the script
  add column if not exists sketch text,        -- simple SVG whiteboard sketch Claude draws for content
  add column if not exists book_at timestamptz;-- when the book catalog run last read it
update public.captures set script = null, format = null, grade = null where organized_by = 'groq';
-- running outline of the book built from his captures (written by the book catalog run)
insert into public.app_settings (key, value) values ('book_map', '') on conflict (key) do nothing;
