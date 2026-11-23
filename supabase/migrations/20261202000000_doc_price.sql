-- A document's client price can be its line items added up (the default),
-- a price per unit (e.g. 2,436 SF × $11.49/SF), or one lump sum. Either way
-- the budget stays itemized for the office.
alter table public.estimates
  add column if not exists price_mode text not null default 'items' check (price_mode in ('items', 'unit', 'lump')),
  add column if not exists price_qty  numeric,
  add column if not exists price_unit text not null default 'SF' check (char_length(price_unit) <= 12),
  add column if not exists price_rate numeric,
  add column if not exists price_lump numeric;

-- Only content changes on a document line carry to its budget line; linking a
-- line to the budget (or anything else) doesn't.
drop trigger if exists estimate_items_to_budget on public.estimate_items;
create trigger estimate_items_to_budget
  after update of name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, measurement_id, qty_factor, waste_pct
  on public.estimate_items
  for each row execute function public.doc_item_to_budget();

-- Link many document lines to budget lines in one call (used by the import).
-- links: [{"item": "<estimate_items.id>", "budget": "<budget_items.id>"}, ...]
create or replace function public.link_budget_items(links jsonb) returns integer
language sql security definer set search_path = public as $$
  with l as (select (x->>'item')::uuid as item, (x->>'budget')::uuid as budget from jsonb_array_elements(links) x),
  u as (update public.estimate_items ei set budget_item_id = l.budget from l where ei.id = l.item returning 1)
  select count(*)::integer from u;
$$;
revoke all on function public.link_budget_items(jsonb) from public, anon, authenticated;
grant execute on function public.link_budget_items(jsonb) to service_role;
