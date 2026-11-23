-- A catalog item inside a cost group can come from an item in the library
-- (the ungrouped, priced items), like JobTread's catalog: it copies that
-- item's price, cost, unit, type and description, and remembers where it
-- came from.
alter table public.cost_items add column if not exists source_item_id uuid references public.cost_items (id) on delete set null;
create index if not exists cost_items_source_idx on public.cost_items (source_item_id);
