-- Choosing which clients are in a chat. A chat with no rows here is for every
-- client on the project (as before, and for clients added later). A chat with
-- rows is only for those clients; the Beshara team always sees it. This is
-- enforced everywhere a client could see a chat: the chat list, its messages,
-- search, files attached in it, emails and phone notifications.

create table public.chat_clients (
  chat_id  uuid not null references public.chats (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (chat_id, user_id)
);
create index chat_clients_user_idx on public.chat_clients (user_id);
alter table public.chat_clients enable row level security;
revoke all on public.chat_clients from anon;

-- Whether a client may see a chat: it's open to every client, or they're in it.
create function public.client_in_chat(p_user uuid, p_chat uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.chat_clients cc where cc.chat_id = p_chat)
      or exists (select 1 from public.chat_clients cc where cc.chat_id = p_chat and cc.user_id = p_user)
$$;
revoke execute on function public.client_in_chat(uuid, uuid) from public, anon;
grant execute on function public.client_in_chat(uuid, uuid) to authenticated;

-- The team (with access to the project) reads and changes who's in a chat;
-- clients see only their own rows.
create policy "chat clients: read" on public.chat_clients for select to authenticated
  using (
    user_id = auth.uid()
    or (public.is_team() and exists (select 1 from public.chats c where c.id = chat_id and public.can_access_project(c.project_id)))
  );
create policy "chat clients: add" on public.chat_clients for insert to authenticated
  with check (public.is_team() and exists (select 1 from public.chats c where c.id = chat_id and not c.is_internal and public.can_access_project(c.project_id)));
create policy "chat clients: remove" on public.chat_clients for delete to authenticated
  using (public.is_team() and exists (select 1 from public.chats c where c.id = chat_id and public.can_access_project(c.project_id)));

create or replace function public.can_see_chat(p_chat uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.chats c
    where c.id = p_chat
      and public.can_access_project(c.project_id)
      and (public.is_team() or (not c.is_internal and public.client_in_chat(auth.uid(), c.id)))
  )
$$;

drop policy if exists "chats: read" on public.chats;
create policy "chats: read" on public.chats for select to authenticated
  using (public.can_access_project(project_id) and (public.is_team() or (not is_internal and public.client_in_chat(auth.uid(), id))));

-- Emails and phone notifications follow the same rule.
create or replace function public.can_profile_see_chat(p_user uuid, p_chat uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p, public.chats c
    where p.id = p_user and c.id = p_chat
      and (p.role in ('owner', 'admin')
           or (exists (select 1 from public.project_members pm where pm.project_id = c.project_id and pm.user_id = p.id)
               and (p.role <> 'client' or (not c.is_internal and public.client_in_chat(p.id, c.id)))))
  )
$$;
revoke execute on function public.can_profile_see_chat(uuid, uuid) from public, anon, authenticated;

-- A file attached in a chat is only for the people in that chat.
create function public.can_see_file_message(p_message uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_message is null
      or public.is_team()
      or exists (select 1 from public.messages m where m.id = p_message and public.can_see_chat(m.chat_id))
$$;
revoke execute on function public.can_see_file_message(uuid) from public, anon;
grant execute on function public.can_see_file_message(uuid) to authenticated;

drop policy if exists "files: read" on public.files;
create policy "files: read" on public.files for select to authenticated
  using (public.can_access_project(project_id) and (not is_internal or public.is_team()) and public.can_see_file_message(message_id));

create or replace function public.can_read_object(p_path text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.files f
    where f.storage_path = p_path
      and public.can_access_project(f.project_id)
      and (not f.is_internal or public.is_team())
      and public.can_see_file_message(f.message_id)
  )
$$;
