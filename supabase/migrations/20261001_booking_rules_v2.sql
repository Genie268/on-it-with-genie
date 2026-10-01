-- Wednesdays closed to the public; phone key for repeat detection; admin-granted extra free calls; 3-day booking window
update public.availability_rules set active = false where weekday = 3;
alter table public.slot_bookings add column if not exists phone_key text;
create index if not exists slot_bookings_phone_key_idx on public.slot_bookings (phone_key);
alter table public.contacts add column if not exists extra_free_calls int not null default 0;
insert into public.private_settings (key, value) values ('booking_window_days','3') on conflict (key) do nothing;
