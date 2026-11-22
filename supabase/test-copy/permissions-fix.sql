-- OnSite TEST COPY: one-time permissions fix.
-- New Supabase projects no longer give the app (anon, authenticated, service_role) access to
-- tables by default. Older projects, like the live one, did. This gives the standard Supabase
-- access, then puts back every limit OnSite's own setup applies, so the test copy matches live.
-- Run once in the TEST project's SQL Editor. Never needed on the live project.

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;

-- OnSite's own limits, in the order its setup applies them:
revoke all on public.profiles, public.projects, public.project_members, public.chats, public.messages, public.files from anon;
revoke update on public.profiles, public.projects, public.messages, public.files from authenticated;
grant update (full_name) on public.profiles to authenticated;
grant update (name, town, scope, phase) on public.projects to authenticated;
grant update (is_internal, folder) on public.files to authenticated;
revoke all on public.app_settings from anon, authenticated;
grant update (email_notifications, push_notifications) on public.profiles to authenticated;
revoke all on public.chat_reads from anon;
revoke all on public.push_subscriptions from anon;
revoke execute on function public.register_push(text, text, text, text) from public, anon;
grant execute on function public.register_push(text, text, text, text) to authenticated;
revoke all on public.notify_state from anon, authenticated;
revoke execute on function public.can_profile_see_chat(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.claim_message_push(uuid) from public, anon, authenticated;
revoke execute on function public.message_push_targets(uuid) from public, anon, authenticated;
revoke execute on function public.pending_email_digest(timestamptz) from public, anon, authenticated;
revoke all on public.weekly_reports from anon;
revoke insert, delete on public.weekly_reports from authenticated;
revoke update on public.weekly_reports from authenticated;
grant update (completed, looking_ahead, layout, skip_completed, photos, pm_notes, updated_at, updated_by) on public.weekly_reports to authenticated;
revoke execute on function public.claim_message_push(uuid) from public, anon, authenticated;
revoke execute on function public.pending_email_digest(timestamptz) from public, anon, authenticated;
revoke all on public.daily_checks from anon;
revoke all on public.checklist_emails from anon, authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
revoke insert on public.chats, public.messages, public.files from authenticated;
grant insert (id, project_id, name, is_internal, position, created_by, created_at) on public.chats to authenticated;
grant insert (id, chat_id, project_id, author_id, body, created_at) on public.messages to authenticated;
grant insert (id, project_id, message_id, name, storage_path, size_bytes, mime_type, folder, is_internal, uploaded_by, created_at) on public.files to authenticated;
revoke all on public.basecamp_connection from anon, authenticated;
revoke execute on function public.pending_email_digest(timestamptz) from public, anon, authenticated;
grant execute on function public.permission(text) to authenticated;
revoke execute on function public.my_unread() from public, anon;
grant execute on function public.my_unread() to authenticated;
revoke execute on function public.latest_messages(uuid) from public, anon;
grant execute on function public.latest_messages(uuid) to authenticated;
revoke execute on function public.is_senior_pm() from public, anon;
grant execute on function public.is_senior_pm() to authenticated;
revoke all on public.chat_clients from anon;
revoke execute on function public.client_in_chat(uuid, uuid) from public, anon;
grant execute on function public.client_in_chat(uuid, uuid) to authenticated;
revoke execute on function public.can_profile_see_chat(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_see_file_message(uuid) from public, anon;
grant execute on function public.can_see_file_message(uuid) to authenticated;
revoke execute on function public.is_precon(), public.sees_numbers() from public, anon;
grant execute on function public.is_precon(), public.sees_numbers() to authenticated;
grant update (status, job_number, customer_id, job_type, address, notes) on public.projects to authenticated;
revoke execute on function public.can_see_customer(uuid) from public, anon;
grant execute on function public.can_see_customer(uuid) to authenticated;
revoke all on public.customers, public.customer_contacts, public.cost_types, public.units, public.cost_groups, public.cost_items from anon;
revoke all on public.plan_files, public.plan_sheets, public.takeoff_measurements, public.plan_markups, public.estimates, public.estimate_groups, public.estimate_items, public.estimate_payment_steps from anon;
revoke execute on function public.team_can_open(uuid) from public, anon;
grant execute on function public.team_can_open(uuid) to authenticated;
revoke execute on function public.estimate_scope(uuid) from public, anon;
grant execute on function public.estimate_scope(uuid) to authenticated;
revoke execute on function public.client_proposals(uuid), public.sign_estimate(uuid, text, text, text), public.decline_estimate(uuid, text) from public, anon;
grant execute on function public.client_proposals(uuid), public.sign_estimate(uuid, text, text, text), public.decline_estimate(uuid, text) to authenticated;
revoke all on public.qbo_connection from anon, authenticated;
revoke all on public.invoices, public.invoice_payments from anon;
