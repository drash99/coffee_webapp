-- DANGEROUS: Wipes all logging/auth data for this app in the Supabase project.
-- Run this only if you are OK losing existing data.

-- Drop in dependency order
drop table if exists public.grinder_particle_sizes cascade;
drop table if exists public.brews cascade;
drop table if exists public.beans cascade;
drop table if exists public.grinders cascade;
drop table if exists public.app_users cascade;

-- Recreate (clean schema, no legacy columns)

create table public.app_users (
  uid uuid primary key,
  id text not null unique,
  salt text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table public.beans (
  uid uuid primary key,
  user_uid uuid not null references public.app_users(uid) on delete cascade,
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
  user_uid uuid not null references public.app_users(uid) on delete cascade,
  maker text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table public.brews (
  uid uuid primary key,
  user_uid uuid not null references public.app_users(uid) on delete cascade,
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
  user_uid uuid not null references public.app_users(uid) on delete cascade,
  grinder_uid uuid not null references public.grinders(uid) on delete cascade,
  grinder_setting text not null,
  particle_median_um numeric not null,
  created_at timestamptz not null default now()
);

create index brews_user_uid_brew_date_idx on public.brews(user_uid, brew_date desc);
create index beans_user_uid_created_at_idx on public.beans(user_uid, created_at desc);
create index grinders_user_uid_created_at_idx on public.grinders(user_uid, created_at desc);
create index grinder_particle_sizes_user_grinder_idx on public.grinder_particle_sizes(user_uid, grinder_uid);

-- Refresh PostgREST schema cache if needed:
-- notify pgrst, 'reload schema';


