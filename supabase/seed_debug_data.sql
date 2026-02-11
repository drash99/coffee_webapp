-- Seed data for debugging the flavor-note filter.
-- Run AFTER clean_reset.sql (or after the main schema + patch).
--
-- Creates one test user and a handful of brews with diverse flavor notes
-- so you can verify hierarchical filtering (e.g. "Sweet" matches "Sweet/Honey").
--
-- Test user credentials:
--   id: debug
--   password: debug  (salt + hash are fake – only usable if your auth allows raw inserts)

-- ============================================================
-- 1. Test user
-- ============================================================
insert into public.app_users (uid, id, salt, password_hash) values
  ('00000000-0000-0000-0000-000000000001', 'debug', 'fakesalt', 'fakehash');

-- ============================================================
-- 2. Grinder
-- ============================================================
insert into public.grinders (uid, user_uid, maker, model) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Fellow', 'Ode Gen 2');

-- ============================================================
-- 3. Beans (6 different bags)
-- ============================================================
insert into public.beans (uid, user_uid, bean_name, roastery, producer, origin_country, origin_location, process, varietal, cup_flavor_notes, roasted_on) values
  -- Bean A: Ethiopian Yirgacheffe — fruity + floral
  ('00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-000000000001',
   'Yirgacheffe Natural', 'Onyx Coffee Lab', 'Dumerso Washing Station',
   'Ethiopia', 'Yirgacheffe', 'Natural', 'Heirloom',
   '[{"path":["Fruity","Berry","Blueberry"],"color":"#f97316"},{"path":["Floral","Jasmine"],"color":"#ec4899"}]'::jsonb,
   '2026-01-15'),

  -- Bean B: Colombian — sweet + nutty
  ('00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-000000000001',
   'Huila Supremo', 'Counter Culture', 'Finca El Paraiso',
   'Colombia', 'Huila', 'Washed', 'Caturra',
   '[{"path":["Sweet","Honey"],"color":"#f59e0b"},{"path":["Nutty/Cocoa","Nutty","Hazelnut"],"color":"#a16207"}]'::jsonb,
   '2026-01-20'),

  -- Bean C: Kenyan — fruity citrus + sour
  ('00000000-0000-0000-0000-0000000000a3',
   '00000000-0000-0000-0000-000000000001',
   'Nyeri AA', 'George Howell', 'Othaya Cooperative',
   'Kenya', 'Nyeri', 'Washed', 'SL28',
   '[{"path":["Fruity","Citrus Fruit","Grapefruit"],"color":"#f97316"},{"path":["Sour/Fermented","Sour","Tart"],"color":"#ef4444"}]'::jsonb,
   '2026-01-25'),

  -- Bean D: Guatemala — sweet caramel + spices
  ('00000000-0000-0000-0000-0000000000a4',
   '00000000-0000-0000-0000-000000000001',
   'Antigua Especial', 'Intelligentsia', 'Finca Los Volcanes',
   'Guatemala', 'Antigua', 'Washed', 'Bourbon',
   '[{"path":["Sweet","Brown Sugar","Caramel"],"color":"#f59e0b"},{"path":["Spices","Cinnamon"],"color":"#b45309"}]'::jsonb,
   '2026-02-01'),

  -- Bean E: Brazilian — nutty/cocoa + roasted
  ('00000000-0000-0000-0000-0000000000a5',
   '00000000-0000-0000-0000-000000000001',
   'Sul de Minas Pulped Natural', 'Sweet Maria''s', 'Fazenda Cachoeira',
   'Brazil', 'Sul de Minas', 'Pulped Natural', 'Catuai',
   '[{"path":["Nutty/Cocoa","Cocoa","Dark Chocolate"],"color":"#a16207"},{"path":["Roasted","Toast"],"color":"#92400e"}]'::jsonb,
   '2026-02-03'),

  -- Bean F: Panama Gesha — floral + sweet vanilla
  ('00000000-0000-0000-0000-0000000000a6',
   '00000000-0000-0000-0000-000000000001',
   'Gesha Village Lot 74', 'SEY Coffee', 'Finca Deborah',
   'Panama', 'Boquete', 'Natural', 'Gesha',
   '[{"path":["Floral","Rose"],"color":"#ec4899"},{"path":["Sweet","Vanilla"],"color":"#f59e0b"},{"path":["Fruity","Stone Fruit","Peach"],"color":"#f97316"}]'::jsonb,
   '2026-02-05');

-- ============================================================
-- 4. Bean flavor notes (normalized junction)
-- ============================================================
-- Bean A: Fruity > Berry > Blueberry, Floral > Jasmine
insert into public.bean_flavor_notes (bean_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000a1', 'Fruity',  'Berry',    'Blueberry', '#f97316'),
  ('00000000-0000-0000-0000-0000000000a1', 'Floral',  'Jasmine',  null,        '#ec4899');
-- Bean B: Sweet > Honey, Nutty/Cocoa > Nutty > Hazelnut
insert into public.bean_flavor_notes (bean_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000a2', 'Sweet',       'Honey',    null,      '#f59e0b'),
  ('00000000-0000-0000-0000-0000000000a2', 'Nutty/Cocoa', 'Nutty',    'Hazelnut','#a16207');
-- Bean C: Fruity > Citrus Fruit > Grapefruit, Sour/Fermented > Sour > Tart
insert into public.bean_flavor_notes (bean_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000a3', 'Fruity',         'Citrus Fruit', 'Grapefruit', '#f97316'),
  ('00000000-0000-0000-0000-0000000000a3', 'Sour/Fermented', 'Sour',         'Tart',       '#ef4444');
-- Bean D: Sweet > Brown Sugar > Caramel, Spices > Cinnamon
insert into public.bean_flavor_notes (bean_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000a4', 'Sweet',  'Brown Sugar', 'Caramel',  '#f59e0b'),
  ('00000000-0000-0000-0000-0000000000a4', 'Spices', 'Cinnamon',    null,       '#b45309');
-- Bean E: Nutty/Cocoa > Cocoa > Dark Chocolate, Roasted > Toast
insert into public.bean_flavor_notes (bean_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000a5', 'Nutty/Cocoa', 'Cocoa', 'Dark Chocolate', '#a16207'),
  ('00000000-0000-0000-0000-0000000000a5', 'Roasted',     'Toast', null,             '#92400e');
-- Bean F: Floral > Rose, Sweet > Vanilla, Fruity > Stone Fruit > Peach
insert into public.bean_flavor_notes (bean_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000a6', 'Floral', 'Rose',        null,   '#ec4899'),
  ('00000000-0000-0000-0000-0000000000a6', 'Sweet',  'Vanilla',     null,   '#f59e0b'),
  ('00000000-0000-0000-0000-0000000000a6', 'Fruity', 'Stone Fruit', 'Peach','#f97316');

-- ============================================================
-- 5. Brews (one per bean, diverse taste notes)
-- ============================================================
insert into public.brews (uid, user_uid, brew_date, bean_uid, grinder_uid, grinder_setting, recipe, coffee_dose_g, coffee_yield_g, coffee_tds, water, water_temp_c, rating, taste_note, taste_flavor_notes) values
  -- Brew 1 (Bean A) — tasted fruity berry + floral
  ('00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-000000000001', '2026-01-20',
   '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-000000000010', '4',
   'V60', 15, 250, 1.35, 'Third Wave Water', 93,
   4.5, 'Clean blueberry, jasmine tea finish',
   '[{"path":["Fruity","Berry","Blueberry"],"color":"#f97316"},{"path":["Floral","Jasmine"],"color":"#ec4899"}]'::jsonb),

  -- Brew 2 (Bean B) — tasted sweet honey + nutty
  ('00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-000000000001', '2026-01-25',
   '00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-000000000010', '5',
   'Kalita Wave', 18, 280, 1.40, 'Filtered tap', 92,
   4.0, 'Honey sweetness, hazelnut body',
   '[{"path":["Sweet","Honey"],"color":"#f59e0b"},{"path":["Nutty/Cocoa","Nutty","Hazelnut"],"color":"#a16207"}]'::jsonb),

  -- Brew 3 (Bean C) — tasted citrus + sour
  ('00000000-0000-0000-0000-0000000000b3',
   '00000000-0000-0000-0000-000000000001', '2026-01-28',
   '00000000-0000-0000-0000-0000000000a3',
   '00000000-0000-0000-0000-000000000010', '3.5',
   'Chemex', 30, 500, 1.32, 'Third Wave Water', 94,
   3.5, 'Bright grapefruit, a bit tart',
   '[{"path":["Fruity","Citrus Fruit","Grapefruit"],"color":"#f97316"},{"path":["Sour/Fermented","Sour","Tart"],"color":"#ef4444"}]'::jsonb),

  -- Brew 4 (Bean D) — tasted caramel + cinnamon
  ('00000000-0000-0000-0000-0000000000b4',
   '00000000-0000-0000-0000-000000000001', '2026-02-03',
   '00000000-0000-0000-0000-0000000000a4',
   '00000000-0000-0000-0000-000000000010', '4.5',
   'V60', 15, 250, 1.38, 'Filtered tap', 93,
   4.0, 'Caramel sweetness, cinnamon spice',
   '[{"path":["Sweet","Brown Sugar","Caramel"],"color":"#f59e0b"},{"path":["Spices","Cinnamon"],"color":"#b45309"}]'::jsonb),

  -- Brew 5 (Bean E) — tasted chocolate + toast
  ('00000000-0000-0000-0000-0000000000b5',
   '00000000-0000-0000-0000-000000000001', '2026-02-05',
   '00000000-0000-0000-0000-0000000000a5',
   '00000000-0000-0000-0000-000000000010', '5.5',
   'French Press', 20, 300, 1.42, 'Spring water', 96,
   3.0, 'Dark chocolate, toasty finish',
   '[{"path":["Nutty/Cocoa","Cocoa","Dark Chocolate"],"color":"#a16207"},{"path":["Roasted","Toast"],"color":"#92400e"}]'::jsonb),

  -- Brew 6 (Bean F) — tasted rose + sweet vanilla + peach
  ('00000000-0000-0000-0000-0000000000b6',
   '00000000-0000-0000-0000-000000000001', '2026-02-07',
   '00000000-0000-0000-0000-0000000000a6',
   '00000000-0000-0000-0000-000000000010', '3',
   'V60', 12, 200, 1.45, 'Third Wave Water', 90,
   5.0, 'Incredible rose florals, vanilla sweetness, juicy peach',
   '[{"path":["Floral","Rose"],"color":"#ec4899"},{"path":["Sweet","Vanilla"],"color":"#f59e0b"},{"path":["Fruity","Stone Fruit","Peach"],"color":"#f97316"}]'::jsonb),

  -- Brew 7 (Bean B again, different day) — tasted sweet brown sugar + vanilla note
  ('00000000-0000-0000-0000-0000000000b7',
   '00000000-0000-0000-0000-000000000001', '2026-02-09',
   '00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-000000000010', '5',
   'AeroPress', 14, 220, 1.36, 'Filtered tap', 85,
   4.5, 'Brown sugar sweetness, hint of vanilla',
   '[{"path":["Sweet","Brown Sugar"],"color":"#f59e0b"},{"path":["Sweet","Vanilla"],"color":"#f59e0b"}]'::jsonb),

  -- Brew 8 (Bean A again) — tasted fruity tropical + sweet
  ('00000000-0000-0000-0000-0000000000b8',
   '00000000-0000-0000-0000-000000000001', '2026-02-10',
   '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-000000000010', '4',
   'V60', 15, 250, 1.33, 'Third Wave Water', 93,
   4.0, 'More tropical this time, mango and a sweet finish',
   '[{"path":["Fruity","Tropical Fruit","Mango"],"color":"#f97316"},{"path":["Sweet"],"color":"#f59e0b"}]'::jsonb);

-- ============================================================
-- 6. Brew flavor notes (normalized junction)
-- ============================================================
-- Brew 1: Fruity > Berry > Blueberry, Floral > Jasmine
insert into public.brew_flavor_notes (brew_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000b1', 'Fruity', 'Berry',   'Blueberry', '#f97316'),
  ('00000000-0000-0000-0000-0000000000b1', 'Floral', 'Jasmine', null,        '#ec4899');
-- Brew 2: Sweet > Honey, Nutty/Cocoa > Nutty > Hazelnut
insert into public.brew_flavor_notes (brew_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000b2', 'Sweet',       'Honey', null,      '#f59e0b'),
  ('00000000-0000-0000-0000-0000000000b2', 'Nutty/Cocoa', 'Nutty', 'Hazelnut','#a16207');
-- Brew 3: Fruity > Citrus Fruit > Grapefruit, Sour/Fermented > Sour > Tart
insert into public.brew_flavor_notes (brew_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000b3', 'Fruity',         'Citrus Fruit', 'Grapefruit', '#f97316'),
  ('00000000-0000-0000-0000-0000000000b3', 'Sour/Fermented', 'Sour',         'Tart',       '#ef4444');
-- Brew 4: Sweet > Brown Sugar > Caramel, Spices > Cinnamon
insert into public.brew_flavor_notes (brew_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000b4', 'Sweet',  'Brown Sugar', 'Caramel', '#f59e0b'),
  ('00000000-0000-0000-0000-0000000000b4', 'Spices', 'Cinnamon',    null,      '#b45309');
-- Brew 5: Nutty/Cocoa > Cocoa > Dark Chocolate, Roasted > Toast
insert into public.brew_flavor_notes (brew_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000b5', 'Nutty/Cocoa', 'Cocoa', 'Dark Chocolate', '#a16207'),
  ('00000000-0000-0000-0000-0000000000b5', 'Roasted',     'Toast', null,             '#92400e');
-- Brew 6: Floral > Rose, Sweet > Vanilla, Fruity > Stone Fruit > Peach
insert into public.brew_flavor_notes (brew_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000b6', 'Floral', 'Rose',        null,    '#ec4899'),
  ('00000000-0000-0000-0000-0000000000b6', 'Sweet',  'Vanilla',     null,    '#f59e0b'),
  ('00000000-0000-0000-0000-0000000000b6', 'Fruity', 'Stone Fruit', 'Peach', '#f97316');
-- Brew 7: Sweet > Brown Sugar, Sweet > Vanilla
insert into public.brew_flavor_notes (brew_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000b7', 'Sweet', 'Brown Sugar', null, '#f59e0b'),
  ('00000000-0000-0000-0000-0000000000b7', 'Sweet', 'Vanilla',     null, '#f59e0b');
-- Brew 8: Fruity > Tropical Fruit > Mango, Sweet (broad, no l2)
insert into public.brew_flavor_notes (brew_uid, l1, l2, l3, color) values
  ('00000000-0000-0000-0000-0000000000b8', 'Fruity', 'Tropical Fruit', 'Mango', '#f97316'),
  ('00000000-0000-0000-0000-0000000000b8', 'Sweet',  null,             null,    '#f59e0b');

-- ============================================================
-- Expected filter behavior with this seed data:
--
-- Filter: "Sweet"           → Brews 2, 4, 6, 7, 8  (all have some Sweet/* note)
-- Filter: "Sweet > Honey"   → Brew 2 only
-- Filter: "Sweet > Vanilla" → Brews 6, 7
-- Filter: "Fruity"          → Brews 1, 3, 6, 8
-- Filter: "Floral"          → Brews 1, 6
-- Filter: "Nutty/Cocoa"     → Brews 2, 5
-- ============================================================
