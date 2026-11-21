-- OnSite Office, part 1: the foundation the estimating, scheduling and
-- invoicing tools build on.
--
--   * Preconstruction Manager: a team member who builds bids and scopes.
--   * Who sees numbers (prices, costs, margins) and leads: the Owner, Admins,
--     Senior PMs and Preconstruction Managers. PMs (Construction Management)
--     see only their own jobs while they're in Preconstruction, Permitting or
--     Construction, and
--     never see dollar amounts.
--   * One job status list replaces JobTread's Status field. OnSite's project
--     phase (what clients see) now follows the status; there's no Punch List
--     stage any more, it's part of Construction.
--   * Customers and their contacts, and the catalog (cost types, units, cost
--     groups, cost items), all importable from JobTread.

-- ---------------------------------------------------------------------------
-- Preconstruction Managers, kept like Senior PMs: a Construction Management
-- person with a flag in app_settings ('precon:<user id>').
-- ---------------------------------------------------------------------------

create or replace function public.is_precon() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_settings s
    join public.profiles p on p.id = auth.uid()
    where s.key = 'precon:' || auth.uid()::text and p.role = 'construction'
  )
$$;

-- Owner, Admin, Senior PM and Preconstruction Manager: every job and lead,
-- every number.
create or replace function public.sees_numbers() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.is_admin() or public.is_senior_pm() or public.is_precon() $$;

revoke execute on function public.is_precon(), public.sees_numbers() from public, anon;
grant execute on function public.is_precon(), public.sees_numbers() to authenticated;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create table public.customers (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(trim(name)) between 1 and 160),
  email                text,
  phone                text,
  address              text,
  notes                text,
  jobtread_account_id  text unique,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index customers_name_idx on public.customers (lower(name));

create table public.customer_contacts (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references public.customers (id) on delete cascade,
  name                 text not null check (char_length(trim(name)) between 1 and 160),
  title                text,
  email                text,
  phone                text,
  is_primary           boolean not null default false,
  profile_id           uuid references public.profiles (id) on delete set null,  -- their OnSite login, once invited
  jobtread_contact_id  text unique,
  created_at           timestamptz not null default now()
);
create index customer_contacts_customer_idx on public.customer_contacts (customer_id);

-- ---------------------------------------------------------------------------
-- Jobs: OnSite projects gain a status, number, customer and job details.
-- ---------------------------------------------------------------------------

create or replace function public.job_statuses() returns text[]
language sql immutable as $$
  select array['New Lead', 'Estimating', 'On Hold', 'Closed Lost',
               'Approved', 'Preconstruction', 'Permitting', 'Construction', 'Complete']
$$;

-- Leads: only people who see numbers see these.
create or replace function public.is_lead_status(s text) returns boolean
language sql immutable as $$ select s in ('New Lead', 'Estimating', 'On Hold', 'Closed Lost') $$;

alter table public.projects
  add column status        text not null default 'Preconstruction' check (status = any (public.job_statuses())),
  add column job_number    text unique,
  add column customer_id   uuid references public.customers (id) on delete set null,
  add column job_type      text,
  add column address       text,
  add column notes         text,
  add column status_changed_at timestamptz not null default now(),
  -- JobTread's separate "Internal - Invoices" jobs that belong to this job,
  -- so their payment schedules and invoices import here.
  add column jobtread_invoice_job_ids text[] not null default '{}';
create index projects_status_idx on public.projects (status);
-- Signed-in people update projects column by column (see the init migration); the guard below decides who may change which.
grant update (status, job_number, customer_id, job_type, address, notes) on public.projects to authenticated;
create index projects_customer_idx on public.projects (customer_id);

-- Existing projects: status from their phase. Punch List (3) is Construction now.
update public.projects set status = case phase
  when 1 then 'Permitting' when 2 then 'Construction' when 3 then 'Construction' when 4 then 'Complete'
  else 'Preconstruction' end;
update public.projects set phase = 2 where phase = 3;

-- The phase clients see follows the status (named to run before the other
-- update triggers, so they see the final status). Older screens that still set the
-- phase directly move the status with it.
create or replace function public.sync_project_phase() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.phase := case new.status
      when 'Permitting' then 1 when 'Construction' then 2 when 'Complete' then 4 else 0 end;
  elsif new.phase is distinct from old.phase then
    if new.phase = 3 then new.phase := 2; end if;
    new.status := case new.phase
      when 1 then 'Permitting' when 2 then 'Construction' when 4 then 'Complete' else
        case when old.status in ('Approved', 'Preconstruction') then old.status else 'Preconstruction' end end;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then new.status_changed_at := now(); end if;
  return new;
end;
$$;
create trigger projects_a_sync_phase
  before insert or update of status, phase on public.projects
  for each row execute function public.sync_project_phase();

-- Only people who see numbers change a job's details, number or customer;
-- PMs may move a job between Preconstruction, Permitting and Construction.
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
     and not (old.status in ('Preconstruction', 'Permitting', 'Construction') and new.status in ('Preconstruction', 'Permitting', 'Construction')) then
    raise exception 'Only the Owner, Admin, Senior PM or Preconstruction Manager can move a job to %', new.status;
  end if;
  return new;
end;
$$;
create trigger projects_guard_office_fields
  before update on public.projects
  for each row execute function public.guard_project_office_fields();

-- Senior PMs and Preconstruction Managers may now rename a job and change its
-- town and scope too (they run leads and bids); the primary client stays with
-- the Owner and Admins.
create or replace function public.guard_project_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() and (
       new.primary_client_id is distinct from old.primary_client_id
    or (not public.sees_numbers() and (
         new.name is distinct from old.name
      or new.town is distinct from old.town
      or new.scope is distinct from old.scope))
  ) then
    raise exception 'Only the Owner or Admin can edit project details';
  end if;
  return new;
end;
$$;

-- Who can open a project:
--   Owner, Admin, Senior PM, Preconstruction Manager: every project and lead
--   PM (Construction Management): their assigned jobs in Preconstruction, Permitting or Construction
--   Client: the projects they're on, never leads
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
                when 'client' then not public.is_lead_status(p.status)
                else true end
      )
$$;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table public.cost_types (
  id        smallint generated by default as identity primary key,
  name      text not null unique,
  position  smallint not null default 100
);
insert into public.cost_types (name, position) values
  ('Labor & Material', 1), ('Labor', 2), ('Materials', 3), ('Subcontractor', 4), ('T&M', 5);

create table public.units (
  id    smallint generated by default as identity primary key,
  name  text not null unique,
  abbr  text not null
);
insert into public.units (name, abbr) values
  ('Lump Sum', 'LS'), ('Square Feet', 'SF'), ('Linear Feet', 'LF'), ('Each', 'EA'), ('Hours', 'HR');

-- Cost groups: a group's description is what clients read on proposals. A
-- group can sit inside another (e.g. "Interior Fit Out" holding the trades),
-- which is how estimate templates are kept.
create table public.cost_groups (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references public.cost_groups (id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 120),
  description  text not null default '',
  position     integer not null default 100,
  archived     boolean not null default false,
  jobtread_id  text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index cost_groups_parent_idx on public.cost_groups (parent_id, position);

create table public.cost_items (
  id            uuid primary key default gen_random_uuid(),
  cost_group_id uuid references public.cost_groups (id) on delete set null,
  name          text not null check (char_length(trim(name)) between 1 and 200),
  description   text not null default '',
  cost_type_id  smallint references public.cost_types (id) on delete set null,
  unit_id       smallint references public.units (id) on delete set null,
  quantity      numeric(14, 4),               -- default quantity, if any
  unit_cost     numeric(14, 4),
  unit_price    numeric(14, 4),
  position      integer not null default 100,
  archived      boolean not null default false,
  jobtread_id   text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index cost_items_group_idx on public.cost_items (cost_group_id, position);
create index cost_items_name_idx on public.cost_items (lower(name));

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();
create trigger cost_groups_touch before update on public.cost_groups for each row execute function public.touch_updated_at();
create trigger cost_items_touch before update on public.cost_items for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.cost_types enable row level security;
alter table public.units enable row level security;
alter table public.cost_groups enable row level security;
alter table public.cost_items enable row level security;

-- Customers: people who see numbers see and manage all of them. PMs see the
-- customer (and contacts) of the jobs they can open, read only.
create function public.can_see_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.sees_numbers()
      or exists (select 1 from public.projects p where p.customer_id = p_customer and public.is_team() and public.can_access_project(p.id))
$$;
revoke execute on function public.can_see_customer(uuid) from public, anon;
grant execute on function public.can_see_customer(uuid) to authenticated;

create policy "customers: read" on public.customers for select to authenticated using (public.can_see_customer(id));
create policy "customers: add" on public.customers for insert to authenticated with check (public.sees_numbers());
create policy "customers: edit" on public.customers for update to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "customers: delete" on public.customers for delete to authenticated using (public.sees_numbers());

create policy "contacts: read" on public.customer_contacts for select to authenticated using (public.can_see_customer(customer_id));
create policy "contacts: add" on public.customer_contacts for insert to authenticated with check (public.sees_numbers());
create policy "contacts: edit" on public.customer_contacts for update to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "contacts: delete" on public.customer_contacts for delete to authenticated using (public.sees_numbers());

-- Cost types and units are just labels: the whole team can read them.
create policy "cost types: read" on public.cost_types for select to authenticated using (public.is_team());
create policy "cost types: manage" on public.cost_types for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "units: read" on public.units for select to authenticated using (public.is_team());
create policy "units: manage" on public.units for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());

-- The catalog holds costs and prices: only people who see numbers.
create policy "cost groups: all" on public.cost_groups for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "cost items: all" on public.cost_items for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());

revoke all on public.customers, public.customer_contacts, public.cost_types, public.units, public.cost_groups, public.cost_items from anon;
