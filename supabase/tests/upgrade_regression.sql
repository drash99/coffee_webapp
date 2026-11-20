begin;
select test.assert((select count(*) = 1 from public.brews where uid = '00000000-0000-4000-8000-000000000931'),
  'migration retains legacy mismatched brew for administrator repair');
select test.assert((select count(*) = 1 from public.grinder_particle_sizes where uid = '00000000-0000-4000-8000-000000000941'),
  'migration retains legacy mismatched particle measurement');
set local role anon;
select test.assert((select count(*) = 0 from public.get_public_brew_by_token('upgrade-legacy-mismatch')),
  'migration repairs previously vulnerable public lookup');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000902', true);
select test.expect_error($q$update public.brews set recipe = 'Cannot resave invalid parent' where uid = '00000000-0000-4000-8000-000000000931'$q$,
  '42501', 'existing invalid brew cannot be resaved until reference is repaired');
select test.expect_error($q$update public.grinder_particle_sizes set grinder_setting = 'Cannot resave' where uid = '00000000-0000-4000-8000-000000000941'$q$,
  '42501', 'existing invalid measurement cannot be resaved until reference is repaired');
reset role;
rollback;
do $$ begin raise notice 'PASS: historical vulnerability repaired without deleting mismatched records'; end $$;
