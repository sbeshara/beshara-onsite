-- Role permissions the Principal Contractor can switch on and off from Team &
-- Access. Stored in app_settings as perm:<name> = 'true' / 'false'.

insert into public.app_settings (key, value) values
  ('perm:pm_send_reports', 'false'),
  ('perm:pm_create_projects', 'false'),
  ('perm:clients_start_chats', 'true')
on conflict (key) do nothing;

create or replace function public.permission(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select value = 'true' from public.app_settings where key = 'perm:' || p_name), false)
$$;
grant execute on function public.permission(text) to authenticated;

-- Clients can only start chats while "Clients start new chats" is on.
drop policy if exists "chats: create" on public.chats;
create policy "chats: create" on public.chats for insert to authenticated
  with check (
    public.can_access_project(project_id) and not is_internal and created_by = auth.uid()
    and (public.is_team() or public.permission('clients_start_chats'))
  );
