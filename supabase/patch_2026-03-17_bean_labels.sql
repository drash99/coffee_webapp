-- Patch: bean labels (print + QR public lookup by label UID)
--
-- Adds:
-- - public.bean_labels: per-label UID, bean FK, optional grams
-- - RPC public.get_public_bean_by_label_uid(label_uid): fetch bean details for QR

create table if not exists public.bean_labels (
  uid uuid primary key,
  bean_uid uuid not null references public.beans(uid) on delete cascade,
  grams numeric,
  created_at timestamptz not null default now()
);

create index if not exists bean_labels_bean_uid_idx on public.bean_labels(bean_uid);

alter table public.bean_labels enable row level security;

drop policy if exists bean_labels_by_owned_bean on public.bean_labels;
create policy bean_labels_by_owned_bean on public.bean_labels
for all
using (
  exists (
    select 1
    from public.beans b
    where b.uid = bean_labels.bean_uid
      and b.user_uid = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.beans b
    where b.uid = bean_labels.bean_uid
      and b.user_uid = auth.uid()
  )
);

create or replace function public.get_public_bean_by_label_uid(p_label_uid uuid)
returns table (
  label_uid uuid,
  grams numeric,
  bean_uid uuid,
  bean_user_uid uuid,
  bean_name text,
  roastery text,
  producer text,
  origin_location text,
  origin_country text,
  process text,
  varietal text,
  roasted_on date,
  cup_flavor_notes jsonb,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    bl.uid as label_uid,
    bl.grams,
    b.uid as bean_uid,
    b.user_uid as bean_user_uid,
    b.bean_name,
    b.roastery,
    b.producer,
    b.origin_location,
    b.origin_country,
    b.process,
    b.varietal,
    b.roasted_on,
    b.cup_flavor_notes,
    bl.created_at
  from public.bean_labels bl
  join public.beans b on b.uid = bl.bean_uid
  where bl.uid = p_label_uid
  limit 1;
$$;

grant execute on function public.get_public_bean_by_label_uid(uuid) to anon, authenticated;
