-- Beshara OnSite: unread tracking and notifications.
--
-- Phone/computer notifications go out right away for every new message.
-- Emails are a digest: every 5 minutes, anyone with messages they haven't
-- read for at least 5 minutes gets one email listing them.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Settings only the server can read (site address, push keys).
-- ---------------------------------------------------------------------------

create table public.app_settings (
  key    text primary key,
  value  text not null
);
alter table public.app_settings enable row level security;  -- no policies: server only
revoke all on public.app_settings from anon, authenticated;

insert into public.app_settings (key, value)
values ('site_url', 'https://onsite.besharabuilders.com')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Per-person preferences and read tracking
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column email_notifications boolean not null default true,
  add column push_notifications  boolean not null default true;
grant update (email_notifications, push_notifications) on public.profiles to authenticated;

create table public.chat_reads (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  chat_id       uuid not null references public.chats (id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (user_id, chat_id)
);
alter table public.chat_reads enable row level security;
revoke all on public.chat_reads from anon;
create policy "reads: own" on public.chat_reads for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_see_chat(chat_id));

-- One row per phone or browser that turned notifications on.
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
create policy "push: own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Registers this device for the signed-in person. A shared device moves to
-- whoever turned notifications on most recently.
create function public.register_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  select auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent
  where auth.uid() is not null;
$$;
revoke execute on function public.register_push(text, text, text, text) from public, anon;
grant execute on function public.register_push(text, text, text, text) to authenticated;

-- Where each person's email digest left off.
create table public.notify_state (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  email_cursor  timestamptz not null
);
alter table public.notify_state enable row level security;  -- server only
revoke all on public.notify_state from anon, authenticated;

alter table public.messages add column push_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- Unread counts for the signed-in person (row-level security applies).
-- ---------------------------------------------------------------------------

create function public.my_unread()
returns table (chat_id uuid, project_id uuid, unread bigint)
language sql stable security invoker set search_path = ''
as $$
  select m.chat_id, m.project_id, count(*)
  from public.messages m
  left join public.chat_reads r on r.chat_id = m.chat_id and r.user_id = auth.uid()
  where m.author_id is distinct from auth.uid()
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  group by m.chat_id, m.project_id
$$;

-- ---------------------------------------------------------------------------
-- Server-only helpers for sending notifications. Who may hear about a
-- message follows the same rules as who may read it.
-- ---------------------------------------------------------------------------

create function public.can_profile_see_chat(p_user uuid, p_chat uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p, public.chats c
    where p.id = p_user and c.id = p_chat
      and (p.role in ('owner', 'admin')
           or (exists (select 1 from public.project_members pm where pm.project_id = c.project_id and pm.user_id = p.id)
               and (not c.is_internal or p.role <> 'client')))
  )
$$;

-- Marks a new message as notified (once) and returns what the notification should say.
create function public.claim_message_push(p_message uuid)
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
  select c.project_id, pr.name, c.id, c.name, cl.author_id, coalesce(nullif(a.full_name, ''), a.email, 'Someone'), cl.body
  from claimed cl
  join public.chats c on c.id = cl.chat_id
  join public.projects pr on pr.id = c.project_id
  left join public.profiles a on a.id = cl.author_id;
end;
$$;

create function public.message_push_targets(p_message uuid)
returns table (subscription_id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.messages m
  join public.push_subscriptions s on s.user_id is distinct from m.author_id
  join public.profiles p on p.id = s.user_id and p.push_notifications
  where m.id = p_message and public.can_profile_see_chat(p.id, m.chat_id)
$$;

-- Unread messages older than p_until that haven't been emailed yet, for
-- everyone who has email notifications on and has finished signing up.
create function public.pending_email_digest(p_until timestamptz)
returns table (user_id uuid, email text, full_name text, project_id uuid, project_name text,
               chat_id uuid, chat_name text, author_name text, body text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.email, p.full_name, pr.id, pr.name, c.id, c.name,
         coalesce(nullif(a.full_name, ''), a.email, 'Someone'), m.body, m.created_at
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

revoke execute on function public.can_profile_see_chat(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.claim_message_push(uuid) from public, anon, authenticated;
revoke execute on function public.message_push_targets(uuid) from public, anon, authenticated;
revoke execute on function public.pending_email_digest(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Every new message pings the app, which sends the phone notifications.
-- A failure here never blocks posting the message.
-- ---------------------------------------------------------------------------

create function public.notify_new_message() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  site text;
begin
  select value into site from public.app_settings where key = 'site_url';
  if site is not null then
    perform net.http_post(
      url := site || '/api/notify/message',
      body := jsonb_build_object('id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;
create trigger messages_notify
  after insert on public.messages
  for each row execute function public.notify_new_message();

-- Email digest every 5 minutes.
select cron.schedule(
  'onsite-email-digest',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := (select value from public.app_settings where key = 'site_url') || '/api/notify/digest',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    )
  $cron$
);
