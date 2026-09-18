-- Run on existing CutFlow projects. Keep each project's deployed booking rules;
-- change only its day boundary to the South African calendar date.
create extension if not exists "btree_gist";

do $migration$
declare
  booking_function record;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_no_staff_overlap'
  ) then
    -- Existing overlapping active appointments must be resolved first.
    alter table public.appointments add constraint appointments_no_staff_overlap
      exclude using gist (staff_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
      where (status not in ('cancelled', 'no_show'));
  end if;

  for booking_function in
    select p.oid, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_public_cutflow_slots',
                        'create_public_cutflow_booking',
                        'create_public_cutflow_booking_full')
  loop
    if position('current_date' in booking_function.definition) > 0 then
      execute replace(booking_function.definition, 'current_date',
        '(now() at time zone ''Africa/Johannesburg'')::date');
    end if;
  end loop;
end;
$migration$;
