-- E-sign: the client reviews and signs proposals in OnSite.
--
-- Sending freezes the client's copy (client_copy): exactly what they see,
-- with no costs or margins. That frozen copy is what gets signed, so later
-- edits can't change a signed document. Clients never read the estimate
-- tables; they get their copies through client_proposals() and sign through
-- sign_estimate().

alter table public.estimates
  add column client_copy     jsonb,
  add column sent_by         uuid references public.profiles (id) on delete set null,
  add column signed_by       uuid references public.profiles (id) on delete set null,
  add column signature       text check (signature is null or char_length(signature) <= 300000),  -- PNG data URL of the drawn signature
  add column signed_from     text,                                                                  -- browser, for the record
  add column declined_at     timestamptz,
  add column decline_reason  text check (decline_reason is null or char_length(decline_reason) <= 2000);

-- The sent, signed and declined proposals of a project, as the client sees them.
create or replace function public.client_proposals(p_project uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when not public.can_access_project(p_project) then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'seq', e.seq, 'kind', e.kind, 'name', e.name, 'status', e.status,
      'sent_at', e.sent_at, 'signed_at', e.signed_at, 'signed_by_name', e.signed_by_name,
      'signature', e.signature, 'declined_at', e.declined_at, 'copy', e.client_copy) order by e.seq desc)
    from public.estimates e
    where e.project_id = p_project and e.status in ('pending', 'approved', 'denied') and e.client_copy is not null), '[]'::jsonb) end
$$;

-- The client (or anyone on the project acting for them) signs a sent proposal.
create or replace function public.sign_estimate(p_id uuid, p_name text, p_signature text, p_from text) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.estimates;
begin
  select * into e from public.estimates where id = p_id for update;
  if e.id is null or not public.can_access_project(e.project_id) then raise exception 'Proposal not found'; end if;
  if e.status <> 'pending' then raise exception 'This proposal is not waiting for a signature'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Type your full name to sign'; end if;
  if p_signature is null or p_signature not like 'data:image/png;base64,%' then raise exception 'Draw your signature to sign'; end if;
  update public.estimates
     set status = 'approved', signed_at = now(), signed_by = auth.uid(), signed_by_name = trim(p_name),
         signature = p_signature, signed_from = left(p_from, 300)
   where id = p_id;
  -- A signed proposal turns a lead into an approved job.
  if e.kind = 'Proposal' then
    update public.projects set status = 'Approved' where id = e.project_id and status in ('New Lead', 'Estimating', 'On Hold');
  end if;
end;
$$;

create or replace function public.decline_estimate(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.estimates;
begin
  select * into e from public.estimates where id = p_id for update;
  if e.id is null or not public.can_access_project(e.project_id) then raise exception 'Proposal not found'; end if;
  if e.status <> 'pending' then raise exception 'This proposal is not waiting for a signature'; end if;
  update public.estimates set status = 'denied', declined_at = now(), decline_reason = nullif(trim(p_reason), '') where id = p_id;
end;
$$;

revoke execute on function public.client_proposals(uuid), public.sign_estimate(uuid, text, text, text), public.decline_estimate(uuid, text) from public, anon;
grant execute on function public.client_proposals(uuid), public.sign_estimate(uuid, text, text, text), public.decline_estimate(uuid, text) to authenticated;

-- The status change from signing happens inside sign_estimate (security
-- definer), so the guard that limits who moves a project's status lets it through.
create or replace function public.guard_project_office_fields() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or public.sees_numbers() then return new; end if;
  if new.job_number is distinct from old.job_number
     or new.customer_id is distinct from old.customer_id
     or new.job_type is distinct from old.job_type
     or new.address is distinct from old.address
     or new.notes is distinct from old.notes
     or new.jobtread_invoice_job_ids is distinct from old.jobtread_invoice_job_ids then
    raise exception 'Only the Owner, Admin, Senior PM or Preconstruction Manager can edit job details';
  end if;
  if new.status is distinct from old.status
     and not (old.status in ('Preconstruction', 'Permitting', 'Construction') and new.status in ('Preconstruction', 'Permitting', 'Construction'))
     and not (new.status = 'Approved' and old.status in ('New Lead', 'Estimating', 'On Hold')
              and exists (select 1 from public.estimates x where x.project_id = new.id and x.kind = 'Proposal' and x.status = 'approved' and x.signed_at > now() - interval '1 minute')) then
    raise exception 'Only the Owner, Admin, Senior PM or Preconstruction Manager can move a job to %', new.status;
  end if;
  return new;
end;
$$;

-- Proposals usually go out while the job is still a lead, so a client the
-- team has invited to a lead can open it (to read and sign). Leads nobody
-- invited them to stay invisible, and Closed Lost jobs close to clients.
create or replace function public.can_access_project(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.sees_numbers()
      or exists (
        select 1 from public.project_members m
        join public.projects p on p.id = m.project_id
        join public.profiles me on me.id = m.user_id
        where m.project_id = p_project and m.user_id = auth.uid()
          and case me.role
                when 'construction' then p.status in ('Preconstruction', 'Permitting', 'Construction')
                when 'client' then p.status <> 'Closed Lost'
                else true end
      )
$$;
