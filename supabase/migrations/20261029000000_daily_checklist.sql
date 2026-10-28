-- Daily job checklist for Construction Management.
--
-- Every weekday each PM has one line per assigned job. A job counts as done
-- when JobTread has a daily log for it that day (checked live, not stored
-- here) or when the PM ticks it by hand (stored here, with an optional note).
-- Reminder emails go out in the morning and at 3 PM New Jersey time.

create table public.daily_checks (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  day         date not null,              -- New Jersey date
  note        text not null default '' check (char_length(note) <= 300),
  checked_at  timestamptz not null default now(),
  primary key (project_id, user_id, day)
);
create index daily_checks_day_idx on public.daily_checks (day);

alter table public.daily_checks enable row level security;
revoke all on public.daily_checks from anon;

-- PMs see and tick their own; the Principal Contractor and Admins see everyone's.
create policy "checks: read own or admin" on public.daily_checks for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "checks: tick own assigned jobs" on public.daily_checks for insert to authenticated
  with check (user_id = auth.uid() and public.is_team() and public.can_access_project(project_id));
create policy "checks: untick own" on public.daily_checks for delete to authenticated
  using (user_id = auth.uid());

-- Which reminder emails already went out, so each is sent once.
create table public.checklist_emails (
  day      date not null,
  slot     text not null check (slot in ('morning', 'afternoon')),
  user_id  uuid not null references public.profiles (id) on delete cascade,
  sent_at  timestamptz not null default now(),
  primary key (day, slot, user_id)
);
alter table public.checklist_emails enable row level security;
revoke all on public.checklist_emails from anon, authenticated;

-- Hourly on weekdays; the app sends at 7 AM and 3 PM New Jersey time and
-- ignores the other hours (this keeps it right through daylight saving).
select cron.schedule(
  'onsite-daily-checklist',
  '5 * * * 1-5',
  $cron$
    select net.http_post(
      url := (select value from public.app_settings where key = 'site_url') || '/api/checklist/remind',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-onsite-secret', (select value from public.app_settings where key = 'cron_secret')
      )
    )
  $cron$
);
