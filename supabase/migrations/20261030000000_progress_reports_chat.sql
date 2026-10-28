-- Rename the starter chat to "Progress Reports" on every project, and use
-- that name for new projects.

update public.chats c set name = 'Progress Reports'
where c.name in ('Weekly Progress Report', 'Weekly Updates')
  and not exists (
    select 1 from public.chats o
    where o.project_id = c.project_id and lower(o.name) = 'progress reports'
  );

create or replace function public.create_default_chats() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.chats (project_id, name, is_internal, position, created_by) values
    (new.id, 'Progress Reports',       false, 1,    new.created_by),
    (new.id, 'Selections & Finishes',  false, 2,    new.created_by),
    (new.id, 'Schedule & Inspections', false, 3,    new.created_by),
    (new.id, 'Internal Only',          true,  1000, new.created_by);
  return new;
end;
$$;
