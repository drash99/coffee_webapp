-- Minimal local stand-ins for Supabase's roles, auth context, and default grants.
create role anon nologin;
create role authenticated nologin;
create role public_probe nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema public, auth to anon, authenticated, public_probe;
grant execute on function auth.uid() to anon, authenticated, public_probe;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
-- Supabase installations can grant function access explicitly as well as PUBLIC.
alter default privileges in schema public grant execute on functions to anon, authenticated;

create schema test;
grant usage on schema test to anon, authenticated, public_probe;
create function test.assert(ok boolean, description text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then
    raise exception 'FAIL: %', description;
  end if;
end;
$$;
create function test.expect_error(statement text, expected_state text, description text) returns void
language plpgsql security invoker as $$
declare
  got_state text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics got_state = returned_sqlstate;
    if expected_state is not null and got_state <> expected_state then
      raise exception 'FAIL: % (expected SQLSTATE %, got %: %)', description, expected_state, got_state, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAIL: % (statement unexpectedly succeeded)', description;
end;
$$;
