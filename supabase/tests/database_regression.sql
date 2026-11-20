-- Every fixture and test-only function is rolled back; this suite is repeatable.
begin;
create function test.uid(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function test.payload() returns jsonb language sql immutable as $$
  select '{
    "grinders":[{"uid":"00000000-0000-4000-8000-000000000201","user_uid":"guest",
      "maker":"Maker A","model":"Model A","created_at":"2026-01-02T03:04:05Z"}],
    "beans":[{"uid":"00000000-0000-4000-8000-000000000101","user_uid":"guest",
      "bean_name":"Bean A","roastery":"Roastery A","producer":"Producer A",
      "origin_location":"Town A","origin_country":"Country A","process":"Washed",
      "varietal":"Varietal A","cup_notes":"Notes A","roasted_on":"2026-01-01",
      "cup_flavor_notes":[{"path":["Fruity","Berry","Blueberry"],"color":"#123456"},
        {"path":["Sweet"],"color":"#654321"}],"created_at":"2026-01-02T03:04:05Z"}],
    "brews":[{"uid":"00000000-0000-4000-8000-000000000301","user_uid":"guest",
      "brew_date":"2026-09-14T12:00:00Z","bean_uid":"00000000-0000-4000-8000-000000000101",
      "grinder_uid":"00000000-0000-4000-8000-000000000201","grinder_setting":"10",
      "recipe":"Recipe A","coffee_dose_g":18,"coffee_yield_g":36,"coffee_tds":9.5,
      "water":"Water A","water_temp_c":93,"grind_median_um":320,"rating":4.5,
      "extraction_note":"Extraction A","taste_note":"Taste A",
      "taste_flavor_notes":[{"path":["Fruity","Berry"],"color":"#abcdef"}],
      "created_at":"2026-01-02T03:04:05Z"}],
    "particleSizes":[{"uid":"00000000-0000-4000-8000-000000000401","user_uid":"guest",
      "grinder_uid":"00000000-0000-4000-8000-000000000201","grinder_setting":"10",
      "particle_median_um":320,"created_at":"2026-01-02T03:04:05Z"}],
    "beanLabels":[{"uid":"00000000-0000-4000-8000-000000000501",
      "bean_uid":"00000000-0000-4000-8000-000000000101","grams":100,
      "created_at":"2026-01-02T03:04:05Z"}]
  }'::jsonb;
$$;
create function test.snapshot() returns jsonb language sql security invoker as $$
  select jsonb_build_object(
    'beans', (select jsonb_agg(to_jsonb(b) order by uid) from public.beans b),
    'grinders', (select jsonb_agg(to_jsonb(g) order by uid) from public.grinders g),
    'brews', (select jsonb_agg(to_jsonb(b) order by uid) from public.brews b),
    'particleSizes', (select jsonb_agg(to_jsonb(p) order by uid) from public.grinder_particle_sizes p),
    'beanLabels', (select jsonb_agg(to_jsonb(l) order by uid) from public.bean_labels l),
    'beanNotes', (select jsonb_agg(to_jsonb(n) - 'id' order by bean_uid, l1, l2, l3, color) from public.bean_flavor_notes n),
    'brewNotes', (select jsonb_agg(to_jsonb(n) - 'id' order by brew_uid, l1, l2, l3, color) from public.brew_flavor_notes n)
  );
$$;
insert into auth.users values (test.uid(1)), (test.uid(2));
insert into public.beans (uid, user_uid, bean_name) values (test.uid(102), test.uid(2), 'Private B');
insert into public.grinders (uid, user_uid, maker) values (test.uid(202), test.uid(2), 'Private B');
insert into public.brews (uid, user_uid, bean_uid, brew_date) values (test.uid(302), test.uid(2), test.uid(102), now());
insert into public.grinder_particle_sizes (uid, user_uid, grinder_uid, grinder_setting, particle_median_um)
values (test.uid(402), test.uid(2), test.uid(202), 'B', 500);
insert into public.bean_labels (uid, bean_uid) values (test.uid(502), test.uid(102));

select test.assert((select not prosecdef from pg_proc where oid = 'public.save_beanlog_data(jsonb)'::regprocedure),
  'save RPC is SECURITY INVOKER');
select test.assert(not has_function_privilege('anon', 'public.save_beanlog_data(jsonb)', 'EXECUTE'), 'anon cannot execute save RPC');
select test.assert(not has_function_privilege('public_probe', 'public.save_beanlog_data(jsonb)', 'EXECUTE'), 'PUBLIC cannot execute save RPC');
select test.assert(has_function_privilege('authenticated', 'public.save_beanlog_data(jsonb)', 'EXECUTE'), 'authenticated may execute save RPC');
set local role anon;
select test.expect_error($q$select public.save_beanlog_data('{}')$q$, '42501', 'anon save rejected');
select test.assert((select count(*) = 0 from public.beans), 'anon cannot read private beans');
reset role;
set local role authenticated;
select test.expect_error($q$select public.save_beanlog_data('{}')$q$, '42501', 'missing auth identity rejected');
select set_config('request.jwt.claim.sub', test.uid(1)::text, true);
select test.assert((select count(*) = 0 from public.beans), 'A cannot read B beans');
select test.assert((select count(*) = 0 from public.grinders), 'A cannot read B grinders');

-- A retry of a historically partial migration may already have its grinder.
insert into public.grinders (uid, maker, created_at) values (test.uid(201), 'Old maker', '2025-01-01Z');
select test.assert(public.save_beanlog_data(test.payload()) = '{"beans":1,"brews":1}', 'full guest migration counts');
select test.assert((select maker = 'Maker A' and created_at = '2025-01-01Z'::timestamptz from public.grinders where uid = test.uid(201)),
  'partial migration retry updates own grinder and preserves original timestamp');
select test.assert((select user_uid = test.uid(1) from public.beans where uid = test.uid(101)), 'client user_uid ignored');
select test.assert((select created_at = '2026-01-02T03:04:05Z'::timestamptz from public.beans where uid = test.uid(101)), 'created_at retained on insert');
select test.assert((select l2 is null and l3 is null from public.bean_flavor_notes where l1 = 'Sweet'), 'one-level note normalized');
select test.assert((select l2 = 'Berry' and l3 = 'Blueberry' from public.bean_flavor_notes where l1 = 'Fruity'), 'three-level note normalized');
select test.assert((select l2 = 'Berry' and l3 is null from public.brew_flavor_notes), 'two-level note normalized');

do $$
declare
  before_data jsonb := test.snapshot();
  payload jsonb := test.payload();
  collection text;
begin
  foreach collection in array array['beans', 'brews', 'grinders', 'particleSizes', 'beanLabels'] loop
    payload := jsonb_set(payload, array[collection, '0', 'created_at'], '"2027-01-01T00:00:00Z"');
  end loop;
  perform test.assert(public.save_beanlog_data(payload) = '{"beans":1,"brews":1}', 'retry counts include own existing rows');
  perform test.assert(test.snapshot() = before_data, 'retry is idempotent with no duplicate notes or changed created_at');
  perform test.assert(public.save_beanlog_data('{}') = '{"beans":0,"brews":0}', 'empty subset allowed');
  perform test.assert(test.snapshot() = before_data, 'empty subset does not delete data');
end;
$$;

-- Full rows update all editable fields; a collection subset leaves peers alone.
do $$
declare
  before_data jsonb := test.snapshot();
  changed jsonb;
  collection text;
  row_json jsonb;
  field_name text;
begin
  foreach collection in array array['beans', 'brews', 'grinders', 'particleSizes', 'beanLabels'] loop
    row_json := test.payload() #> array[collection, '0'];
    for field_name in select key from jsonb_each(row_json) loop
      if field_name in ('uid', 'user_uid', 'created_at', 'bean_uid', 'grinder_uid') then continue; end if;
      row_json := jsonb_set(row_json, array[field_name], case
        when field_name in ('cup_flavor_notes', 'taste_flavor_notes') then '[{"path":["Changed"],"color":"#000000"}]'::jsonb
        when field_name = 'roasted_on' then '"2026-08-01"'::jsonb
        when field_name = 'brew_date' then '"2026-08-02T12:00:00Z"'::jsonb
        when jsonb_typeof(row_json -> field_name) = 'number' then '42'::jsonb
        else '"Changed"'::jsonb end);
    end loop;
    perform public.save_beanlog_data(jsonb_build_object(collection, jsonb_build_array(row_json)));
    changed := test.snapshot();
    perform test.assert((changed #> array[collection, '0']) @> (row_json - 'user_uid' - 'created_at' - 'brew_date'),
      collection || ' full editable payload stored');
    if collection = 'brews' then
      perform test.assert((changed #>> '{brews,0,brew_date}')::timestamptz = '2026-08-02T12:00:00Z', 'brew timestamp updated');
    end if;
    perform test.assert((changed - collection - 'beanNotes' - 'brewNotes') = (before_data - collection - 'beanNotes' - 'brewNotes'),
      collection || ' subset leaves other collections untouched');
    perform public.save_beanlog_data(test.payload());
  end loop;
  perform test.assert(test.snapshot() = before_data, 'full payload restores all rows');
end;
$$;

-- A parent update and note replacement roll back if a later child fails RLS.
do $$
declare
  before_data jsonb := test.snapshot();
  payload jsonb := jsonb_set(test.payload(), '{beans,0,bean_name}', '"Must roll back"');
begin
  payload := jsonb_set(payload, '{brews,0,bean_uid}', to_jsonb(test.uid(102)));
  perform test.expect_error(format('select public.save_beanlog_data(%L::jsonb)', payload), '42501', 'late cross-owner reference rejected');
  perform test.assert(test.snapshot() = before_data, 'late failure rolls back parent updates and deleted/replaced notes');
end;
$$;

-- A first-time migration must also roll back inserts, then permit a clean retry.
do $$
declare
  before_data jsonb := test.snapshot();
  payload jsonb := test.payload();
  collection text;
  row_number integer;
begin
  foreach collection in array array['grinders', 'beans', 'brews', 'particleSizes', 'beanLabels'] loop
    row_number := case collection when 'grinders' then 203 when 'beans' then 103 when 'brews' then 303 when 'particleSizes' then 403 else 503 end;
    payload := jsonb_set(payload, array[collection, '0', 'uid'], to_jsonb(test.uid(row_number)));
  end loop;
  payload := jsonb_set(payload, '{brews,0,bean_uid}', to_jsonb(test.uid(103)));
  payload := jsonb_set(payload, '{brews,0,grinder_uid}', to_jsonb(test.uid(203)));
  payload := jsonb_set(payload, '{particleSizes,0,grinder_uid}', to_jsonb(test.uid(203)));
  payload := jsonb_set(payload, '{beanLabels,0,bean_uid}', to_jsonb(test.uid(999)));
  perform test.expect_error(format('select public.save_beanlog_data(%L::jsonb)', payload), '42501', 'missing parent in final collection rejects first migration');
  perform test.assert(test.snapshot() = before_data, 'failed first migration leaves no new parents, children, or notes');
  payload := jsonb_set(payload, '{beanLabels,0,bean_uid}', to_jsonb(test.uid(103)));
  perform test.assert(public.save_beanlog_data(payload) = '{"beans":1,"brews":1}', 'corrected migration retry succeeds');
  perform test.assert(public.save_beanlog_data(payload) = '{"beans":1,"brews":1}', 'lost-response retry succeeds without uid collision');
  perform test.assert((select count(*) = 2 from public.bean_flavor_notes where bean_uid = test.uid(103)), 'retry does not duplicate newly migrated notes');
  delete from public.beans where uid = test.uid(103);
  delete from public.grinders where uid = test.uid(203);
  perform test.assert(test.snapshot() = before_data, 'retry cleanup leaves original data unchanged');
end;
$$;

-- Invisible primary-key conflicts must fail, never silently skip or steal rows.
do $$
declare
  collection text;
  foreign_uid integer;
  before_data jsonb := test.snapshot();
  payload jsonb;
begin
  foreach collection in array array['grinders', 'beans', 'brews', 'particleSizes', 'beanLabels'] loop
    foreign_uid := case collection when 'grinders' then 202 when 'beans' then 102 when 'brews' then 302 when 'particleSizes' then 402 else 502 end;
    payload := jsonb_set(test.payload(), array[collection, '0', 'uid'], to_jsonb(test.uid(foreign_uid)));
    perform test.expect_error(format('select public.save_beanlog_data(%L::jsonb)', payload), '42501', collection || ' foreign uid collision rejected');
    perform test.assert(test.snapshot() = before_data, collection || ' collision rolls back all changes');
  end loop;
end;
$$;

select test.expect_error($q$insert into public.brews (uid, bean_uid, brew_date) values (test.uid(303), test.uid(102), now())$q$,
  '42501', 'direct cross-owner bean INSERT rejected');
select test.expect_error($q$insert into public.brews (uid, bean_uid, grinder_uid, brew_date) values (test.uid(303), test.uid(101), test.uid(202), now())$q$,
  '42501', 'direct cross-owner grinder INSERT rejected');
select test.expect_error($q$update public.brews set bean_uid = test.uid(102) where uid = test.uid(301)$q$,
  '42501', 'direct cross-owner bean UPDATE rejected');
select test.expect_error($q$update public.brews set grinder_uid = test.uid(202) where uid = test.uid(301)$q$,
  '42501', 'direct cross-owner grinder UPDATE rejected');
select test.expect_error($q$insert into public.grinder_particle_sizes (uid, grinder_uid, grinder_setting, particle_median_um) values (test.uid(403), test.uid(202), 'B', 100)$q$,
  '42501', 'direct cross-owner particle INSERT rejected');
select test.expect_error($q$update public.grinder_particle_sizes set grinder_uid = test.uid(202) where uid = test.uid(401)$q$,
  '42501', 'direct cross-owner particle UPDATE rejected');
select test.expect_error($q$update public.beans set user_uid = test.uid(2) where uid = test.uid(101)$q$,
  '42501', 'parent owner cannot be reassigned by client');
select test.expect_error($q$insert into public.bean_labels (uid, bean_uid) values (test.uid(503), test.uid(102))$q$,
  '42501', 'foreign bean label INSERT rejected');
select test.expect_error($q$insert into public.bean_flavor_notes (bean_uid, l1) values (test.uid(102), 'Stolen')$q$,
  '42501', 'foreign bean notes INSERT rejected');
select test.expect_error($q$insert into public.brew_flavor_notes (brew_uid, l1) values (test.uid(302), 'Stolen')$q$,
  '42501', 'foreign brew notes INSERT rejected');

-- Reject invalid shapes and types before they can be treated as an empty save.
do $$
declare
  bad jsonb;
  before_data jsonb := test.snapshot();
begin
  for bad in select value from jsonb_array_elements('[null,[],1,"x",true,
    {"bean":[]},{"beans":null},{"brews":{}},{"grinders":"x"},{"particleSizes":1},{"beanLabels":false},
    {"beans":[null]},{"beans":[[]]},{"beans":["x"]},{"beans":[{}]},
    {"beans":[{"uid":null}]},{"beans":[{"uid":"bad"}]},
    {"beans":[{"uid":101}]},{"beans":[{"uid":"00000000000040008000000000000101"}]},
    {"beans":[{"uid":"00000000-0000-4000-8000-000000000101","bean_name":3}]},
    {"beans":[{"uid":"00000000-0000-4000-8000-000000000101","created_at":null}]},
    {"beans":[{"uid":"00000000-0000-4000-8000-000000000101","created_at":"infinity"}]},
    {"beans":[{"uid":"00000000-0000-4000-8000-000000000101","unexpected":true}]},
    {"beans":[{"uid":"00000000-0000-4000-8000-000000000101","roasted_on":"2026-02-30"}]},
    {"brews":[{"uid":"00000000-0000-4000-8000-000000000301"}]},
    {"particleSizes":[{"uid":"00000000-0000-4000-8000-000000000401"}]},
    {"beanLabels":[{"uid":"00000000-0000-4000-8000-000000000501"}]}]'::jsonb) loop
    perform test.expect_error(format('select public.save_beanlog_data(%L::jsonb)', bad), null, 'malformed payload rejected: ' || bad::text);
    perform test.assert(test.snapshot() = before_data, 'malformed payload leaves data intact');
  end loop;
  perform test.expect_error('select public.save_beanlog_data(null)', '22023', 'SQL NULL payload rejected');
end;
$$;

do $$
declare
  collection text;
  field_name text;
  bad jsonb;
  payload jsonb;
  before_data jsonb := test.snapshot();
begin
  foreach collection in array array['beans', 'brews'] loop
    field_name := case collection when 'beans' then 'cup_flavor_notes' else 'taste_flavor_notes' end;
    for bad in select value from jsonb_array_elements('[{},"bad",1,[null],[1],[{}],
      [{"path":[],"color":"#000000"}],[{"path":["a","b","c","d"],"color":"#000000"}],
      [{"path":["a",1],"color":"#000000"}],[{"path":[null],"color":"#000000"}],
      [{"path":[" "],"color":"#000000"}],[{"path":"a","color":"#000000"}],
      [{"path":["a"]}],[{"path":["a"],"color":null}],[{"path":["a"],"color":1}],
      [{"path":["a"],"color":" "}],[{"path":["a"],"color":"#000000","extra":1}]]'::jsonb) loop
      payload := jsonb_set(test.payload(), array[collection, '0', field_name], bad);
      perform test.expect_error(format('select public.save_beanlog_data(%L::jsonb)', payload), '22023', 'invalid inline notes rejected');
      perform test.assert(test.snapshot() = before_data, 'invalid notes roll back all rows and normalized notes');
    end loop;
  end loop;
  foreach collection in array array['grinders', 'beans', 'brews', 'particleSizes', 'beanLabels'] loop
    payload := jsonb_set(test.payload(), array[collection], (test.payload() -> collection) || (test.payload() -> collection));
    perform test.expect_error(format('select public.save_beanlog_data(%L::jsonb)', payload), '22023', 'duplicate collection uid rejected');
    perform test.assert(test.snapshot() = before_data, 'duplicate uid rolls back earlier work');
  end loop;
  for bad in select value from jsonb_array_elements('["18",true,{},[]]') loop
    payload := jsonb_set(test.payload(), '{brews,0,coffee_dose_g}', bad);
    perform test.expect_error(format('select public.save_beanlog_data(%L::jsonb)', payload), '22023', 'numeric fields require JSON numbers');
    perform test.assert(test.snapshot() = before_data, 'bad number rolls back earlier work');
  end loop;
end;
$$;

-- Null/empty note arrays clear normalized rows, without affecting other entities.
select public.save_beanlog_data(jsonb_build_object('beans', jsonb_build_array(
  (test.payload() #> '{beans,0}') || '{"cup_flavor_notes":null}'::jsonb)));
select test.assert((select cup_flavor_notes = '[]' from public.beans where uid = test.uid(101)), 'nullable notes normalize to empty inline array');
select test.assert((select count(*) = 0 from public.bean_flavor_notes), 'null notes remove stale normalized notes');
select test.assert((select count(*) = 1 from public.brew_flavor_notes), 'bean-only save retains brew notes');
select public.save_beanlog_data(jsonb_build_object('brews', jsonb_build_array(
  (test.payload() #> '{brews,0}') || '{"taste_flavor_notes":[]}'::jsonb)));
select test.assert((select count(*) = 0 from public.brew_flavor_notes), 'empty notes remove stale normalized notes');
select public.save_beanlog_data(test.payload());

-- A database-side note error occurs after the parent and its prior notes changed.
reset role;
alter table public.brew_flavor_notes add constraint test_note_failure check (color <> '#ff0000');
set local role authenticated;
do $$
declare
  before_data jsonb := test.snapshot();
  payload jsonb := jsonb_set(test.payload(), '{brews,0,taste_flavor_notes,0,color}', '"#ff0000"');
begin
  payload := jsonb_set(payload, '{grinders,0,maker}', '"Must roll back"');
  perform test.expect_error(format('select public.save_beanlog_data(%L::jsonb)', payload), '23514', 'normalized note constraint failure surfaces');
  perform test.assert(test.snapshot() = before_data, 'normalized note failure restores all rows and old notes');
end;
$$;
reset role;
alter table public.brew_flavor_notes drop constraint test_note_failure;

-- Simulate invalid references left by an older deployment or privileged import.
insert into public.brews (uid, user_uid, bean_uid, grinder_uid, brew_date) values
  (test.uid(390), test.uid(1), test.uid(102), test.uid(202), now()),
  (test.uid(391), test.uid(1), test.uid(101), test.uid(202), now());
insert into public.brew_shares (brew_uid, share_token) values
  (test.uid(301), 'valid-share'), (test.uid(390), 'legacy-bad-bean'), (test.uid(391), 'legacy-bad-grinder');
set local role anon;
select test.assert((select count(*) = 0 from public.get_public_brew_by_token('legacy-bad-bean')), 'public RPC hides legacy cross-owner bean');
select test.assert((select grinder_maker is null and grinder_model is null and bean_name = 'Bean A'
  from public.get_public_brew_by_token('legacy-bad-grinder')), 'public RPC never leaks legacy foreign grinder metadata');
select test.assert((select bean_name = 'Bean A' and grinder_maker = 'Maker A' from public.get_public_brew_by_token('valid-share')),
  'valid public share still works');
select test.assert((select count(*) = 0 from public.get_public_brew_by_token('unknown-token')), 'unknown share hidden');
select test.assert((select bean_name = 'Bean A' from public.get_public_bean_by_label_uid(test.uid(501))), 'valid public label still works');
reset role;
update public.brew_shares set revoked_at = now() where share_token = 'valid-share';
set local role anon;
select test.assert((select count(*) = 0 from public.get_public_brew_by_token('valid-share')), 'revoked share hidden');
reset role;

-- An unrelated permissive policy cannot defeat the new restrictive guards.
create policy test_old_permissive_brews on public.brews for all using (true) with check (true);
create policy test_old_permissive_particles on public.grinder_particle_sizes for all using (true) with check (true);
set local role authenticated;
select test.expect_error($q$update public.brews set bean_uid = test.uid(102) where uid = test.uid(301)$q$,
  '42501', 'restrictive brew guard withstands old permissive policy');
select test.expect_error($q$update public.grinder_particle_sizes set grinder_uid = test.uid(202) where uid = test.uid(401)$q$,
  '42501', 'restrictive particle guard withstands old permissive policy');
select test.assert((select count(*) = 0 from public.brews where user_uid = test.uid(2)), 'restrictive policy hides foreign brews');
-- New rows without created_at receive server timestamps; nullable editable fields clear.
select public.save_beanlog_data('{"beans":[{"uid":"00000000-0000-4000-8000-000000000103","bean_name":"New"}]}');
select test.assert((select created_at is not null and user_uid = test.uid(1) and cup_flavor_notes = '[]' from public.beans where uid = test.uid(103)),
  'optional created_at and notes receive defaults');
select public.save_beanlog_data('{"beans":[{"uid":"00000000-0000-4000-8000-000000000103","bean_name":null}]}');
select test.assert((select bean_name is null from public.beans where uid = test.uid(103)), 'explicit null clears nullable editable value');
-- Preserve existing cascade and nullable-grinder behavior.
delete from public.grinders where uid = test.uid(201);
select test.assert((select grinder_uid is null from public.brews where uid = test.uid(301)), 'grinder delete nulls brew reference');
select test.assert((select count(*) = 0 from public.grinder_particle_sizes), 'grinder delete cascades particle sizes');
delete from public.beans where uid = test.uid(101);
select test.assert((select count(*) = 0 from public.brews where uid = test.uid(301)), 'bean delete cascades brews');
select test.assert((select count(*) = 0 from public.bean_labels), 'bean delete cascades labels');
select test.assert((select count(*) = 0 from public.bean_flavor_notes), 'bean delete cascades bean notes');
select test.assert((select count(*) = 0 from public.brew_flavor_notes), 'bean delete cascades brew notes');
reset role;
select test.assert((select bean_name = 'Private B' from public.beans where uid = test.uid(102)), 'other owner data remains unchanged');
rollback;
do $$ begin raise notice 'PASS: RPC validation, full-row saves, isolation, rollback, retries, notes, public lookups, and cascades'; end $$;
