-- OnSite Office, part 2: plans & takeoff, and the estimate builder.
--
-- Plans are internal: only people who see numbers (Owner, Admin, Senior PM,
-- Preconstruction Manager) can open them. Clients never see the Plans section;
-- when the team wants to share a marked-up set, it's exported to a PDF and
-- added to the project's files like any other drawing.
--
-- Takeoff measurements are stored in PDF points (1/72 inch, top-left origin),
-- so they don't depend on how large a sheet is rendered on screen.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

create table public.plan_files (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 200),
  storage_path  text not null unique,           -- in the 'plans' bucket: <project_id>/<uuid>.pdf
  page_count    integer not null default 0,
  uploaded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index plan_files_project_idx on public.plan_files (project_id, created_at);

create table public.plan_sheets (
  id               uuid primary key default gen_random_uuid(),
  plan_file_id     uuid not null references public.plan_files (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  page_number      integer not null check (page_number >= 1),
  name             text not null default '',
  width_pt         numeric not null,
  height_pt        numeric not null,
  -- The sheet's scale: paper inches per real foot (1/4" = 1'-0" is 0.25), or a
  -- calibration in PDF points per real foot. One or neither, never both.
  scale_in_per_ft  numeric check (scale_in_per_ft > 0),
  points_per_foot  numeric check (points_per_foot > 0),
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  unique (plan_file_id, page_number),
  check (scale_in_per_ft is null or points_per_foot is null)
);
create index plan_sheets_project_idx on public.plan_sheets (project_id, position);

create table public.takeoff_measurements (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  sheet_id    uuid not null references public.plan_sheets (id) on delete cascade,
  name        text not null default 'Takeoff' check (char_length(name) <= 120),
  kind        text not null check (kind in ('linear', 'area', 'count')),
  color       text not null default '#C0643A',
  points      jsonb not null default '[]',      -- [[x, y], ...] in PDF points
  hidden      boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index takeoff_measurements_project_idx on public.takeoff_measurements (project_id);
create index takeoff_measurements_sheet_idx on public.takeoff_measurements (sheet_id);

-- Markup: notes drawn on a sheet (pen, line, arrow, rectangle, cloud, text).
-- They don't measure anything; they go out on exported PDFs.
create table public.plan_markups (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  sheet_id    uuid not null references public.plan_sheets (id) on delete cascade,
  kind        text not null check (kind in ('pen', 'line', 'arrow', 'rect', 'cloud', 'text')),
  color       text not null default '#C2416D',
  data        jsonb not null,                   -- {points: [[x,y],...]} or {x, y, text, size}
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index plan_markups_sheet_idx on public.plan_markups (sheet_id);

-- ---------------------------------------------------------------------------
-- Estimates: proposals, change orders and additional scope
-- ---------------------------------------------------------------------------

create table public.estimates (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  seq             integer not null,                      -- shown as <job number>-<seq>
  kind            text not null default 'Proposal' check (kind in ('Proposal', 'Change Order', 'Additional Scope')),
  name            text not null default 'Proposal' check (char_length(trim(name)) between 1 and 160),
  status          text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'denied')),
  intro           text not null default '',
  terms           text not null default '',
  issued_on       date not null default current_date,
  sent_at         timestamptz,
  signed_at       timestamptz,
  signed_by_name  text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, seq)
);
create index estimates_project_idx on public.estimates (project_id, seq);

create table public.estimate_groups (
  id            uuid primary key default gen_random_uuid(),
  estimate_id   uuid not null references public.estimates (id) on delete cascade,
  name          text not null default 'New group' check (char_length(name) <= 120),
  description   text not null default '',
  -- What the client sees: every item with prices, items without prices, or the group total only.
  client_view   text not null default 'total' check (client_view in ('items', 'qty', 'total')),
  display_qty   numeric,                                  -- shown with the total (e.g. 2,280 SF); null = lump sum
  display_unit  text,
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);
create index estimate_groups_estimate_idx on public.estimate_groups (estimate_id, position);

create table public.estimate_items (
  id                uuid primary key default gen_random_uuid(),
  estimate_id       uuid not null references public.estimates (id) on delete cascade,
  group_id          uuid not null references public.estimate_groups (id) on delete cascade,
  catalog_item_id   uuid references public.cost_items (id) on delete set null,
  name              text not null default 'Item' check (char_length(name) <= 200),
  description       text not null default '',
  cost_type_id      smallint references public.cost_types (id) on delete set null,
  unit_id           smallint references public.units (id) on delete set null,
  quantity          numeric not null default 1,
  unit_cost         numeric not null default 0,
  unit_price        numeric not null default 0,
  -- Quantity from a takeoff: measurement value × factor × (1 + waste %).
  measurement_id    uuid references public.takeoff_measurements (id) on delete set null,
  qty_factor        numeric not null default 1,
  waste_pct         numeric not null default 0,
  position          integer not null default 0,
  created_at        timestamptz not null default now()
);
create index estimate_items_group_idx on public.estimate_items (group_id, position);
create index estimate_items_measurement_idx on public.estimate_items (measurement_id);

create table public.estimate_payment_steps (
  id           uuid primary key default gen_random_uuid(),
  estimate_id  uuid not null references public.estimates (id) on delete cascade,
  name         text not null check (char_length(name) <= 120),
  percent      numeric not null check (percent >= 0 and percent <= 100),
  position     integer not null default 0
);
create index estimate_payment_steps_idx on public.estimate_payment_steps (estimate_id, position);

-- Each estimate gets the job's next number (set before the NOT NULL check runs).
create or replace function public.next_estimate_seq() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.seq is null then
    perform pg_advisory_xact_lock(hashtext(new.project_id::text));
    select coalesce(max(seq), 0) + 1 into new.seq from public.estimates where project_id = new.project_id;
  end if;
  return new;
end;
$$;
create trigger estimates_seq before insert on public.estimates for each row execute function public.next_estimate_seq();

-- Signed estimates are locked: change the scope with a change order.
create or replace function public.guard_signed_estimate() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare est uuid;
begin
  est := coalesce(new.estimate_id, old.estimate_id);
  if exists (select 1 from public.estimates where id = est and status = 'approved') then
    raise exception 'This estimate is signed and locked. Add a change order instead.';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger estimate_groups_locked before insert or update or delete on public.estimate_groups for each row execute function public.guard_signed_estimate();
create trigger estimate_items_locked before insert or update or delete on public.estimate_items for each row execute function public.guard_signed_estimate();
create trigger estimate_steps_locked before insert or update or delete on public.estimate_payment_steps for each row execute function public.guard_signed_estimate();

create trigger estimates_touch before update on public.estimates for each row execute function public.touch_updated_at();
create trigger takeoff_measurements_touch before update on public.takeoff_measurements for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: the office only (sees_numbers()).
-- ---------------------------------------------------------------------------

alter table public.plan_files enable row level security;
alter table public.plan_sheets enable row level security;
alter table public.takeoff_measurements enable row level security;
alter table public.plan_markups enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_groups enable row level security;
alter table public.estimate_items enable row level security;
alter table public.estimate_payment_steps enable row level security;

create policy "plan files: office" on public.plan_files for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "plan sheets: office" on public.plan_sheets for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "takeoff: office" on public.takeoff_measurements for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "markups: office" on public.plan_markups for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "estimates: office" on public.estimates for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "estimate groups: office" on public.estimate_groups for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "estimate items: office" on public.estimate_items for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
create policy "payment steps: office" on public.estimate_payment_steps for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());

revoke all on public.plan_files, public.plan_sheets, public.takeoff_measurements, public.plan_markups,
  public.estimates, public.estimate_groups, public.estimate_items, public.estimate_payment_steps from anon;

-- Plan PDFs: a private bucket only the office can read or write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plans', 'plans', false, 209715200, array['application/pdf'])  -- 200 MB per set
on conflict (id) do nothing;

create policy "plans: office read" on storage.objects for select to authenticated
  using (bucket_id = 'plans' and public.sees_numbers());
create policy "plans: office upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'plans' and public.sees_numbers());
create policy "plans: office delete" on storage.objects for delete to authenticated
  using (bucket_id = 'plans' and public.sees_numbers());
