-- Invoicing with QuickBooks Online.
--
-- Invoices are made in OnSite from a signed estimate's payment steps, pushed
-- to QuickBooks Online and emailed by QuickBooks (with its pay-online link),
-- so the admin never needs a QuickBooks login. Payments recorded in
-- QuickBooks come back here (webhook, or "Check now") with date, amount and
-- method.
--
-- Who: the Owner, Admin, Senior PM and Preconstruction Manager see invoicing;
-- the Owner and Admin create and send invoices. The QuickBooks connection
-- (tokens) is server-only.

alter table public.estimate_payment_steps
  add column reached_at timestamptz,                -- the work for this step is done: ready to invoice
  add column reached_by uuid references public.profiles (id) on delete set null;
alter table public.customers add column qbo_customer_id text;

create table public.invoices (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  estimate_id      uuid references public.estimates (id) on delete set null,
  step_id          uuid references public.estimate_payment_steps (id) on delete set null,
  seq              integer not null,                    -- shown as <job number>-<seq>, shared with estimates
  description      text not null default '',
  amount           numeric(14, 2) not null check (amount > 0),
  status           text not null default 'draft' check (status in ('draft', 'sent', 'partial', 'paid', 'void')),
  issued_on        date not null default current_date,
  due_on           date,
  email_to         text,
  memo             text not null default '',
  sent_at          timestamptz,
  sent_by          uuid references public.profiles (id) on delete set null,
  paid_total       numeric(14, 2) not null default 0,
  qbo_invoice_id   text unique,
  qbo_synced_at    timestamptz,
  qbo_error        text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (project_id, seq)
);
create index invoices_project_idx on public.invoices (project_id, seq);
create unique index invoices_one_per_step on public.invoices (step_id) where step_id is not null and status <> 'void';

create table public.invoice_payments (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices (id) on delete cascade,
  amount          numeric(14, 2) not null,
  paid_on         date not null,
  method          text,                               -- e.g. "ACH", "Check #1042"
  qbo_payment_id  text,
  created_at      timestamptz not null default now(),
  unique (invoice_id, qbo_payment_id)
);
create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id);

-- One QuickBooks company. Tokens never leave the server.
create table public.qbo_connection (
  id                  boolean primary key default true check (id),
  realm_id            text not null,
  company_name        text,
  access_token        text not null,
  refresh_token       text not null,
  access_expires_at   timestamptz not null,
  refresh_expires_at  timestamptz,
  item_id             text,                           -- the QuickBooks product/service invoices are billed under
  last_payment_check  timestamptz,
  connected_by        uuid references public.profiles (id) on delete set null,
  connected_at        timestamptz not null default now()
);
alter table public.qbo_connection enable row level security;  -- no policies: server only
revoke all on public.qbo_connection from anon, authenticated;

-- Estimates and invoices share each job's document numbers.
create or replace function public.next_doc_seq(p_project uuid) returns integer
language sql volatile set search_path = ''
as $$
  select greatest(
    coalesce((select max(seq) from public.estimates where project_id = p_project), 0),
    coalesce((select max(seq) from public.invoices where project_id = p_project), 0)) + 1
$$;
create or replace function public.next_estimate_seq() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.seq is null then
    perform pg_advisory_xact_lock(hashtext(new.project_id::text));
    new.seq := public.next_doc_seq(new.project_id);
  end if;
  return new;
end;
$$;
create trigger invoices_seq before insert on public.invoices for each row execute function public.next_estimate_seq();

-- paid_total and status follow the payments.
create or replace function public.sync_invoice_paid() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare inv uuid := coalesce(new.invoice_id, old.invoice_id); total numeric;
begin
  select coalesce(sum(amount), 0) into total from public.invoice_payments where invoice_id = inv;
  update public.invoices
     set paid_total = total,
         status = case when status in ('draft', 'void') then status
                       when total >= amount - 0.005 then 'paid'
                       when total > 0 then 'partial' else 'sent' end
   where id = inv;
  return null;
end;
$$;
create trigger invoice_payments_sync after insert or update or delete on public.invoice_payments for each row execute function public.sync_invoice_paid();

alter table public.invoices enable row level security;
alter table public.invoice_payments enable row level security;
create policy "invoices: office read" on public.invoices for select to authenticated using (public.sees_numbers());
create policy "invoices: admin write" on public.invoices for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "payments: office read" on public.invoice_payments for select to authenticated using (public.sees_numbers());
create policy "payments: admin write" on public.invoice_payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.invoices, public.invoice_payments from anon;

-- Signed estimates stay locked, except marking a payment step reached (that's
-- billing progress, not a change to what was signed).
create or replace function public.guard_signed_estimate() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare est uuid;
begin
  if tg_table_name = 'estimate_payment_steps' and tg_op = 'UPDATE'
     and new.name is not distinct from old.name and new.percent is not distinct from old.percent
     and new.position is not distinct from old.position and new.estimate_id = old.estimate_id then
    return new;
  end if;
  est := coalesce(new.estimate_id, old.estimate_id);
  if exists (select 1 from public.estimates where id = est and status = 'approved') then
    raise exception 'This estimate is signed and locked. Add a change order instead.';
  end if;
  return coalesce(new, old);
end;
$$;
