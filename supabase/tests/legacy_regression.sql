begin;
select test.assert((select count(*) = 1 from public.app_users where password_hash = 'synthetic-hash'),
  'legacy records retained');
select test.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.app_users'::regclass),
  'legacy RLS is enabled and forced');
select test.assert(not exists (
  select 1 from pg_attribute a, lateral aclexplode(a.attacl) acl
  where a.attrelid = 'public.app_users'::regclass and acl.grantee in (
    0, (select oid from pg_roles where rolname = 'anon'), (select oid from pg_roles where rolname = 'authenticated')
  )
), 'legacy PUBLIC/anon/authenticated column grants revoked');
select test.assert(not exists (
  select 1 from pg_class c, lateral aclexplode(c.relacl) acl
  where c.oid = 'public.app_users'::regclass and acl.grantee in (
    0, (select oid from pg_roles where rolname = 'anon'), (select oid from pg_roles where rolname = 'authenticated')
  )
), 'legacy PUBLIC/anon/authenticated table grants revoked');
set local role anon;
select test.expect_error('select password_hash from public.app_users', '42501', 'anon legacy column read denied');
reset role;
set local role authenticated;
select test.expect_error('select salt from public.app_users', '42501', 'authenticated legacy column read denied');
reset role;
set local role public_probe;
select test.expect_error('select id from public.app_users', '42501', 'PUBLIC legacy column read denied');
reset role;
-- Even if an old grant is accidentally restored, restrictive RLS overrides the
-- retained permissive legacy policy. Roll back these test-only grants afterward.
grant select on public.app_users to public_probe;
set local role public_probe;
select test.assert((select count(*) = 0 from public.app_users), 'legacy RLS rejects reads even with table access');
reset role;
rollback;
do $$ begin raise notice 'PASS: legacy credential ACLs, restrictive RLS, and record preservation'; end $$;
