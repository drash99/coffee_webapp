-- Patch: Normalized flavor-note junction tables
-- Replaces inefficient jsonb filtering with proper relational lookups.
-- Each row = one flavor note; l1/l2/l3 map to the SCA Flavor Wheel hierarchy.
-- l1 is always set; l2/l3 are NULL when the note is at a broader level.
--
-- Searching for "Sweet" → WHERE l1 = 'Sweet'  (matches Sweet, Sweet/Honey, Sweet/Brown Sugar/Caramel…)
-- Searching for "Sweet > Honey" → WHERE l1 = 'Sweet' AND l2 = 'Honey'

-- Bean cup-profile notes (from the bag / cupping sheet)
create table if not exists public.bean_flavor_notes (
  id bigserial primary key,
  bean_uid uuid not null references public.beans(uid) on delete cascade,
  l1 text not null,
  l2 text,
  l3 text,
  color text not null default '#6b7280'
);

create index if not exists bean_flavor_notes_bean_idx on public.bean_flavor_notes(bean_uid);
create index if not exists bean_flavor_notes_l1_idx   on public.bean_flavor_notes(l1);

-- Brew taste notes (what the user actually tasted)
create table if not exists public.brew_flavor_notes (
  id bigserial primary key,
  brew_uid uuid not null references public.brews(uid) on delete cascade,
  l1 text not null,
  l2 text,
  l3 text,
  color text not null default '#6b7280'
);

create index if not exists brew_flavor_notes_brew_idx on public.brew_flavor_notes(brew_uid);
create index if not exists brew_flavor_notes_l1_idx   on public.brew_flavor_notes(l1);

-- Optional: if you use PostgREST schema cache and see "schema cache" errors, run:
-- notify pgrst, 'reload schema';
