-- What the client's copy of a document shows: line items, their
-- descriptions, quantities, unit prices, line totals and group totals.
-- Missing keys mean "show". Unit costs, profit and margin never show.
alter table public.estimates add column if not exists client_show jsonb not null default '{}'::jsonb;

-- The job budget: every cost group and cost item for a job, itemized, for
-- the office only. Documents (proposals, change orders, additional scope) are
-- made by ticking budget lines; each document line remembers its budget line.
--
-- While a document is a draft, pending or declined, its lines and their
-- budget lines stay in sync both ways. A signed document is frozen; the budget
-- can keep changing without touching it.

create table public.budget_groups (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  name         text not null default 'New group' check (char_length(name) <= 120),
  description  text not null default '',
  position     integer not null default 0,
  jobtread_id  text unique,
  created_at   timestamptz not null default now()
);
create index budget_groups_project_idx on public.budget_groups (project_id, position);

create table public.budget_items (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  group_id          uuid not null references public.budget_groups (id) on delete cascade,
  catalog_item_id   uuid references public.cost_items (id) on delete set null,
  name              text not null default 'Item' check (char_length(name) <= 200),
  description       text not null default '',
  cost_type_id      smallint references public.cost_types (id) on delete set null,
  unit_id           smallint references public.units (id) on delete set null,
  quantity          numeric not null default 1,
  unit_cost         numeric not null default 0,
  unit_price        numeric not null default 0,
  measurement_id    uuid references public.takeoff_measurements (id) on delete set null,
  qty_factor        numeric not null default 1,
  waste_pct         numeric not null default 0,
  position          integer not null default 0,
  jobtread_id       text unique,
  created_at        timestamptz not null default now()
);
create index budget_items_group_idx on public.budget_items (group_id, position);
create index budget_items_project_idx on public.budget_items (project_id);

alter table public.estimate_groups add column if not exists budget_group_id uuid references public.budget_groups (id) on delete set null;
alter table public.estimate_items  add column if not exists budget_item_id  uuid references public.budget_items (id) on delete set null;
create index if not exists estimate_items_budget_idx on public.estimate_items (budget_item_id);

alter table public.budget_groups enable row level security;
alter table public.budget_items enable row level security;
create policy "budget groups: office" on public.budget_groups for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "budget items: office" on public.budget_items for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
revoke all on public.budget_groups, public.budget_items from anon;
grant select, insert, update, delete on public.budget_groups, public.budget_items to authenticated, service_role;

-- Budget line changed: carry it to the lines of unsigned documents.
create or replace function public.budget_item_to_docs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  update public.estimate_items ei
     set name = new.name, description = new.description, cost_type_id = new.cost_type_id, unit_id = new.unit_id,
         quantity = new.quantity, unit_cost = new.unit_cost, unit_price = new.unit_price,
         measurement_id = new.measurement_id, qty_factor = new.qty_factor, waste_pct = new.waste_pct
    from public.estimates e
   where ei.budget_item_id = new.id and e.id = ei.estimate_id and e.status <> 'approved';
  return new;
end $$;
create trigger budget_items_sync after update on public.budget_items
  for each row execute function public.budget_item_to_docs();

-- Unsigned document line changed: carry it to its budget line.
create or replace function public.doc_item_to_budget() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.budget_item_id is null then return new; end if;
  if exists (select 1 from public.estimates e where e.id = new.estimate_id and e.status = 'approved') then return new; end if;
  update public.budget_items
     set name = new.name, description = new.description, cost_type_id = new.cost_type_id, unit_id = new.unit_id,
         quantity = new.quantity, unit_cost = new.unit_cost, unit_price = new.unit_price,
         measurement_id = new.measurement_id, qty_factor = new.qty_factor, waste_pct = new.waste_pct
   where id = new.budget_item_id;
  return new;
end $$;
create trigger estimate_items_to_budget after update on public.estimate_items
  for each row execute function public.doc_item_to_budget();

-- Same for group names and descriptions.
create or replace function public.budget_group_to_docs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  update public.estimate_groups eg set name = new.name, description = new.description
    from public.estimates e
   where eg.budget_group_id = new.id and e.id = eg.estimate_id and e.status <> 'approved';
  return new;
end $$;
create trigger budget_groups_sync after update of name, description on public.budget_groups
  for each row execute function public.budget_group_to_docs();

create or replace function public.doc_group_to_budget() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.budget_group_id is null then return new; end if;
  if exists (select 1 from public.estimates e where e.id = new.estimate_id and e.status = 'approved') then return new; end if;
  update public.budget_groups set name = new.name, description = new.description where id = new.budget_group_id;
  return new;
end $$;
create trigger estimate_groups_to_budget after update of name, description on public.estimate_groups
  for each row execute function public.doc_group_to_budget();

revoke all on function public.budget_item_to_docs(), public.doc_item_to_budget(), public.budget_group_to_docs(), public.doc_group_to_budget() from public, anon, authenticated;

-- Signed documents stay locked, except for linking their lines to the budget.
create or replace function public.guard_signed_estimate() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare est uuid;
begin
  if tg_table_name = 'estimate_payment_steps' and tg_op = 'UPDATE' then
    -- Marking a step reached is billing progress, not a change to what was signed.
    if new.name is not distinct from old.name and new.percent is not distinct from old.percent
       and new.position is not distinct from old.position and new.estimate_id = old.estimate_id then
      return new;
    end if;
  end if;
  if tg_table_name in ('estimate_items', 'estimate_groups') and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'budget_item_id' - 'budget_group_id') = (to_jsonb(old) - 'budget_item_id' - 'budget_group_id') then
    return new;
  end if;
  est := case when tg_op = 'DELETE' then old.estimate_id else new.estimate_id end;
  if exists (select 1 from public.estimates where id = est and status = 'approved') then
    raise exception 'This estimate is signed and locked. Add a change order instead.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
