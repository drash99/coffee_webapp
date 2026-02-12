-- DANGEROUS: Wipes all logging data for this app in the Supabase project.
-- Run this only if you are OK losing existing data.

-- Drop in dependency order

drop table if exists public.brew_flavor_notes cascade;
drop table if exists public.bean_flavor_notes cascade;
drop table if exists public.grinder_particle_sizes cascade;
drop table if exists public.brews cascade;
drop table if exists public.beans cascade;
drop table if exists public.grinders cascade;
drop function if exists public.set_user_uid_from_auth() cascade;

-- Recreate secure schema (Supabase Auth + RLS)

create table public.beans (
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

create table public.grinders (
  uid uuid primary key,
  user_uid uuid not null default auth.uid() references auth.users(id) on delete cascade,
  maker text,
  model text,
  created_at timestamptz not null default now()
);

create table public.brews (
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

create table public.grinder_particle_sizes (
  uid uuid primary key,
  user_uid uuid not null default auth.uid() references auth.users(id) on delete cascade,
  grinder_uid uuid not null references public.grinders(uid) on delete cascade,
  grinder_setting text not null,
  particle_median_um numeric not null,
  created_at timestamptz not null default now()
);

create table public.bean_flavor_notes (
  id bigserial primary key,
  bean_uid uuid not null references public.beans(uid) on delete cascade,
  l1 text not null,
  l2 text,
  l3 text,
  color text not null default '#6b7280'
);

create table public.brew_flavor_notes (
  id bigserial primary key,
  brew_uid uuid not null references public.brews(uid) on delete cascade,
  l1 text not null,
  l2 text,
  l3 text,
  color text not null default '#6b7280'
);

create index brews_user_uid_brew_date_idx on public.brews(user_uid, brew_date desc);
create index beans_user_uid_created_at_idx on public.beans(user_uid, created_at desc);
create index grinders_user_uid_created_at_idx on public.grinders(user_uid, created_at desc);
create index grinder_particle_sizes_user_grinder_idx on public.grinder_particle_sizes(user_uid, grinder_uid);

create index bean_flavor_notes_bean_idx on public.bean_flavor_notes(bean_uid);
create index bean_flavor_notes_l1_idx   on public.bean_flavor_notes(l1);
create index brew_flavor_notes_brew_idx on public.brew_flavor_notes(brew_uid);
create index brew_flavor_notes_l1_idx   on public.brew_flavor_notes(l1);

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

create trigger set_user_uid_beans
before insert on public.beans
for each row execute function public.set_user_uid_from_auth();

create trigger set_user_uid_grinders
before insert on public.grinders
for each row execute function public.set_user_uid_from_auth();

create trigger set_user_uid_brews
before insert on public.brews
for each row execute function public.set_user_uid_from_auth();

create trigger set_user_uid_grinder_particle_sizes
before insert on public.grinder_particle_sizes
for each row execute function public.set_user_uid_from_auth();

alter table public.beans enable row level security;
alter table public.grinders enable row level security;
alter table public.brews enable row level security;
alter table public.grinder_particle_sizes enable row level security;
alter table public.bean_flavor_notes enable row level security;
alter table public.brew_flavor_notes enable row level security;

create policy beans_own_rows on public.beans
for all
using (user_uid = auth.uid())
with check (user_uid = auth.uid());

create policy grinders_own_rows on public.grinders
for all
using (user_uid = auth.uid())
with check (user_uid = auth.uid());

create policy brews_own_rows on public.brews
for all
using (user_uid = auth.uid())
with check (user_uid = auth.uid());

create policy grinder_particle_sizes_own_rows on public.grinder_particle_sizes
for all
using (user_uid = auth.uid())
with check (user_uid = auth.uid());

create policy bean_flavor_notes_by_owned_bean on public.bean_flavor_notes
for all
using (
  exists (
    select 1 from public.beans b
    where b.uid = bean_flavor_notes.bean_uid
      and b.user_uid = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.beans b
    where b.uid = bean_flavor_notes.bean_uid
      and b.user_uid = auth.uid()
  )
);

create policy brew_flavor_notes_by_owned_brew on public.brew_flavor_notes
for all
using (
  exists (
    select 1 from public.brews br
    where br.uid = brew_flavor_notes.brew_uid
      and br.user_uid = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.brews br
    where br.uid = brew_flavor_notes.brew_uid
      and br.user_uid = auth.uid()
  )
);
