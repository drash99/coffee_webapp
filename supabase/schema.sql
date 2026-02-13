-- BeanLog logging schema (Supabase Auth + RLS)
--
-- Requires Supabase Auth. Tables are scoped by auth.uid() via user_uid + RLS.

create table if not exists public.beans (
  uid uuid primary key,
  user_uid uuid not null default auth.uid() references auth.users(id) on delete cascade,
  bean_name text,
  roastery text,
  producer text,
  origin_location text,
  origin_country text,
  process text,
  varietal text,
  cup_notes text,
  cup_flavor_notes jsonb not null default '[]'::jsonb,
  roasted_on date,
  created_at timestamptz not null default now()
);

create table if not exists public.grinders (
  uid uuid primary key,
  user_uid uuid not null default auth.uid() references auth.users(id) on delete cascade,
  maker text,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.brews (
  uid uuid primary key,
  user_uid uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brew_date timestamptz not null,
  bean_uid uuid not null references public.beans(uid) on delete cascade,
  grinder_uid uuid references public.grinders(uid) on delete set null,
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
  taste_flavor_notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.brew_shares (
  brew_uid uuid primary key references public.brews(uid) on delete cascade,
  share_token text not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.grinder_particle_sizes (
  uid uuid primary key,
  user_uid uuid not null default auth.uid() references auth.users(id) on delete cascade,
  grinder_uid uuid not null references public.grinders(uid) on delete cascade,
  grinder_setting text not null,
  particle_median_um numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.bean_flavor_notes (
  id bigserial primary key,
  bean_uid uuid not null references public.beans(uid) on delete cascade,
  l1 text not null,
  l2 text,
  l3 text,
  color text not null default '#6b7280'
);

create table if not exists public.brew_flavor_notes (
  id bigserial primary key,
  brew_uid uuid not null references public.brews(uid) on delete cascade,
  l1 text not null,
  l2 text,
  l3 text,
  color text not null default '#6b7280'
);

create index if not exists brews_user_uid_brew_date_idx on public.brews(user_uid, brew_date desc);
create index if not exists brew_shares_share_token_idx on public.brew_shares(share_token);
create index if not exists beans_user_uid_created_at_idx on public.beans(user_uid, created_at desc);
create index if not exists grinders_user_uid_created_at_idx on public.grinders(user_uid, created_at desc);
create index if not exists grinder_particle_sizes_user_grinder_idx on public.grinder_particle_sizes(user_uid, grinder_uid);

create index if not exists bean_flavor_notes_bean_idx on public.bean_flavor_notes(bean_uid);
create index if not exists bean_flavor_notes_l1_idx   on public.bean_flavor_notes(l1);
create index if not exists brew_flavor_notes_brew_idx on public.brew_flavor_notes(brew_uid);
create index if not exists brew_flavor_notes_l1_idx   on public.brew_flavor_notes(l1);

-- Backfill user_uid from auth context if omitted by client.
create or replace function public.set_user_uid_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_uid is null then
    new.user_uid := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_user_uid_beans on public.beans;
create trigger set_user_uid_beans
before insert on public.beans
for each row execute function public.set_user_uid_from_auth();

drop trigger if exists set_user_uid_grinders on public.grinders;
create trigger set_user_uid_grinders
before insert on public.grinders
for each row execute function public.set_user_uid_from_auth();

drop trigger if exists set_user_uid_brews on public.brews;
create trigger set_user_uid_brews
before insert on public.brews
for each row execute function public.set_user_uid_from_auth();

drop trigger if exists set_user_uid_grinder_particle_sizes on public.grinder_particle_sizes;
create trigger set_user_uid_grinder_particle_sizes
before insert on public.grinder_particle_sizes
for each row execute function public.set_user_uid_from_auth();

alter table public.beans enable row level security;
alter table public.grinders enable row level security;
alter table public.brews enable row level security;
alter table public.brew_shares enable row level security;
alter table public.grinder_particle_sizes enable row level security;
alter table public.bean_flavor_notes enable row level security;
alter table public.brew_flavor_notes enable row level security;

drop policy if exists beans_own_rows on public.beans;
create policy beans_own_rows on public.beans
for all
using (user_uid = auth.uid())
with check (user_uid = auth.uid());

drop policy if exists grinders_own_rows on public.grinders;
create policy grinders_own_rows on public.grinders
for all
using (user_uid = auth.uid())
with check (user_uid = auth.uid());

drop policy if exists brews_own_rows on public.brews;
create policy brews_own_rows on public.brews
for all
using (user_uid = auth.uid())
with check (user_uid = auth.uid());

drop policy if exists brew_shares_by_owned_brew on public.brew_shares;
create policy brew_shares_by_owned_brew on public.brew_shares
for all
using (
  exists (
    select 1
    from public.brews br
    where br.uid = brew_shares.brew_uid
      and br.user_uid = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.brews br
    where br.uid = brew_shares.brew_uid
      and br.user_uid = auth.uid()
  )
);

drop policy if exists grinder_particle_sizes_own_rows on public.grinder_particle_sizes;
create policy grinder_particle_sizes_own_rows on public.grinder_particle_sizes
for all
using (user_uid = auth.uid())
with check (user_uid = auth.uid());

drop policy if exists bean_flavor_notes_by_owned_bean on public.bean_flavor_notes;
create policy bean_flavor_notes_by_owned_bean on public.bean_flavor_notes
for all
using (
  exists (
    select 1
    from public.beans b
    where b.uid = bean_flavor_notes.bean_uid
      and b.user_uid = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.beans b
    where b.uid = bean_flavor_notes.bean_uid
      and b.user_uid = auth.uid()
  )
);

drop policy if exists brew_flavor_notes_by_owned_brew on public.brew_flavor_notes;
create policy brew_flavor_notes_by_owned_brew on public.brew_flavor_notes
for all
using (
  exists (
    select 1
    from public.brews br
    where br.uid = brew_flavor_notes.brew_uid
      and br.user_uid = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.brews br
    where br.uid = brew_flavor_notes.brew_uid
      and br.user_uid = auth.uid()
  )
);

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
  left join public.beans b on b.uid = br.bean_uid
  left join public.grinders g on g.uid = br.grinder_uid
  where s.share_token = p_share_token
    and s.revoked_at is null
  limit 1;
$$;

grant execute on function public.get_public_brew_by_token(text) to anon, authenticated;
