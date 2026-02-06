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
  origin text,
  process text,
  varietal text,
  cup_notes text,
  roasted_on date,
  created_at timestamptz not null default now()
);

create table if not exists public.grinders (
  uid uuid primary key,
  user_uid uuid not null references public.app_users(uid) on delete cascade,
  maker text,
  model text,
  setting text,
  created_at timestamptz not null default now()
);

create table if not exists public.brews (
  uid uuid primary key,
  user_uid uuid not null references public.app_users(uid) on delete cascade,
  brew_date timestamptz not null,
  bean_uid uuid not null references public.beans(uid) on delete cascade,
  grinder_uid uuid references public.grinders(uid) on delete set null,
  recipe text,
  coffee_dose_g numeric,
  coffee_yield_g numeric,
  coffee_tds numeric,
  water text,
  water_temp_c numeric,
  extraction_note text,
  taste_note text,
  cup_flavor_notes jsonb not null default '[]'::jsonb,
  taste_flavor_notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists brews_user_uid_brew_date_idx on public.brews(user_uid, brew_date desc);
create index if not exists beans_user_uid_created_at_idx on public.beans(user_uid, created_at desc);
create index if not exists grinders_user_uid_created_at_idx on public.grinders(user_uid, created_at desc);


