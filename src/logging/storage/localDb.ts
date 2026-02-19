/**
 * Local‑storage–backed CRUD for guest mode.
 *
 * Data is stored as JSON arrays under well‑known keys.
 * The API mirrors the Supabase calls used in the page components
 * so switching between guest / authenticated is straightforward.
 */

import type { BeanRow, BrewRow, FlavorNote, GrinderRow, GrinderParticleSizeRow } from '../types';

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEYS = {
  beans: 'beanlog.local.beans',
  brews: 'beanlog.local.brews',
  grinders: 'beanlog.local.grinders',
  particleSizes: 'beanlog.local.particle_sizes',
  guestActive: 'beanlog.guest.active',
} as const;

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function getAll<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function setAll<T>(key: string, items: T[]): void {
  localStorage.setItem(key, JSON.stringify(items));
}

// ---------------------------------------------------------------------------
// Guest session
// ---------------------------------------------------------------------------

export function isGuestActive(): boolean {
  return localStorage.getItem(KEYS.guestActive) === 'true';
}

export function setGuestActive(active: boolean): void {
  if (active) {
    localStorage.setItem(KEYS.guestActive, 'true');
  } else {
    localStorage.removeItem(KEYS.guestActive);
    localStorage.removeItem('beanlog.guest.bannerDismissed');
  }
}

// ---------------------------------------------------------------------------
// Beans
// ---------------------------------------------------------------------------

export function localListBeans(): BeanRow[] {
  return getAll<BeanRow>(KEYS.beans).sort(
    (a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime(),
  );
}

export function localInsertBean(bean: Omit<BeanRow, 'user_uid' | 'created_at'>): void {
  const all = getAll<BeanRow>(KEYS.beans);
  all.push({ ...bean, user_uid: 'guest', created_at: new Date().toISOString() });
  setAll(KEYS.beans, all);
}

export function localUpdateBean(uid: string, patch: Partial<BeanRow>): void {
  const all = getAll<BeanRow>(KEYS.beans);
  const idx = all.findIndex((b) => b.uid === uid);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch };
  setAll(KEYS.beans, all);
}

/** Delete a bean **and** cascade‑delete brews that reference it. */
export function localDeleteBean(uid: string): void {
  const brews = getAll<BrewRow>(KEYS.brews).filter((b) => b.bean_uid !== uid);
  setAll(KEYS.brews, brews);

  const beans = getAll<BeanRow>(KEYS.beans).filter((b) => b.uid !== uid);
  setAll(KEYS.beans, beans);
}

// ---------------------------------------------------------------------------
// Brews
// ---------------------------------------------------------------------------

export function localListBrews(): BrewRow[] {
  return getAll<BrewRow>(KEYS.brews).sort(
    (a, b) => new Date(b.brew_date).getTime() - new Date(a.brew_date).getTime(),
  );
}

export function localInsertBrew(brew: Omit<BrewRow, 'user_uid' | 'created_at'>): void {
  const all = getAll<BrewRow>(KEYS.brews);
  all.push({ ...brew, user_uid: 'guest', created_at: new Date().toISOString() });
  setAll(KEYS.brews, all);
}

export function localUpdateBrew(uid: string, patch: Partial<BrewRow>): void {
  const all = getAll<BrewRow>(KEYS.brews);
  const idx = all.findIndex((b) => b.uid === uid);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch };
  setAll(KEYS.brews, all);
}

export function localDeleteBrew(uid: string): void {
  const all = getAll<BrewRow>(KEYS.brews).filter((b) => b.uid !== uid);
  setAll(KEYS.brews, all);
}

// ---------------------------------------------------------------------------
// Grinders
// ---------------------------------------------------------------------------

export function localListGrinders(): GrinderRow[] {
  return getAll<GrinderRow>(KEYS.grinders);
}

/**
 * Find an existing grinder by maker+model (case‑insensitive) or create one.
 * Returns the grinder uid.
 */
export function localGetOrCreateGrinder(maker: string, model: string): string {
  const all = getAll<GrinderRow>(KEYS.grinders);
  const found = all.find(
    (g) =>
      (g.maker ?? '').toLowerCase() === maker.toLowerCase() &&
      (g.model ?? '').toLowerCase() === model.toLowerCase(),
  );
  if (found) return found.uid;

  const uid = crypto.randomUUID();
  all.push({ uid, user_uid: 'guest', maker, model, created_at: new Date().toISOString() });
  setAll(KEYS.grinders, all);
  return uid;
}

// ---------------------------------------------------------------------------
// Particle sizes
// ---------------------------------------------------------------------------

export function localInsertParticleSize(
  ps: Omit<GrinderParticleSizeRow, 'user_uid' | 'created_at'>,
): void {
  const all = getAll<GrinderParticleSizeRow>(KEYS.particleSizes);
  all.push({ ...ps, user_uid: 'guest', created_at: new Date().toISOString() });
  setAll(KEYS.particleSizes, all);
}

export function localSearchParticleSizes(
  grinderUid: string,
): { grinder_setting: string; particle_median_um: number }[] {
  return getAll<GrinderParticleSizeRow>(KEYS.particleSizes)
    .filter((ps) => ps.grinder_uid === grinderUid)
    .map((ps) => ({ grinder_setting: ps.grinder_setting, particle_median_um: ps.particle_median_um }));
}

// ---------------------------------------------------------------------------
// Joined queries (mirror Supabase join syntax shape)
// ---------------------------------------------------------------------------

export type LocalBrewWithBean = BrewRow & {
  beans: Pick<
    BeanRow,
    | 'uid'
    | 'bean_name'
    | 'roastery'
    | 'producer'
    | 'origin_location'
    | 'origin_country'
    | 'process'
    | 'varietal'
    | 'roasted_on'
    | 'cup_flavor_notes'
  > | null;
  grinders: Pick<GrinderRow, 'uid' | 'maker' | 'model'> | null;
};

export function localListBrewsWithBeans(): LocalBrewWithBean[] {
  const brews = localListBrews();
  const beans = getAll<BeanRow>(KEYS.beans);
  const grinders = getAll<GrinderRow>(KEYS.grinders);

  return brews.map((brew) => {
    const bean = beans.find((b) => b.uid === brew.bean_uid) ?? null;
    const grinder = brew.grinder_uid
      ? (grinders.find((g) => g.uid === brew.grinder_uid) ?? null)
      : null;
    return {
      ...brew,
      beans: bean
        ? {
            uid: bean.uid,
            bean_name: bean.bean_name,
            roastery: bean.roastery,
            producer: bean.producer,
            origin_location: bean.origin_location,
            origin_country: bean.origin_country,
            process: bean.process,
            varietal: bean.varietal,
            roasted_on: bean.roasted_on,
            cup_flavor_notes: bean.cup_flavor_notes,
          }
        : null,
      grinders: grinder
        ? {
            uid: grinder.uid,
            maker: grinder.maker,
            model: grinder.model,
          }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/** Return all locally stored data for inspection or migration. */
export function localGetAllData() {
  return {
    beans: getAll<BeanRow>(KEYS.beans),
    brews: getAll<BrewRow>(KEYS.brews),
    grinders: getAll<GrinderRow>(KEYS.grinders),
    particleSizes: getAll<GrinderParticleSizeRow>(KEYS.particleSizes),
  };
}

/** Remove all local data (does NOT clear the guest‑active flag). */
export function localClearAll(): void {
  localStorage.removeItem(KEYS.beans);
  localStorage.removeItem(KEYS.brews);
  localStorage.removeItem(KEYS.grinders);
  localStorage.removeItem(KEYS.particleSizes);
}

/** Quick check whether the guest has any stored records. */
export function localHasData(): boolean {
  return getAll<BeanRow>(KEYS.beans).length > 0 || getAll<BrewRow>(KEYS.brews).length > 0;
}

// ---------------------------------------------------------------------------
// Migrate local → Supabase
// ---------------------------------------------------------------------------

/**
 * Push all locally stored guest data to the authenticated Supabase user,
 * then clear local storage. The Supabase BEFORE INSERT trigger auto‑fills
 * `user_uid` from `auth.uid()`, so we omit it from the inserts.
 *
 * Insert order respects FK constraints:
 *   grinders → beans → brews → particle_sizes
 */
export async function migrateLocalToSupabase(): Promise<{ beans: number; brews: number }> {
  // Dynamic import to avoid pulling Supabase into the guest‑only bundle path
  const { getSupabaseClient } = await import('../../config/supabase');
  const supabase = getSupabaseClient();
  const data = localGetAllData();

  // 1. Grinders
  if (data.grinders.length > 0) {
    const rows = data.grinders.map((g) => ({ uid: g.uid, maker: g.maker, model: g.model }));
    const { error } = await supabase.from('grinders').insert(rows);
    if (error) throw new Error(`Grinders: ${error.message}`);
  }

  // 2. Beans + normalised flavor notes
  if (data.beans.length > 0) {
    const beanRows = data.beans.map((b) => ({
      uid: b.uid,
      bean_name: b.bean_name,
      roastery: b.roastery,
      producer: b.producer,
      origin_location: b.origin_location,
      origin_country: b.origin_country,
      process: b.process,
      varietal: b.varietal,
      cup_notes: b.cup_notes,
      cup_flavor_notes: b.cup_flavor_notes,
      roasted_on: b.roasted_on,
    }));
    const { error } = await supabase.from('beans').insert(beanRows);
    if (error) throw new Error(`Beans: ${error.message}`);

    const noteRows = data.beans.flatMap((b) =>
      ((b.cup_flavor_notes ?? []) as FlavorNote[]).map((n) => ({
        bean_uid: b.uid,
        l1: n.path[0] ?? '',
        l2: n.path[1] ?? null,
        l3: n.path[2] ?? null,
        color: n.color,
      })),
    );
    if (noteRows.length > 0) {
      const { error: noteErr } = await supabase.from('bean_flavor_notes').insert(noteRows);
      if (noteErr) throw new Error(`Bean notes: ${noteErr.message}`);
    }
  }

  // 3. Brews + normalised flavor notes
  if (data.brews.length > 0) {
    const brewRows = data.brews.map((b) => ({
      uid: b.uid,
      brew_date: b.brew_date,
      bean_uid: b.bean_uid,
      grinder_uid: b.grinder_uid,
      grinder_setting: b.grinder_setting,
      recipe: b.recipe,
      coffee_dose_g: b.coffee_dose_g,
      coffee_yield_g: b.coffee_yield_g,
      coffee_tds: b.coffee_tds,
      water: b.water,
      water_temp_c: b.water_temp_c,
      grind_median_um: b.grind_median_um,
      rating: b.rating,
      extraction_note: b.extraction_note,
      taste_note: b.taste_note,
      taste_flavor_notes: b.taste_flavor_notes,
    }));
    const { error } = await supabase.from('brews').insert(brewRows);
    if (error) throw new Error(`Brews: ${error.message}`);

    const brewNoteRows = data.brews.flatMap((b) =>
      ((b.taste_flavor_notes ?? []) as FlavorNote[]).map((n) => ({
        brew_uid: b.uid,
        l1: n.path[0] ?? '',
        l2: n.path[1] ?? null,
        l3: n.path[2] ?? null,
        color: n.color,
      })),
    );
    if (brewNoteRows.length > 0) {
      const { error: noteErr } = await supabase.from('brew_flavor_notes').insert(brewNoteRows);
      if (noteErr) throw new Error(`Brew notes: ${noteErr.message}`);
    }
  }

  // 4. Particle sizes
  if (data.particleSizes.length > 0) {
    const psRows = data.particleSizes.map((ps) => ({
      uid: ps.uid,
      grinder_uid: ps.grinder_uid,
      grinder_setting: ps.grinder_setting,
      particle_median_um: ps.particle_median_um,
    }));
    const { error } = await supabase.from('grinder_particle_sizes').insert(psRows);
    if (error) throw new Error(`Particle sizes: ${error.message}`);
  }

  const counts = { beans: data.beans.length, brews: data.brews.length };
  localClearAll();
  return counts;
}

