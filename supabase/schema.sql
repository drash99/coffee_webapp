-- BeanLog (logging) schema for Supabase Postgres
--
-- This app uses a simple, custom “app_users” table (uid/id/salt/hash).
-- For production, prefer Supabase Auth + RLS; this demo setup is intentionally minimal.

create table if not exists public.app_users (
  uid uuid primary key,
  id text not null unique,
  salt text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.beans (
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

create table if not exists public.grinders (
  uid uuid primary key,
  user_uid uuid not null references public.app_users(uid) on delete cascade,
  maker text,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.brews (
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

create table if not exists public.grinder_particle_sizes (
  uid uuid primary key,
  user_uid uuid not null references public.app_users(uid) on delete cascade,
  grinder_uid uuid not null references public.grinders(uid) on delete cascade,
  grinder_setting text not null,
  particle_median_um numeric not null,
  created_at timestamptz not null default now()
);

-- Normalized flavor-note junction tables for efficient hierarchical filtering.
-- l1/l2/l3 = SCA Flavor Wheel hierarchy levels.  l1 always set; l2/l3 nullable.

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
create index if not exists beans_user_uid_created_at_idx on public.beans(user_uid, created_at desc);
create index if not exists grinders_user_uid_created_at_idx on public.grinders(user_uid, created_at desc);
create index if not exists grinder_particle_sizes_user_grinder_idx on public.grinder_particle_sizes(user_uid, grinder_uid);

create index if not exists bean_flavor_notes_bean_idx on public.bean_flavor_notes(bean_uid);
create index if not exists bean_flavor_notes_l1_idx   on public.bean_flavor_notes(l1);
create index if not exists brew_flavor_notes_brew_idx on public.brew_flavor_notes(brew_uid);
create index if not exists brew_flavor_notes_l1_idx   on public.brew_flavor_notes(l1);


