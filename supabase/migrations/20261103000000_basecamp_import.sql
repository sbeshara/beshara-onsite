-- Basecamp import: each Basecamp Message Board post becomes its own chat (with
-- its comments as messages), and Docs & Files land in the project's Files tab.
-- Everything imported carries a source_id so running the import again only
-- adds what's new, and imported history never sends notifications or shows
-- as unread.

alter table public.projects add column if not exists basecamp_project_id text unique;
alter table public.chats add column if not exists source_id text unique;
alter table public.messages
  add column if not exists source_id text unique,
  add column if not exists imported_author text check (imported_author is null or char_length(imported_author) <= 120);
alter table public.files
  add column if not exists source_id text unique,
  add column if not exists source_folder text check (source_folder is null or char_length(source_folder) <= 300);

-- Imported posts can be team-only, so a project may now have more than one
-- internal chat; the everyday "Internal Only" chat is still the only one
-- people create.
drop index if exists public.chats_one_internal_per_project;
create unique index chats_one_internal_per_project on public.chats (project_id) where is_internal and source_id is null;

-- Only the server (with the service key) marks things as imported.
revoke insert on public.chats, public.messages, public.files from authenticated;
grant insert (id, project_id, name, is_internal, position, created_by, created_at) on public.chats to authenticated;
grant insert (id, chat_id, project_id, author_id, body, created_at) on public.messages to authenticated;
grant insert (id, project_id, message_id, name, storage_path, size_bytes, mime_type, folder, is_internal, uploaded_by, created_at)
  on public.files to authenticated;

-- Where the import keeps its Basecamp sign-in. Server only.
create table if not exists public.basecamp_connection (
  id             smallint primary key default 1 check (id = 1),
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz,
  account_href   text not null,
  account_name   text,
  identity_name  text,
  connected_by   uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now()
);
alter table public.basecamp_connection enable row level security;  -- no policies: server only
revoke all on public.basecamp_connection from anon, authenticated;

-- Imported history is never unread...
create or replace function public.my_unread()
returns table (chat_id uuid, project_id uuid, unread bigint)
language sql stable security invoker set search_path = ''
as $$
  select m.chat_id, m.project_id, count(*)
  from public.messages m
  left join public.chat_reads r on r.chat_id = m.chat_id and r.user_id = auth.uid()
  where m.author_id is distinct from auth.uid()
    and m.source_id is null
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  group by m.chat_id, m.project_id
$$;

-- ...never emailed...
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
   and m.source_id is null
  join public.chats c on c.id = m.chat_id
  join public.projects pr on pr.id = c.project_id
  left join public.profiles a on a.id = m.author_id
  left join public.chat_reads r on r.user_id = p.id and r.chat_id = m.chat_id
  where p.email_notifications
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
    and public.can_profile_see_chat(p.id, m.chat_id)
  order by p.id, pr.name, c.position, m.created_at
$$;
revoke execute on function public.pending_email_digest(timestamptz) from public, anon, authenticated;

-- ...and never pinged to phones.
create or replace function public.notify_new_message() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  site text;
begin
  if new.source_id is not null then
    return new;
  end if;
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

-- Chat previews need to know which chats came from Basecamp, so old posts
-- don't show up under "Needs a Response".
drop function if exists public.latest_messages();
create function public.latest_messages()
returns table (chat_id uuid, project_id uuid, chat_name text, is_internal boolean,
               message_id uuid, author_id uuid, body text, created_at timestamptz,
               imported boolean, imported_author text)
language sql stable security invoker set search_path = ''
as $$
  select distinct on (m.chat_id)
         m.chat_id, m.project_id, c.name, c.is_internal, m.id, m.author_id, m.body, m.created_at,
         c.source_id is not null or m.source_id is not null, m.imported_author
  from public.messages m
  join public.chats c on c.id = m.chat_id
  order by m.chat_id, m.created_at desc
$$;
