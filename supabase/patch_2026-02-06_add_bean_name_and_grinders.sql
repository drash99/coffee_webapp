-- Patch for existing Supabase DBs created before 2026-02-06
-- Adds:
-- - beans.bean_name
-- - grinders table
-- - brews.grinder_uid foreign key

alter table if exists public.beans
  add column if not exists bean_name text;

create table if not exists public.grinders (
  uid uuid primary key,
  user_uid uuid not null references public.app_users(uid) on delete cascade,
  maker text,
  model text,
  setting text,
  created_at timestamptz not null default now()
);

alter table if exists public.brews
  add column if not exists grinder_uid uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'brews_grinder_uid_fkey'
  ) then
    alter table public.brews
      add constraint brews_grinder_uid_fkey
      foreign key (grinder_uid) references public.grinders(uid) on delete set null;
  end if;
end$$;

create index if not exists grinders_user_uid_created_at_idx on public.grinders(user_uid, created_at desc);

-- Optional: if you use PostgREST schema cache and see "schema cache" errors, run:
-- notify pgrst, 'reload schema';


