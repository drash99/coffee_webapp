-- Simulate an existing installation before beverage support.
alter table public.beans drop column beverage_type, drop column beverage_details;
alter table public.brews drop column beverage_details;
insert into auth.users (id) values ('c0000000-0000-4000-8000-000000000001');
insert into public.beans (uid, user_uid, bean_name, cup_flavor_notes)
values ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
  'Legacy Oolong', '[{"path":["Roasted","Toast"],"color":"#92400e"}]');
insert into public.beans (uid, user_uid, bean_name) values
  ('c0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', '봄 수확 우롱'),
  ('c0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'Matcha Geisha Coffee'),
  ('c0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'Pinot Noir'),
  ('c0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', 'Black Tea Notes'),
  ('c0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000001', null);
insert into public.brews (uid, user_uid, bean_uid, brew_date, taste_note)
values ('c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002', '2026-11-19T12:00:00Z', 'Legacy tasting notes');
