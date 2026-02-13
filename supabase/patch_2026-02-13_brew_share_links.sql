-- Patch: brew share links (public read by token)
-- Run this for existing projects already using auth/RLS schema.

create table if not exists public.brew_shares (
  brew_uid uuid primary key references public.brews(uid) on delete cascade,
  share_token text not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists brew_shares_share_token_idx on public.brew_shares(share_token);

alter table public.brew_shares enable row level security;

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
