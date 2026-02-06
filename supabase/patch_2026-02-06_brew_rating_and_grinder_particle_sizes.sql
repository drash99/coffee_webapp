-- Patch for existing Supabase DBs (adds brew rating + grind median size + grinder particle-size mapping table)

alter table if exists public.brews
  add column if not exists grinder_setting text;

alter table if exists public.brews
  add column if not exists grind_median_um numeric;

alter table if exists public.brews
  add column if not exists rating numeric;

create table if not exists public.grinder_particle_sizes (
  uid uuid primary key,
  user_uid uuid not null references public.app_users(uid) on delete cascade,
  grinder_uid uuid not null references public.grinders(uid) on delete cascade,
  grinder_setting text not null,
  particle_median_um numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists grinder_particle_sizes_user_grinder_idx on public.grinder_particle_sizes(user_uid, grinder_uid);

-- Optional: if you use PostgREST schema cache and see "schema cache" errors, run:
-- notify pgrst, 'reload schema';


