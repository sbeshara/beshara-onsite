-- Plans & takeoff for the whole team, and a scope-only view of proposals.
--
--   * Plans, takeoffs and markup: every team member on the jobs they can open
--     (PMs: their own jobs in Preconstruction, Permitting or Construction).
--     Clients still never see them; they only get PDFs the team sends.
--   * Markup gains callouts (a leader arrow to a boxed note).
--   * PMs see each proposal's scope (groups, descriptions, items, quantities)
--     through estimate_scope(), which never returns costs or prices. The
--     estimate tables themselves stay office only.

create or replace function public.team_can_open(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.is_team() and public.can_access_project(p_project) $$;
revoke execute on function public.team_can_open(uuid) from public, anon;
grant execute on function public.team_can_open(uuid) to authenticated;

drop policy "plan files: office" on public.plan_files;
drop policy "plan sheets: office" on public.plan_sheets;
drop policy "takeoff: office" on public.takeoff_measurements;
drop policy "markups: office" on public.plan_markups;
create policy "plan files: team" on public.plan_files for all to authenticated using (public.team_can_open(project_id)) with check (public.team_can_open(project_id));
create policy "plan sheets: team" on public.plan_sheets for all to authenticated using (public.team_can_open(project_id)) with check (public.team_can_open(project_id));
create policy "takeoff: team" on public.takeoff_measurements for all to authenticated using (public.team_can_open(project_id)) with check (public.team_can_open(project_id));
create policy "markups: team" on public.plan_markups for all to authenticated using (public.team_can_open(project_id)) with check (public.team_can_open(project_id));

-- Plan PDFs live at <project_id>/<file>.pdf.
drop policy "plans: office read" on storage.objects;
drop policy "plans: office upload" on storage.objects;
drop policy "plans: office delete" on storage.objects;
create policy "plans: team read" on storage.objects for select to authenticated
  using (bucket_id = 'plans' and public.team_can_open(((storage.foldername(name))[1])::uuid));
create policy "plans: team upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'plans' and public.team_can_open(((storage.foldername(name))[1])::uuid));
create policy "plans: team delete" on storage.objects for delete to authenticated
  using (bucket_id = 'plans' and public.team_can_open(((storage.foldername(name))[1])::uuid));

alter table public.plan_markups drop constraint plan_markups_kind_check;
alter table public.plan_markups add constraint plan_markups_kind_check
  check (kind in ('pen', 'line', 'arrow', 'rect', 'cloud', 'text', 'callout'));

-- A job's proposals as scope only: no costs, prices or totals.
create or replace function public.estimate_scope(p_project uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when not public.team_can_open(p_project) then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'seq', e.seq, 'kind', e.kind, 'name', e.name, 'status', e.status, 'signed_at', e.signed_at,
      'groups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id, 'name', g.name, 'description', g.description,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'name', i.name, 'description', i.description, 'quantity', i.quantity,
              'measurement_id', i.measurement_id, 'qty_factor', i.qty_factor, 'waste_pct', i.waste_pct,
              'unit', u.abbr) order by i.position)
            from public.estimate_items i left join public.units u on u.id = i.unit_id
            where i.group_id = g.id), '[]'::jsonb)) order by g.position)
        from public.estimate_groups g where g.estimate_id = e.id), '[]'::jsonb)
    ) order by e.seq)
    from public.estimates e
    where e.project_id = p_project and e.status <> 'draft'), '[]'::jsonb) end
$$;
revoke execute on function public.estimate_scope(uuid) from public, anon;
grant execute on function public.estimate_scope(uuid) to authenticated;
