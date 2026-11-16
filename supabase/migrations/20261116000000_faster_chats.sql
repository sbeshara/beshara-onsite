-- Faster pages. The two lookups behind every chat page went through every
-- message the person can see, checking access message by message. They now
-- go chat by chat: access is checked once per chat, and each chat's newest or
-- unread messages come straight from the (chat_id, created_at) index.
-- Results are the same as before.

-- Unread count per chat (the dots and numbers in the menu and chat list).
create or replace function public.my_unread()
returns table (chat_id uuid, project_id uuid, unread bigint)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.project_id, n.unread
  from public.chats c
  left join public.chat_reads r on r.chat_id = c.id and r.user_id = auth.uid()
  cross join lateral (
    select count(*) as unread
    from public.messages m
    where m.chat_id = c.id
      and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
      and m.author_id is distinct from auth.uid()
      and m.source_id is null
  ) n
  where auth.uid() is not null
    and public.can_see_chat(c.id)
    and n.unread > 0
$$;
revoke execute on function public.my_unread() from public, anon;
grant execute on function public.my_unread() to authenticated;

-- The newest message in each chat (the chat list previews), optionally for
-- one project only.
drop function if exists public.latest_messages();
create function public.latest_messages(p_project uuid default null)
returns table (chat_id uuid, project_id uuid, chat_name text, is_internal boolean,
               message_id uuid, author_id uuid, body text, created_at timestamptz,
               imported boolean, imported_author text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.project_id, c.name, c.is_internal, m.id, m.author_id, m.body, m.created_at,
         c.source_id is not null or m.source_id is not null, m.imported_author
  from public.chats c
  cross join lateral (
    select m.id, m.author_id, m.body, m.created_at, m.source_id, m.imported_author
    from public.messages m
    where m.chat_id = c.id
    order by m.created_at desc
    limit 1
  ) m
  where auth.uid() is not null
    and (p_project is null or c.project_id = p_project)
    and public.can_see_chat(c.id)
$$;
revoke execute on function public.latest_messages(uuid) from public, anon;
grant execute on function public.latest_messages(uuid) to authenticated;
