-- Test-only downgrade: prove the dated patch repairs an old deployment rather
-- than merely passing because schema.sql already installed the same defenses.
drop policy brews_owned_references on public.brews;
drop policy particle_sizes_owned_grinder on public.grinder_particle_sizes;
drop function public.save_beanlog_data(jsonb);
do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.get_public_brew_by_token(text)'::regprocedure);
  definition := replace(definition, ' and b.user_uid = br.user_uid', '');
  definition := replace(definition, ' and g.user_uid = br.user_uid', '');
  execute definition;
end;
$$;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000901'), ('00000000-0000-4000-8000-000000000902');
insert into public.beans (uid, user_uid, bean_name) values (
  '00000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000901', 'Legacy private bean'
);
insert into public.grinders (uid, user_uid, maker) values (
  '00000000-0000-4000-8000-000000000921', '00000000-0000-4000-8000-000000000901', 'Legacy private grinder'
);
insert into public.brews (uid, user_uid, bean_uid, grinder_uid, brew_date) values (
  '00000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000921', now()
);
insert into public.grinder_particle_sizes (uid, user_uid, grinder_uid, grinder_setting, particle_median_um) values (
  '00000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000921', '10', 400
);
insert into public.brew_shares (brew_uid, share_token) values (
  '00000000-0000-4000-8000-000000000931', 'upgrade-legacy-mismatch'
);
select test.assert((select bean_name = 'Legacy private bean' from public.get_public_brew_by_token('upgrade-legacy-mismatch')),
  'upgrade fixture reproduces vulnerable public lookup before patch');
