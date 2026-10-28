-- Approved progress reports wait in "Ready to Send" until the Principal
-- Contractor or an Admin sends them, so they can still be reopened and edited.
--
--   draft     being reviewed
--   approved  ready to send (not posted yet)
--   sent      posted to the client's Progress Reports chat

alter table public.weekly_reports drop constraint if exists weekly_reports_status_check;
alter table public.weekly_reports add constraint weekly_reports_status_check
  check (status in ('draft', 'approved', 'sent', 'skipped', 'no_logs'));

alter table public.weekly_reports
  add column if not exists sent_by uuid references public.profiles (id) on delete set null,
  add column if not exists sent_at timestamptz;

-- Reports approved before this change were posted right away.
update public.weekly_reports
set status = 'sent', sent_by = approved_by, sent_at = approved_at
where status = 'approved' and message_id is not null;
