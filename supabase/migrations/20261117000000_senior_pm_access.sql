-- Senior PMs oversee every project: they can open every project, its chats
-- (internal ones too), files and progress reports, like the Principal
-- Contractor and Admins, without being added to each one. Being on a project
-- still decides who writes its daily log and who gets message emails and
-- phone notifications, so nothing changes there. Admin-only tools (Team &
-- Access, inviting clients, deleting projects, Basecamp import, sending
-- reports) stay admin-only.

-- Whether the signed-in person is a Senior PM (set in Team & Access).
create or replace function public.is_senior_pm() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_settings s
    join public.profiles p on p.id = auth.uid()
    where s.key = 'senior_pm:' || auth.uid()::text and p.role = 'construction'
  )
$$;
revoke execute on function public.is_senior_pm() from public, anon;
grant execute on function public.is_senior_pm() to authenticated;

create or replace function public.can_access_project(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin()
      or public.is_senior_pm()
      or exists (select 1 from public.project_members m
                 where m.project_id = p_project and m.user_id = auth.uid())
$$;
