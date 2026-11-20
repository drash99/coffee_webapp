begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);

select test.assert((select array_agg(beverage_type order by uid) = array['tea','tea','coffee','coffee','coffee','coffee']
  from public.beans where user_uid = 'c0000000-0000-4000-8000-000000000001'),
  'clear tea names are classified, coffee indicators and ambiguous names are left alone');
select test.assert((select b.beverage_type = 'tea' and b.beverage_details = '{}'::jsonb
    and b.cup_flavor_notes #>> '{0,path,1}' = 'Toast' and r.taste_note = 'Legacy tasting notes'
  from public.brews r join public.beans b on b.uid = r.bean_uid
  where r.uid = 'c0000000-0000-4000-8000-000000000003'), 'the backfill preserves linked tastings and existing notes');

select public.save_beanlog_data('{"beans":[{"uid":"c0000000-0000-4000-8000-000000000002",
  "bean_name":"Legacy Oolong","beverage_type":"tea","beverage_details":{"teaStyle":"oolong","harvest":"spring"},
  "cup_flavor_notes":[{"path":["Roasted","Toast"],"color":"#92400e"}]}]}');

select test.assert((select b.beverage_type = 'tea' and r.taste_note = 'Legacy tasting notes'
  from public.brews r join public.beans b on b.uid = r.bean_uid
  where r.uid = 'c0000000-0000-4000-8000-000000000003'), 'reclassifying a product preserves and moves its tastings');

select public.save_beanlog_data('{"brews":[{"uid":"c0000000-0000-4000-8000-000000000003",
  "bean_uid":"c0000000-0000-4000-8000-000000000002","brew_date":"2026-11-19T12:00:00Z",
  "beverage_details":{"steepSeconds":40,"leafGrams":5},
  "taste_flavor_notes":[{"path":["Mouthfeel","Umami"],"color":"#42668a"}]}]}');

select public.save_beanlog_data('{"beans":[{"uid":"c0000000-0000-4000-8000-000000000002","bean_name":"Old client"}],
  "brews":[{"uid":"c0000000-0000-4000-8000-000000000003","bean_uid":"c0000000-0000-4000-8000-000000000002",
    "brew_date":"2026-11-19T12:00:00Z"}]}');

select test.assert((select beverage_type = 'tea' and beverage_details ->> 'teaStyle' = 'oolong'
  from public.beans where uid = 'c0000000-0000-4000-8000-000000000002'), 'older clients preserve new product metadata');
select test.assert((select beverage_details ->> 'steepSeconds' = '40' from public.brews
  where uid = 'c0000000-0000-4000-8000-000000000003'), 'older clients preserve new tasting metadata');

select test.expect_error($q$select public.save_beanlog_data('{"beans":[{"uid":"c0000000-0000-4000-8000-000000000002","beverage_type":"invalid"}]}')$q$,
  '23514', 'invalid beverage type rejected');
select test.expect_error($q$select public.save_beanlog_data('{"beans":[{"uid":"c0000000-0000-4000-8000-000000000002","beverage_details":{"nested":[1,2]}}]}')$q$,
  '23514', 'nested detail payload rejected');
select test.expect_error($q$select public.save_beanlog_data('{"beans":[{"uid":"c0000000-0000-4000-8000-000000000002","beverage_details":null}]}')$q$,
  '22023', 'null details rejected');
reset role;
rollback;
-- Simulate an explicit coffee selection for a tea-looking name before the second patch pass.
update public.beans set bean_name = 'Handpicked Sencha', beverage_type = 'coffee'
where uid = 'c0000000-0000-4000-8000-000000000005';
do $$ begin raise notice 'PASS: beverage upgrade, reclassification and backward-compatible writes'; end $$;
