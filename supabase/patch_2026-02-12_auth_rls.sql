-- Migration: move logging security model to Supabase Auth + RLS.
--
-- NOTE:
-- - Existing rows in beans/brews/grinders/grinder_particle_sizes must have user_uid values
--   that exist in auth.users(id). If not, backfill/remap first.
-- - App now authenticates via supabase.auth and not public.app_users.

alter table if exists public.beans drop constraint if exists beans_user_uid_fkey;
alter table if exists public.grinders drop constraint if exists grinders_user_uid_fkey;
alter table if exists public.brews drop constraint if exists brews_user_uid_fkey;
alter table if exists public.grinder_particle_sizes drop constraint if exists grinder_particle_sizes_user_uid_fkey;

alter table if exists public.beans
  alter column user_uid set default auth.uid();
alter table if exists public.grinders
  alter column user_uid set default auth.uid();
alter table if exists public.brews
  alter column user_uid set default auth.uid();
alter table if exists public.grinder_particle_sizes
  alter column user_uid set default auth.uid();

alter table if exists public.beans
  add constraint beans_user_uid_fkey
  foreign key (user_uid) references auth.users(id) on delete cascade;
alter table if exists public.grinders
  add constraint grinders_user_uid_fkey
  foreign key (user_uid) references auth.users(id) on delete cascade;
alter table if exists public.brews
  add constraint brews_user_uid_fkey
  foreign key (user_uid) references auth.users(id) on delete cascade;
alter table if exists public.grinder_particle_sizes
  add constraint grinder_particle_sizes_user_uid_fkey
  foreign key (user_uid) references auth.users(id) on delete cascade;

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

drop policy if exists brew_flavor_notes_by_owned_brew on public.brew_flavor_notes;
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
