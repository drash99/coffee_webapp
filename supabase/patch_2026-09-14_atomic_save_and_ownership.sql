-- Patch: ownership defenses, legacy credential lockdown, and atomic saves.
-- Apply after the auth, flavor-note, sharing, and bean-label patches.
-- Safe to apply again. Does not delete legacy users or reassign historical data.
begin;

-- Retain legacy credentials for administrator-led migration, but never expose them.
do $legacy$
declare
  columns_sql text;
begin
  if to_regclass('public.app_users') is not null then
    alter table public.app_users enable row level security;
    alter table public.app_users force row level security;
    revoke all privileges on table public.app_users from public, anon, authenticated;
    -- Column ACLs survive a table-level REVOKE.
    select string_agg(quote_ident(attname), ', ' order by attnum)
      into columns_sql
      from pg_attribute
      where attrelid = 'public.app_users'::regclass and attnum > 0 and not attisdropped;
    if columns_sql is not null then
      execute format(
        'revoke all privileges (%s) on table public.app_users from public, anon, authenticated',
        columns_sql
      );
    end if;
    drop policy if exists app_users_no_client_access on public.app_users;
    create policy app_users_no_client_access on public.app_users
      as restrictive for all to public using (false) with check (false);
  end if;
end;
$legacy$;

-- Restrictive guards also hold if an older deployment retains a permissive policy.
drop policy if exists brews_owned_references on public.brews;
create policy brews_owned_references on public.brews
as restrictive for all
using (user_uid = auth.uid())
with check (
  user_uid = auth.uid()
  and exists (
    select 1 from public.beans b
    where b.uid = brews.bean_uid and b.user_uid = brews.user_uid
  )
  and (
    grinder_uid is null or exists (
      select 1 from public.grinders g
      where g.uid = brews.grinder_uid and g.user_uid = brews.user_uid
    )
  )
);

drop policy if exists particle_sizes_owned_grinder on public.grinder_particle_sizes;
create policy particle_sizes_owned_grinder on public.grinder_particle_sizes
as restrictive for all
using (user_uid = auth.uid())
with check (
  user_uid = auth.uid()
  and exists (
    select 1 from public.grinders g
    where g.uid = grinder_particle_sizes.grinder_uid
      and g.user_uid = grinder_particle_sizes.user_uid
  )
);

-- Do not guess a replacement owner or delete historical records. Public lookup
-- independently hides mismatched parents; administrators can repair these rows.
do $audit$
declare
  bad_brews bigint;
  bad_particles bigint;
begin
  select count(*) into bad_brews
  from public.brews br
  join public.beans b on b.uid = br.bean_uid
  left join public.grinders g on g.uid = br.grinder_uid
  where b.user_uid <> br.user_uid or g.user_uid <> br.user_uid;
  select count(*) into bad_particles
  from public.grinder_particle_sizes ps
  join public.grinders g on g.uid = ps.grinder_uid
  where g.user_uid <> ps.user_uid;
  if bad_brews > 0 or bad_particles > 0 then
    raise warning 'BeanLog ownership audit: % brews and % particle sizes need administrator repair; records retained',
      bad_brews, bad_particles;
  end if;
end;
$audit$;

create or replace function public.get_public_brew_by_token(p_share_token text)
returns table (
  brew_uid uuid,
  brew_date timestamptz,
  bean_name text,
  roastery text,
  producer text,
  origin_location text,
  origin_country text,
  process text,
  varietal text,
  roasted_on date,
  cup_flavor_notes jsonb,
  grinder_maker text,
  grinder_model text,
  grinder_setting text,
  recipe text,
  coffee_dose_g numeric,
  coffee_yield_g numeric,
  coffee_tds numeric,
  water text,
  water_temp_c numeric,
  grind_median_um numeric,
  rating numeric,
  extraction_note text,
  taste_note text,
  taste_flavor_notes jsonb,
  shared_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    br.uid as brew_uid,
    br.brew_date,
    b.bean_name,
    b.roastery,
    b.producer,
    b.origin_location,
    b.origin_country,
    b.process,
    b.varietal,
    b.roasted_on,
    b.cup_flavor_notes,
    g.maker as grinder_maker,
    g.model as grinder_model,
    br.grinder_setting,
    br.recipe,
    br.coffee_dose_g,
    br.coffee_yield_g,
    br.coffee_tds,
    br.water,
    br.water_temp_c,
    br.grind_median_um,
    br.rating,
    br.extraction_note,
    br.taste_note,
    br.taste_flavor_notes,
    s.created_at as shared_at
  from public.brew_shares s
  join public.brews br on br.uid = s.brew_uid
  join public.beans b on b.uid = br.bean_uid and b.user_uid = br.user_uid
  left join public.grinders g on g.uid = br.grinder_uid and g.user_uid = br.user_uid
  where s.share_token = p_share_token
    and s.revoked_at is null
  limit 1;
$$;

grant execute on function public.get_public_brew_by_token(text) to anon, authenticated;

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
          "varietal":"string","cup_notes":"string","cup_flavor_notes":"notes","roasted_on":"date"}';
      when 'grinders' then
        fields := '{"maker":"string","model":"string"}';
      when 'brews' then
        fields := '{"brew_date":"timestamp","bean_uid":"uuid","grinder_uid":"uuid",
          "grinder_setting":"string","recipe":"string","coffee_dose_g":"number",
          "coffee_yield_g":"number","coffee_tds":"number","water":"string",
          "water_temp_c":"number","grind_median_um":"number","rating":"number",
          "extraction_note":"string","taste_note":"string","taste_flavor_notes":"notes"}';
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
            process, varietal, cup_notes, cup_flavor_notes, roasted_on, created_at
          ) values (
            bean.uid, owner_uid, bean.bean_name, bean.roastery, bean.producer,
            bean.origin_location, bean.origin_country, bean.process, bean.varietal,
            bean.cup_notes, notes, bean.roasted_on, bean.created_at
          )
          on conflict (uid) do update set
            bean_name = excluded.bean_name, roastery = excluded.roastery,
            producer = excluded.producer, origin_location = excluded.origin_location,
            origin_country = excluded.origin_country, process = excluded.process,
            varietal = excluded.varietal, cup_notes = excluded.cup_notes,
            cup_flavor_notes = excluded.cup_flavor_notes, roasted_on = excluded.roasted_on;
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
            grind_median_um, rating, extraction_note, taste_note, taste_flavor_notes, created_at
          ) values (
            brew.uid, owner_uid, brew.brew_date, brew.bean_uid, brew.grinder_uid,
            brew.grinder_setting, brew.recipe, brew.coffee_dose_g, brew.coffee_yield_g,
            brew.coffee_tds, brew.water, brew.water_temp_c, brew.grind_median_um,
            brew.rating, brew.extraction_note, brew.taste_note, notes, brew.created_at
          )
          on conflict (uid) do update set
            brew_date = excluded.brew_date, bean_uid = excluded.bean_uid,
            grinder_uid = excluded.grinder_uid, grinder_setting = excluded.grinder_setting,
            recipe = excluded.recipe, coffee_dose_g = excluded.coffee_dose_g,
            coffee_yield_g = excluded.coffee_yield_g, coffee_tds = excluded.coffee_tds,
            water = excluded.water, water_temp_c = excluded.water_temp_c,
            grind_median_um = excluded.grind_median_um, rating = excluded.rating,
            extraction_note = excluded.extraction_note, taste_note = excluded.taste_note,
            taste_flavor_notes = excluded.taste_flavor_notes;
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

commit;
