-- Beshara OnSite: initial schema.
--
-- Who sees what:
--   owner, admin   every project; create projects, add clients, assign the team
--   construction   only projects they're assigned to (project_members)
--   client         only their own project(s); never internal chats or team-only files
--
-- Every project starts with four chats. "Internal Only" is the project's one
-- team-only chat; every other chat is visible to the client.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('owner', 'admin', 'construction', 'client');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        public.user_role not null default 'client',
  title       text,                       -- e.g. "Office manager" for a client contact
  created_at  timestamptz not null default now()
);

create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(trim(name)) between 1 and 120),
  town               text not null default '',
  scope              text,
  phase              smallint not null default 0 check (phase between 0 and 4),
  primary_client_id  uuid references public.profiles (id) on delete set null,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

-- Construction management assignments and client contacts. Owner and admin
-- see every project without being listed here.
create table public.project_members (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create table public.chats (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 60),
  is_internal  boolean not null default false,
  position     integer not null default 100,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index chats_one_internal_per_project on public.chats (project_id) where is_internal;
create unique index chats_unique_name_per_project on public.chats (project_id, lower(name));

create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,  -- copied from the chat
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null default '' check (char_length(body) <= 10000),
  created_at  timestamptz not null default now()
);
create index messages_chat_idx on public.messages (chat_id, created_at);
create index messages_project_idx on public.messages (project_id, created_at);

create table public.files (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  message_id    uuid references public.messages (id) on delete set null,  -- set when attached in a chat
  name          text not null,
  storage_path  text not null unique,
  size_bytes    bigint,
  mime_type     text,
  folder        text not null default 'Drawings'
                check (folder in ('Drawings', 'Submittals', 'Permits & inspections', 'Photos', 'Contracts')),
  is_internal   boolean not null default false,
  uploaded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index files_project_idx on public.files (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so policies can call them without
-- recursing through each other's row-level security.
-- ---------------------------------------------------------------------------

create function public.my_role() returns public.user_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() $$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role in ('owner', 'admin') from public.profiles where id = auth.uid()), false) $$;

create function public.is_team() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role <> 'client' from public.profiles where id = auth.uid()), false) $$;

create function public.can_access_project(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin()
      or exists (select 1 from public.project_members m
                 where m.project_id = p_project and m.user_id = auth.uid())
$$;

create function public.can_see_chat(p_chat uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.chats c
    where c.id = p_chat
      and public.can_access_project(c.project_id)
      and (not c.is_internal or public.is_team())
  )
$$;

create function public.can_read_object(p_path text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.files f
    where f.storage_path = p_path
      and public.can_access_project(f.project_id)
      and (not f.is_internal or public.is_team())
  )
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- New sign-in accounts get a profile. The very first account becomes the
-- owner; everyone else starts as a client until the app assigns a role.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role, title)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from public.profiles) then 'client'::public.user_role
         else 'owner'::public.user_role end,
    new.raw_user_meta_data ->> 'title'
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.create_default_chats() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.chats (project_id, name, is_internal, position, created_by) values
    (new.id, 'Weekly Updates',         false, 1,    new.created_by),
    (new.id, 'Selections & Finishes',  false, 2,    new.created_by),
    (new.id, 'Schedule & Inspections', false, 3,    new.created_by),
    (new.id, 'Internal Only',          true,  1000, new.created_by);
  return new;
end;
$$;
create trigger projects_default_chats
  after insert on public.projects
  for each row execute function public.create_default_chats();

-- Construction management may move the project phase; only the owner and
-- admin may change the project's details. (No signed-in user means the
-- server is acting with the service key.)
create function public.guard_project_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() and (
       new.name is distinct from old.name
    or new.town is distinct from old.town
    or new.scope is distinct from old.scope
    or new.primary_client_id is distinct from old.primary_client_id
  ) then
    raise exception 'Only the Owner or Admin can edit project details';
  end if;
  return new;
end;
$$;
create trigger projects_guard_update
  before update on public.projects
  for each row execute function public.guard_project_update();

create function public.set_message_project() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  select c.project_id into new.project_id from public.chats c where c.id = new.chat_id;
  return new;
end;
$$;
create trigger messages_set_project
  before insert on public.messages
  for each row execute function public.set_message_project();

-- A file attached in a chat takes the chat's visibility, so nothing posted
-- in Internal Only can leak to the client's Files tab.
create function public.set_file_visibility() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  chat_internal boolean;
begin
  if new.message_id is not null then
    select c.is_internal, c.project_id into chat_internal, new.project_id
    from public.messages m join public.chats c on c.id = m.chat_id
    where m.id = new.message_id;
    if chat_internal then
      new.is_internal := true;
    end if;
  end if;
  return new;
end;
$$;
create trigger files_set_visibility
  before insert on public.files
  for each row execute function public.set_file_visibility();

-- ---------------------------------------------------------------------------
-- Latest message per chat, for "Needs a response" and project previews.
-- Runs with the caller's permissions, so row-level security still applies.
-- ---------------------------------------------------------------------------

create function public.latest_messages()
returns table (chat_id uuid, project_id uuid, chat_name text, is_internal boolean,
               message_id uuid, author_id uuid, body text, created_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select distinct on (m.chat_id)
         m.chat_id, m.project_id, c.name, c.is_internal, m.id, m.author_id, m.body, m.created_at
  from public.messages m
  join public.chats c on c.id = m.chat_id
  order by m.chat_id, m.created_at desc
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.chats           enable row level security;
alter table public.messages        enable row level security;
alter table public.files           enable row level security;

-- Nothing is readable without signing in.
revoke all on public.profiles, public.projects, public.project_members,
              public.chats, public.messages, public.files from anon;

-- Column-level limits on what signed-in users may change directly. Role
-- changes and invites go through the server with the service key.
revoke update on public.profiles, public.projects, public.messages, public.files from authenticated;
grant update (full_name)                  on public.profiles to authenticated;
grant update (name, town, scope, phase)   on public.projects to authenticated;
grant update (is_internal, folder)        on public.files    to authenticated;

-- profiles: yourself, the owner/admin, and anyone you share a project with.
create policy "profiles: read" on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.is_admin()
  or role in ('owner', 'admin')
  or exists (
    select 1 from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy "profiles: update own name" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- projects
create policy "projects: read" on public.projects for select to authenticated
  using (public.can_access_project(id));
create policy "projects: create" on public.projects for insert to authenticated
  with check (public.is_admin());
create policy "projects: update" on public.projects for update to authenticated
  using (public.is_team() and public.can_access_project(id))
  with check (public.is_team() and public.can_access_project(id));
create policy "projects: delete" on public.projects for delete to authenticated
  using (public.is_admin());

-- project_members
create policy "members: read" on public.project_members for select to authenticated
  using (public.can_access_project(project_id));
create policy "members: add" on public.project_members for insert to authenticated
  with check (public.is_admin());
create policy "members: remove" on public.project_members for delete to authenticated
  using (public.is_admin());

-- chats: anyone on the project can start a client-visible chat. The one
-- internal chat is created with the project and can't be added or removed.
create policy "chats: read" on public.chats for select to authenticated
  using (public.can_access_project(project_id) and (not is_internal or public.is_team()));
create policy "chats: create" on public.chats for insert to authenticated
  with check (public.can_access_project(project_id) and not is_internal and created_by = auth.uid());
create policy "chats: rename" on public.chats for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "chats: delete" on public.chats for delete to authenticated
  using (public.is_admin() and not is_internal);

-- messages
create policy "messages: read" on public.messages for select to authenticated
  using (public.can_see_chat(chat_id));
create policy "messages: post" on public.messages for insert to authenticated
  with check (author_id = auth.uid() and public.can_see_chat(chat_id));
create policy "messages: delete own" on public.messages for delete to authenticated
  using (author_id = auth.uid());

-- files
create policy "files: read" on public.files for select to authenticated
  using (public.can_access_project(project_id) and (not is_internal or public.is_team()));
create policy "files: add" on public.files for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.can_access_project(project_id)
    and (not is_internal or public.is_team())
    and (message_id is null or exists (
          select 1 from public.messages m where m.id = message_id and m.author_id = auth.uid()))
  );
create policy "files: change visibility" on public.files for update to authenticated
  using (public.is_team() and public.can_access_project(project_id))
  with check (public.is_team() and public.can_access_project(project_id));
create policy "files: delete" on public.files for delete to authenticated
  using (public.is_admin() or uploaded_by = auth.uid());

-- ---------------------------------------------------------------------------
-- File storage: a private bucket. Objects live at <project_id>/<uuid>-<name>.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 524288000)  -- 500 MB per file
on conflict (id) do nothing;

create policy "project files: read" on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and public.can_read_object(name));
create policy "project files: upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and public.can_access_project(((storage.foldername(name))[1])::uuid)
  );
create policy "project files: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and (public.is_admin() or owner = auth.uid()));

-- ---------------------------------------------------------------------------
-- Live updates for new messages (row-level security still applies).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.files, public.projects;
  end if;
end;
$$;
