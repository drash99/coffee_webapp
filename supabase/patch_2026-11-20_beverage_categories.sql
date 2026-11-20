-- Apply after the atomic save and ownership patch.
begin;

-- Only unclassified rows are inferred; reapplying never undoes an owner's choice.
alter table public.beans
  add column if not exists beverage_type text
    check (beverage_type in ('coffee', 'tea', 'wine')),
  add column if not exists beverage_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(beverage_details) = 'object'
      and not (beverage_details @? 'strict $.* ? (@.type() != "string" && @.type() != "number")'));

-- Match product names, not coffee indicators or descriptors of flavor.
-- Keep in sync with classifyLegacyBean for guest records.
update public.beans
set beverage_type = case
  when ltrim(bean_name) ~* '(^|[^a-z0-9])(oolong|sencha|matcha|gyokuro|pu[ -]?er[ -]?h?|hojicha|genmaicha|darjeeling|earl[ -]grey|green tea|black tea|white tea|yellow tea|dark tea|herbal tea)([^a-z0-9]|$)|^tea([^a-z0-9]|$)|(^|[^a-z0-9])tea[[:space:]]*$|녹차|홍차|백차|황차|흑차|우롱|보이차|보이숙차|보이생차|말차|센차|호지차|겐마이차|옥로|다즐링|얼그레이|대홍포|철관음'
    and bean_name !~* '(^|[^a-z0-9])(coffee|espresso|decaf|arabica|robusta|washed|gesha|geisha|notes?|flavou?red|aroma|tea[ -]like)([^a-z0-9]|$)|커피|원두|에스프레소|디카페인|향미|노트'
    then 'tea'
  else 'coffee'
end
where beverage_type is null;

alter table public.beans
  alter column beverage_type set default 'coffee',
  alter column beverage_type set not null;

alter table public.brews
  add column if not exists beverage_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(beverage_details) = 'object'
      and not (beverage_details @? 'strict $.* ? (@.type() != "string" && @.type() != "number")'));

-- Atomic full-row upserts for a subset save or an entire guest migration.
-- Missing collections are untouched. Omitted nullable fields are reset to NULL;
-- omitted/null inline note arrays become []. created_at is insert-only.
create or replace function public.save_beanlog_data(p_data jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $save$
declare
  owner_uid uuid := auth.uid();
  collection text;
  rows_json jsonb;
  row_json jsonb;
  field_name text;
  field_type text;
  field_value jsonb;
  fields jsonb;
  required_fields text[];
  note jsonb;
  notes jsonb;
  seen_uids uuid[];
  row_uid uuid;
  bean public.beans;
  grinder public.grinders;
  brew public.brews;
  particle public.grinder_particle_sizes;
  label public.bean_labels;
begin
  if owner_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'BeanLog data must be an object' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_data) as k(name)
    where name not in ('beans', 'brews', 'grinders', 'particleSizes', 'beanLabels')
  ) then
    raise exception 'Unknown BeanLog collection' using errcode = '22023';
  end if;

  -- Parent collections precede their children. An exception in any iteration
  -- rolls back every earlier row and its normalized notes in this RPC call.
  foreach collection in array array['grinders', 'beans', 'brews', 'particleSizes', 'beanLabels']
  loop
    rows_json := coalesce(p_data -> collection, '[]'::jsonb);
    if jsonb_typeof(rows_json) is distinct from 'array' then
      raise exception '% must be an array', collection using errcode = '22023';
    end if;
    required_fields := array['uid'];
    case collection
      when 'beans' then
        fields := '{"bean_name":"string","roastery":"string","producer":"string",
          "origin_location":"string","origin_country":"string","process":"string",
          "varietal":"string","cup_notes":"string","cup_flavor_notes":"notes","roasted_on":"date",
          "beverage_type":"string","beverage_details":"object"}';
      when 'grinders' then
        fields := '{"maker":"string","model":"string"}';
      when 'brews' then
        fields := '{"brew_date":"timestamp","bean_uid":"uuid","grinder_uid":"uuid",
          "grinder_setting":"string","recipe":"string","coffee_dose_g":"number",
          "coffee_yield_g":"number","coffee_tds":"number","water":"string",
          "water_temp_c":"number","grind_median_um":"number","rating":"number",
          "extraction_note":"string","taste_note":"string","taste_flavor_notes":"notes",
          "beverage_details":"object"}';
        required_fields := required_fields || array['brew_date', 'bean_uid'];
      when 'particleSizes' then
        fields := '{"grinder_uid":"uuid","grinder_setting":"string","particle_median_um":"number"}';
        required_fields := required_fields || array['grinder_uid', 'grinder_setting', 'particle_median_um'];
      when 'beanLabels' then
        fields := '{"bean_uid":"uuid","grams":"number"}';
        required_fields := required_fields || array['bean_uid'];
    end case;
    fields := fields || '{"uid":"uuid","created_at":"timestamp","user_uid":"ignored"}'::jsonb;
    seen_uids := array[]::uuid[];

    for row_json in select value from jsonb_array_elements(rows_json)
    loop
      if jsonb_typeof(row_json) is distinct from 'object' then
        raise exception '% rows must be objects', collection using errcode = '22023';
      end if;
      foreach field_name in array required_fields
      loop
        if not (row_json ? field_name) or row_json -> field_name = 'null'::jsonb then
          raise exception '%.% is required', collection, field_name using errcode = '22023';
        end if;
      end loop;
      for field_name, field_value in select key, value from jsonb_each(row_json)
      loop
        field_type := fields ->> field_name;
        if field_type is null then
          raise exception 'Unknown field %.%', collection, field_name using errcode = '22023';
        end if;
        if field_type = 'ignored' then
          continue;
        end if;
        if field_name in ('beverage_type', 'beverage_details') and field_value = 'null'::jsonb then
          raise exception '%.% cannot be null', collection, field_name using errcode = '22023';
        end if;
        if field_value = 'null'::jsonb and field_name <> 'created_at' then
          continue;
        end if;
        case field_type
          when 'uuid' then
            if jsonb_typeof(field_value) <> 'string'
              or (field_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
              raise exception '%.% must be a UUID string', collection, field_name using errcode = '22023';
            end if;
            perform (field_value #>> '{}')::uuid;
          when 'timestamp' then
            if jsonb_typeof(field_value) <> 'string' then
              raise exception '%.% must be a timestamp string', collection, field_name using errcode = '22023';
            end if;
            if not isfinite((field_value #>> '{}')::timestamptz) then
              raise exception '%.% must be finite', collection, field_name using errcode = '22023';
            end if;
          when 'date' then
            if jsonb_typeof(field_value) <> 'string'
              or (field_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
              raise exception '%.% must be a YYYY-MM-DD string', collection, field_name using errcode = '22023';
            end if;
            perform (field_value #>> '{}')::date;
          when 'notes' then
            if jsonb_typeof(field_value) <> 'array' then
              raise exception '%.% must be an array', collection, field_name using errcode = '22023';
            end if;
            for note in select value from jsonb_array_elements(field_value)
            loop
              if jsonb_typeof(note) is distinct from 'object' then
                raise exception 'Flavor notes must be objects' using errcode = '22023';
              end if;
              if jsonb_typeof(note -> 'path') is distinct from 'array'
                or jsonb_typeof(note -> 'color') is distinct from 'string' then
                raise exception 'Flavor notes require a path array and color string' using errcode = '22023';
              end if;
              if jsonb_array_length(note -> 'path') not between 1 and 3
                or btrim(note ->> 'color') = ''
                or exists (
                  select 1 from jsonb_array_elements(note -> 'path') as p(value)
                  where jsonb_typeof(value) <> 'string' or btrim(value #>> '{}') = ''
                )
                or exists (
                  select 1 from jsonb_object_keys(note) as k(name) where name not in ('path', 'color')
                ) then
                raise exception 'Flavor notes require 1-3 nonempty strings and a color' using errcode = '22023';
              end if;
            end loop;
          else
            if jsonb_typeof(field_value) is distinct from field_type then
              raise exception '%.% must be a JSON %', collection, field_name, field_type using errcode = '22023';
            end if;
        end case;
      end loop;

      row_uid := (row_json ->> 'uid')::uuid;
      if row_uid = any(seen_uids) then
        raise exception 'Duplicate uid in %', collection using errcode = '22023';
      end if;
      seen_uids := array_append(seen_uids, row_uid);
      row_json := row_json || jsonb_build_object(
        'user_uid', owner_uid,
        'created_at', coalesce((row_json ->> 'created_at')::timestamptz, now())
      );

      -- ON CONFLICT DO UPDATE is subject to RLS, including the existing row:
      -- same-owner retries update; a conflicting hidden/foreign uid raises.
      case collection
        when 'grinders' then
          select * into grinder from jsonb_populate_record(null::public.grinders, row_json);
          insert into public.grinders (uid, user_uid, maker, model, created_at)
          values (grinder.uid, owner_uid, grinder.maker, grinder.model, grinder.created_at)
          on conflict (uid) do update set maker = excluded.maker, model = excluded.model;
        when 'beans' then
          notes := coalesce(nullif(row_json -> 'cup_flavor_notes', 'null'::jsonb), '[]'::jsonb);
          select * into bean from jsonb_populate_record(null::public.beans, row_json);
          insert into public.beans (
            uid, user_uid, bean_name, roastery, producer, origin_location, origin_country,
            process, varietal, cup_notes, cup_flavor_notes, roasted_on, created_at,
            beverage_type, beverage_details
          ) values (
            bean.uid, owner_uid, bean.bean_name, bean.roastery, bean.producer,
            bean.origin_location, bean.origin_country, bean.process, bean.varietal,
            bean.cup_notes, notes, bean.roasted_on, bean.created_at,
            coalesce(bean.beverage_type, 'coffee'), coalesce(bean.beverage_details, '{}'::jsonb)
          )
          on conflict (uid) do update set
            bean_name = excluded.bean_name, roastery = excluded.roastery,
            producer = excluded.producer, origin_location = excluded.origin_location,
            origin_country = excluded.origin_country, process = excluded.process,
            varietal = excluded.varietal, cup_notes = excluded.cup_notes,
            cup_flavor_notes = excluded.cup_flavor_notes, roasted_on = excluded.roasted_on,
            beverage_type = case when row_json ? 'beverage_type' then excluded.beverage_type else beans.beverage_type end,
            beverage_details = case when row_json ? 'beverage_details' then excluded.beverage_details else beans.beverage_details end;
          delete from public.bean_flavor_notes where bean_uid = bean.uid;
          insert into public.bean_flavor_notes (bean_uid, l1, l2, l3, color)
          select distinct bean.uid, n #>> '{path,0}', n #>> '{path,1}', n #>> '{path,2}', n ->> 'color'
          from jsonb_array_elements(notes) as items(n);
        when 'brews' then
          notes := coalesce(nullif(row_json -> 'taste_flavor_notes', 'null'::jsonb), '[]'::jsonb);
          select * into brew from jsonb_populate_record(null::public.brews, row_json);
          insert into public.brews (
            uid, user_uid, brew_date, bean_uid, grinder_uid, grinder_setting, recipe,
            coffee_dose_g, coffee_yield_g, coffee_tds, water, water_temp_c,
            grind_median_um, rating, extraction_note, taste_note, taste_flavor_notes, created_at, beverage_details
          ) values (
            brew.uid, owner_uid, brew.brew_date, brew.bean_uid, brew.grinder_uid,
            brew.grinder_setting, brew.recipe, brew.coffee_dose_g, brew.coffee_yield_g,
            brew.coffee_tds, brew.water, brew.water_temp_c, brew.grind_median_um,
            brew.rating, brew.extraction_note, brew.taste_note, notes, brew.created_at, coalesce(brew.beverage_details, '{}'::jsonb)
          )
          on conflict (uid) do update set
            brew_date = excluded.brew_date, bean_uid = excluded.bean_uid,
            grinder_uid = excluded.grinder_uid, grinder_setting = excluded.grinder_setting,
            recipe = excluded.recipe, coffee_dose_g = excluded.coffee_dose_g,
            coffee_yield_g = excluded.coffee_yield_g, coffee_tds = excluded.coffee_tds,
            water = excluded.water, water_temp_c = excluded.water_temp_c,
            grind_median_um = excluded.grind_median_um, rating = excluded.rating,
            extraction_note = excluded.extraction_note, taste_note = excluded.taste_note,
            taste_flavor_notes = excluded.taste_flavor_notes,
            beverage_details = case when row_json ? 'beverage_details' then excluded.beverage_details else brews.beverage_details end;
          delete from public.brew_flavor_notes where brew_uid = brew.uid;
          insert into public.brew_flavor_notes (brew_uid, l1, l2, l3, color)
          select distinct brew.uid, n #>> '{path,0}', n #>> '{path,1}', n #>> '{path,2}', n ->> 'color'
          from jsonb_array_elements(notes) as items(n);
        when 'particleSizes' then
          select * into particle from jsonb_populate_record(null::public.grinder_particle_sizes, row_json);
          insert into public.grinder_particle_sizes (
            uid, user_uid, grinder_uid, grinder_setting, particle_median_um, created_at
          ) values (
            particle.uid, owner_uid, particle.grinder_uid, particle.grinder_setting,
            particle.particle_median_um, particle.created_at
          )
          on conflict (uid) do update set
            grinder_uid = excluded.grinder_uid, grinder_setting = excluded.grinder_setting,
            particle_median_um = excluded.particle_median_um;
        when 'beanLabels' then
          select * into label from jsonb_populate_record(null::public.bean_labels, row_json);
          insert into public.bean_labels (uid, bean_uid, grams, created_at)
          values (label.uid, label.bean_uid, label.grams, label.created_at)
          on conflict (uid) do update set bean_uid = excluded.bean_uid, grams = excluded.grams;
      end case;
    end loop;
  end loop;
  return jsonb_build_object(
    'beans', jsonb_array_length(coalesce(p_data -> 'beans', '[]'::jsonb)),
    'brews', jsonb_array_length(coalesce(p_data -> 'brews', '[]'::jsonb))
  );
end;
$save$;

revoke all on function public.save_beanlog_data(jsonb) from public, anon;
grant execute on function public.save_beanlog_data(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
