-- Document templates (New Build Proposal, Change Order, Additional Scope, …):
-- the type, intro and terms a new estimate starts with. Imported from
-- JobTread's document templates, editable here. The budget (cost groups and
-- items) is picked separately from the catalog.
--
-- Estimates also remember the JobTread document they came from, so the import
-- can run again without duplicating them.

create table public.document_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(trim(name)) between 1 and 120),
  kind            text not null default 'Proposal' check (kind in ('Proposal', 'Change Order', 'Additional Scope')),
  intro           text not null default '',
  terms           text not null default '',
  due_days        integer,
  position        integer not null default 100,
  archived        boolean not null default false,
  jobtread_id     text unique,
  created_at      timestamptz not null default now()
);

alter table public.estimates
  add column template_id          uuid references public.document_templates (id) on delete set null,
  add column jobtread_document_id text unique,
  add column imported_note        text;  -- e.g. "Signed in JobTread"

alter table public.document_templates enable row level security;
create policy "document templates: office" on public.document_templates for all to authenticated using (public.sees_numbers()) with check (public.sees_numbers());
revoke all on public.document_templates from anon;
grant select, insert, update, delete on public.document_templates to authenticated, service_role;
