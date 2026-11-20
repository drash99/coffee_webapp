create table if not exists public.app_users (
  uid uuid primary key,
  id text not null,
  salt text not null,
  password_hash text not null,
  "old credential hint" text
);
insert into public.app_users values (
  '00000000-0000-4000-8000-000000000099', 'synthetic-user', 'synthetic-salt',
  'synthetic-hash', 'synthetic-hint'
) on conflict (uid) do nothing;
alter table public.app_users disable row level security;
alter table public.app_users no force row level security;
drop policy if exists app_users_old_public_read on public.app_users;
create policy app_users_old_public_read on public.app_users for all using (true) with check (true);
grant all on public.app_users to public, anon, authenticated;
grant all (uid, id, salt, password_hash, "old credential hint") on public.app_users to public, anon, authenticated;
