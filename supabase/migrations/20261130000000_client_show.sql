-- What the client's copy of a document shows: line items, their
-- descriptions, quantities, unit prices, line totals and group totals.
-- Missing keys mean "show". Unit costs, profit and margin never show.
alter table public.estimates add column if not exists client_show jsonb not null default '{}'::jsonb;
