-- Beshara OnSite: weekly progress reports drafted from JobTread daily logs.
--
-- Every Monday morning a draft is made for each project linked to a
-- JobTread job. The team reviews it in Beshara Reports (internal only);
-- once an Admin approves it, it posts to the project's Weekly Progress
-- Report chat as "Beshara Builders".

-- ---------------------------------------------------------------------------
-- Link each project to its JobTread job.
-- ---------------------------------------------------------------------------

alter table public.projects
  add column jobtread_job_id text unique,
  add column jobtread_label  text;

-- ---------------------------------------------------------------------------
-- Posts made on behalf of the company (the author is kept for the record).
-- ---------------------------------------------------------------------------

alter table public.messages
  add column posted_as text check (posted_as in ('company'));

-- Only the server posts as the company.
create function public.guard_posted_as() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.posted_as is not null and auth.uid() is not null then
    raise exception 'Only Beshara Reports can post as Beshara Builders';
  end if;
  return new;
end;
$$;
create trigger messages_guard_posted_as
  before insert on public.messages
  for each row execute function public.guard_posted_as();

-- ---------------------------------------------------------------------------
-- Rename the starter chat.
-- ---------------------------------------------------------------------------

update public.chats c set name = 'Weekly Progress Report'
where c.name = 'Weekly Updates'
  and not exists (
    select 1 from public.chats o
    where o.project_id = c.project_id and lower(o.name) = 'weekly progress report'
  );

create or replace function public.create_default_chats() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.chats (project_id, name, is_internal, position, created_by) values
    (new.id, 'Weekly Progress Report', false, 1,    new.created_by),
    (new.id, 'Selections & Finishes',  false, 2,    new.created_by),
    (new.id, 'Schedule & Inspections', false, 3,    new.created_by),
    (new.id, 'Internal Only',          true,  1000, new.created_by);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The reports themselves. Team only; clients never see drafts.
-- ---------------------------------------------------------------------------

create table public.weekly_reports (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  week_start     date not null,                  -- Monday of the week the report covers
  status         text not null default 'draft'
                 check (status in ('draft', 'approved', 'skipped', 'no_logs')),
  completed      jsonb not null default '[]',    -- [{ trade, text }]
  looking_ahead  jsonb not null default '[]',    -- [{ trade, text, date }]
  photos         jsonb not null default '[]',    -- [{ id, name, log_date, selected }] (JobTread file ids)
  source_logs    jsonb not null default '[]',    -- the daily logs the draft was written from
  pm_notes       text not null default '',
  error          text,
  generated_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id) on delete set null,
  approved_by    uuid references public.profiles (id) on delete set null,
  approved_at    timestamptz,
  message_id     uuid references public.messages (id) on delete set null,
  unique (project_id, week_start)
);
create index weekly_reports_week_idx on public.weekly_reports (week_start desc);

alter table public.weekly_reports enable row level security;
revoke all on public.weekly_reports from anon;
revoke insert, delete on public.weekly_reports from authenticated;
revoke update on public.weekly_reports from authenticated;
grant update (completed, looking_ahead, photos, pm_notes, updated_at, updated_by) on public.weekly_reports to authenticated;

create policy "reports: team reads" on public.weekly_reports for select to authenticated
  using (public.is_team() and public.can_access_project(project_id));
create policy "reports: team edits drafts" on public.weekly_reports for update to authenticated
  using (public.is_team() and public.can_access_project(project_id) and status = 'draft')
  with check (public.is_team() and public.can_access_project(project_id) and status = 'draft');

-- ---------------------------------------------------------------------------
-- Notifications name company posts "Beshara Builders".
-- ---------------------------------------------------------------------------

create or replace function public.claim_message_push(p_message uuid)
returns table (project_id uuid, project_name text, chat_id uuid, chat_name text, author_id uuid, author_name text, body text)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with claimed as (
    update public.messages m set push_sent_at = now()
    where m.id = p_message and m.push_sent_at is null and m.created_at > now() - interval '10 minutes'
    returning m.*
  )
  select c.project_id, pr.name, c.id, c.name, cl.author_id,
         case when cl.posted_as = 'company' then 'Beshara Builders'
              else coalesce(nullif(a.full_name, ''), a.email, 'Someone') end,
         cl.body
  from claimed cl
  join public.chats c on c.id = cl.chat_id
  join public.projects pr on pr.id = c.project_id
  left join public.profiles a on a.id = cl.author_id;
end;
$$;

create or replace function public.pending_email_digest(p_until timestamptz)
returns table (user_id uuid, email text, full_name text, project_id uuid, project_name text,
               chat_id uuid, chat_name text, author_name text, body text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.email, p.full_name, pr.id, pr.name, c.id, c.name,
         case when m.posted_as = 'company' then 'Beshara Builders'
              else coalesce(nullif(a.full_name, ''), a.email, 'Someone') end,
         m.body, m.created_at
  from public.profiles p
  join auth.users u on u.id = p.id and u.last_sign_in_at is not null
  left join public.notify_state st on st.user_id = p.id
  join public.messages m
    on m.created_at <= p_until
   and m.created_at > coalesce(st.email_cursor, p.created_at)
   and m.author_id is distinct from p.id
  join public.chats c on c.id = m.chat_id
  join public.projects pr on pr.id = c.project_id
  left join public.profiles a on a.id = m.author_id
  left join public.chat_reads r on r.user_id = p.id and r.chat_id = m.chat_id
  where p.email_notifications
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
    and public.can_profile_see_chat(p.id, m.chat_id)
  order by p.id, pr.name, c.position, m.created_at
$$;
revoke execute on function public.claim_message_push(uuid) from public, anon, authenticated;
revoke execute on function public.pending_email_digest(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Monday drafts. Runs hourly on Mondays; the app only drafts once it's
-- 8 AM or later in New Jersey and skips reports that already exist. The
-- secret keeps anyone else from triggering it.
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value)
values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

select cron.schedule(
  'onsite-weekly-reports',
  '15 * * * 1',
  $cron$
    select net.http_post(
      url := (select value from public.app_settings where key = 'site_url') || '/api/reports/generate',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-onsite-secret', (select value from public.app_settings where key = 'cron_secret')
      )
    )
  $cron$
);
