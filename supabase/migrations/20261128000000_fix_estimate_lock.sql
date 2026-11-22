-- Fix: the signed-estimate lock is shared by groups, items and payment steps,
-- but it read payment-step columns (percent, name) on every table, so adding
-- a group or item failed with 'record "new" has no field "percent"'. The
-- payment-step check now only runs for payment steps.
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
  est := case when tg_op = 'DELETE' then old.estimate_id else new.estimate_id end;
  if exists (select 1 from public.estimates where id = est and status = 'approved') then
    raise exception 'This estimate is signed and locked. Add a change order instead.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
