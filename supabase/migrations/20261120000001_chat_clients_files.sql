-- Files attached in a chat for some clients only stay hidden from the other
-- clients if the message or the chat is later deleted (a deleted message's
-- files stay on the Files tab, no longer tied to a chat). They become
-- team-only instead.

create or replace function public.hide_files_of_restricted_message() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.chat_clients cc where cc.chat_id = old.chat_id) then
    update public.files set is_internal = true where message_id = old.id;
  end if;
  return old;
end;
$$;
drop trigger if exists messages_hide_restricted_files on public.messages;
create trigger messages_hide_restricted_files
  before delete on public.messages
  for each row execute function public.hide_files_of_restricted_message();

create or replace function public.hide_files_of_restricted_chat() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.chat_clients cc where cc.chat_id = old.id) then
    update public.files f set is_internal = true
    from public.messages m
    where m.chat_id = old.id and f.message_id = m.id;
  end if;
  return old;
end;
$$;
drop trigger if exists chats_hide_restricted_files on public.chats;
create trigger chats_hide_restricted_files
  before delete on public.chats
  for each row execute function public.hide_files_of_restricted_chat();
