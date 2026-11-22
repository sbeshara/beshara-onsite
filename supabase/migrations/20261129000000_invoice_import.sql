-- Invoices and payments imported from JobTread remember their JobTread
-- document, so the import can run again without duplicating them.
alter table public.invoices add column jobtread_document_id text unique;
