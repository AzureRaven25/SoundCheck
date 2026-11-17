begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
-- private test row: real providers may be in use by running functions while tests execute
insert into private.provider_throttle (provider, min_interval, next_slot) values ('pgtap', interval '1 second', clock_timestamp());
select is(public.provider_reserve_slot('pgtap', 5000), 0, 'first caller goes now');
-- (evaluate once: BETWEEN expands to two comparisons and would call the volatile function twice)
select ok(w between 900 and 1000, 'second caller waits ~1 s') from (select public.provider_reserve_slot('pgtap', 5000) as w) s;
select is(public.provider_reserve_slot('pgtap', 100), -1, 'impatient caller is turned away');
select ok(w between 1900 and 2000, 'turned-away caller did not consume a slot') from (select public.provider_reserve_slot('pgtap', 5000) as w) s;
select * from finish();
rollback;
