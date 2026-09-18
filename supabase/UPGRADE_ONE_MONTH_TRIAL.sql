-- Existing project: one calendar month from the original trial start.
-- Only standard, unpaid seven-day trials are extended. Paid and custom trials
-- retain their recorded expiry. Safe to rerun.
alter table public.subscriptions
  alter column trial_ends_at set default (now() + interval '1 month');

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('public.create_cutflow_trial_subscription()'::regprocedure)
    into definition;
  if position('7 days' in definition) > 0 then
    execute replace(definition, '7 days', '1 month');
  elsif position('1 month' in definition) = 0 then
    raise exception 'Unexpected CutFlow trial trigger: inspect it before changing trial duration.';
  end if;
end;
$migration$;

update public.subscriptions
   set trial_ends_at = trial_started_at + interval '1 month',
       updated_at = now()
 where status = 'trialing'
   and last_payment_at is null
   and trial_ends_at = trial_started_at + interval '7 days';
