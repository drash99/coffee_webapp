/**
 * Local‑storage–backed CRUD for guest mode.
 *
 * Data is stored as JSON arrays under well‑known keys.
 * The API mirrors the Supabase calls used in the page components
 * so switching between guest / authenticated is straightforward.
 */

import type { BeanLabelRow, BeanRow, BrewRow, GrinderRow, GrinderParticleSizeRow } from '../types';
import { classifyLegacyBean } from '../utils/beverage';
import {
  COLLECTIONS, LocalDataError, isRecord, isTimestamp, isUuid, validateCollections, validateLocalData,
  type LocalData, type LocalSaveData,
} from './localDataValidation';
import { readStorage, writeStorageAtomically } from './storageIO';

export { LocalDataError } from './localDataValidation';
export type { LocalData, LocalDataErrorCode, LocalSaveData } from './localDataValidation';

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEYS = {
  beans: 'beanlog.local.beans',
  brews: 'beanlog.local.brews',
  grinders: 'beanlog.local.grinders',
  particleSizes: 'beanlog.local.particle_sizes',
  beanLabels: 'beanlog.local.bean_labels',
  guestActive: 'beanlog.guest.active',
} as const;

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function getAll<T>(key: string): T[] {
  const raw = readStorage(key);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new LocalDataError('INVALID_DATA', key);
    return parsed as T[];
  } catch (cause) {
    if (cause instanceof LocalDataError) throw cause;
    throw new LocalDataError('INVALID_DATA', key, cause);
  }
}

function setAll<T>(key: string, items: T[]): void {
  writeStorageAtomically({ [key]: JSON.stringify(items) });
}

function writeData(data: LocalData, collections: readonly (keyof LocalData)[] = COLLECTIONS): void {
  const changes = Object.fromEntries(collections.map((collection) => [KEYS[collection], JSON.stringify(data[collection])]));
  writeStorageAtomically(changes);
}

const sameUid = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function mergeRows<T extends { uid: string; created_at?: string }>(
  existing: T[], incoming: Omit<T, 'user_uid'>[], guestOwner: boolean, now: string,
): T[] {
  const rows = [...existing];
  const positions = new Map(rows.map((row, index) => [row.uid.toLowerCase(), index]));
  const seen = new Set<string>();
  for (const row of incoming) {
    if (!isRecord(row) || !isUuid(row.uid)) throw new LocalDataError('INVALID_DATA', 'uid');
    const uid = row.uid.toLowerCase();
    if (seen.has(uid)) throw new LocalDataError('DUPLICATE_ID', 'uid');
    seen.add(uid);
    const index = positions.get(uid);
    const created_at = (index === undefined ? undefined : rows[index].created_at) ??
      (row.created_at === undefined ? now : row.created_at);
    const previous = index === undefined ? undefined : rows[index];
    const saved = {
      ...(previous && 'beverage_type' in previous ? { beverage_type: previous.beverage_type } : {}),
      ...(previous && 'beverage_details' in previous ? { beverage_details: previous.beverage_details } : {}),
      ...row, ...(guestOwner ? { user_uid: 'guest' } : {}), created_at,
    } as T;
    if (index === undefined) {
      positions.set(uid, rows.length);
      rows.push(saved);
    } else {
      rows[index] = saved;
    }
  }
  return rows;
}

/** Atomically upsert complete rows and repair legacy orphan labels, preserving creation times. */
export function localSaveData(data: LocalSaveData): void {
  validateCollections(data, true);
  const current = localGetAllData();
  validateLocalData(current, { allowOrphanLabels: true });
  const currentBeanIds = new Set(current.beans.map((row) => row.uid.toLowerCase()));
  const orphanLabelIds = new Set(current.beanLabels
    .filter((row) => !currentBeanIds.has(row.bean_uid.toLowerCase()))
    .map((row) => row.uid.toLowerCase()));
  const now = new Date().toISOString();
  const next: LocalData = {
    beans: mergeRows(current.beans, data.beans ?? [], true, now),
    brews: mergeRows(current.brews, data.brews ?? [], true, now),
    grinders: mergeRows(current.grinders, data.grinders ?? [], true, now),
    particleSizes: mergeRows(current.particleSizes, data.particleSizes ?? [], true, now),
    beanLabels: mergeRows(current.beanLabels, data.beanLabels ?? [], false, now),
  };
  // Only repair pre-existing orphan labels, never malformed or explicitly submitted rows.
  const submittedLabelIds = new Set((data.beanLabels ?? []).map((row) => row.uid.toLowerCase()));
  const nextBeanIds = new Set(next.beans.map((row) => row.uid.toLowerCase()));
  const labelsBeforeRepair = next.beanLabels;
  next.beanLabels = next.beanLabels.filter((row) => !orphanLabelIds.has(row.uid.toLowerCase()) ||
    submittedLabelIds.has(row.uid.toLowerCase()) || nextBeanIds.has(row.bean_uid.toLowerCase()));
  const repairedLabels = next.beanLabels.length !== labelsBeforeRepair.length;
  validateLocalData(next);
  writeData(next, COLLECTIONS.filter((collection) => data[collection]?.length ||
    (collection === 'beanLabels' && repairedLabels)));
}

// ---------------------------------------------------------------------------
// Guest session
// ---------------------------------------------------------------------------

export function isGuestActive(): boolean {
  return readStorage(KEYS.guestActive) === 'true';
}

export function setGuestActive(active: boolean): void {
  if (active) {
    writeStorageAtomically({ [KEYS.guestActive]: 'true' });
  } else {
    writeStorageAtomically({ [KEYS.guestActive]: null, 'beanlog.guest.bannerDismissed': null });
  }
}

// ---------------------------------------------------------------------------
// Beans
// ---------------------------------------------------------------------------

function readBeans(): BeanRow[] {
  return getAll<BeanRow>(KEYS.beans).map(classifyLegacyBean);
}

export function localListBeans(): BeanRow[] {
  return readBeans().sort(
    (a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime(),
  );
}

export function localInsertBean(bean: Omit<BeanRow, 'user_uid' | 'created_at'>): void {
  localSaveData({ beans: [bean] });
}

export function localUpdateBean(uid: string, patch: Partial<BeanRow>): void {
  const all = getAll<BeanRow>(KEYS.beans);
  const idx = all.findIndex((b) => sameUid(b.uid, uid));
  if (idx === -1) return;
  localSaveData({ beans: [{ ...all[idx], ...patch, uid: all[idx].uid }] });
}

/** Delete a bean and its brews and labels in the same local write. */
export function localDeleteBean(uid: string): void {
  const data = localGetAllData();
  data.brews = data.brews.filter((b) => !sameUid(b.bean_uid, uid));
  data.beanLabels = data.beanLabels.filter((label) => !sameUid(label.bean_uid, uid));
  data.beans = data.beans.filter((b) => !sameUid(b.uid, uid));
  validateLocalData(data);
  writeData(data, ['beans', 'brews', 'beanLabels']);
}

// ---------------------------------------------------------------------------
// Brews
// ---------------------------------------------------------------------------

export function localListBrews(): BrewRow[] {
  const timestamp = (value?: string) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  return getAll<BrewRow>(KEYS.brews)
    .map((brew, index) => ({ brew, index }))
    .sort((a, b) => timestamp(b.brew.brew_date) - timestamp(a.brew.brew_date) ||
      timestamp(b.brew.created_at) - timestamp(a.brew.created_at) || b.index - a.index)
    .map(({ brew }) => brew);
}

export function localInsertBrew(brew: Omit<BrewRow, 'user_uid' | 'created_at'>): void {
  localSaveData({ brews: [brew] });
}

export function localUpdateBrew(uid: string, patch: Partial<BrewRow>): void {
  const all = getAll<BrewRow>(KEYS.brews);
  const idx = all.findIndex((b) => sameUid(b.uid, uid));
  if (idx === -1) return;
  localSaveData({ brews: [{ ...all[idx], ...patch, uid: all[idx].uid }] });
}

export function localDeleteBrew(uid: string): void {
  const all = getAll<BrewRow>(KEYS.brews).filter((b) => !sameUid(b.uid, uid));
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
  localSaveData({ grinders: [{ uid, maker, model }] });
  return uid;
}

// ---------------------------------------------------------------------------
// Particle sizes
// ---------------------------------------------------------------------------

export function localInsertParticleSize(
  ps: Omit<GrinderParticleSizeRow, 'user_uid' | 'created_at'>,
): void {
  localSaveData({ particleSizes: [ps] });
}

export function localSearchParticleSizes(
  grinderUid: string,
): { grinder_setting: string; particle_median_um: number }[] {
  return getAll<GrinderParticleSizeRow>(KEYS.particleSizes)
    .filter((ps) => sameUid(ps.grinder_uid, grinderUid))
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
    | 'cup_notes'
    | 'roasted_on'
    | 'cup_flavor_notes'
    | 'beverage_type'
  > | null;
  grinders: Pick<GrinderRow, 'uid' | 'maker' | 'model'> | null;
};

export function localListBrewsWithBeans(): LocalBrewWithBean[] {
  const brews = localListBrews();
  const beans = readBeans();
  const grinders = getAll<GrinderRow>(KEYS.grinders);

  return brews.map((brew) => {
    const bean = beans.find((b) => sameUid(b.uid, brew.bean_uid)) ?? null;
    const grinder = brew.grinder_uid
      ? (grinders.find((g) => sameUid(g.uid, brew.grinder_uid!)) ?? null)
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
            cup_notes: bean.cup_notes,
            roasted_on: bean.roasted_on,
            cup_flavor_notes: bean.cup_flavor_notes,
            ...(bean.beverage_type ? { beverage_type: bean.beverage_type } : {}),
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
export function localGetAllData(): LocalData {
  return {
    beans: readBeans(),
    brews: getAll<BrewRow>(KEYS.brews),
    grinders: getAll<GrinderRow>(KEYS.grinders),
    particleSizes: getAll<GrinderParticleSizeRow>(KEYS.particleSizes),
    beanLabels: getAll<BeanLabelRow>(KEYS.beanLabels),
  };
}

/** Remove all local data (does NOT clear the guest‑active flag). */
export function localClearAll(): void {
  writeStorageAtomically(Object.fromEntries(COLLECTIONS.map((collection) => [KEYS[collection], null])));
}

/** Quick check whether the guest has any stored records. */
export function localHasData(): boolean {
  return COLLECTIONS.some((collection) => getAll(KEYS[collection]).length > 0);
}

export type LocalBackupPayload = {
  version: 1;
  exported_at: string;
  data: ReturnType<typeof localGetAllData>;
};

/** Prepare export/migration data without modifying the stored snapshot. */
function prepareLocalSnapshot(original: LocalData): { snapshot: LocalData; orphanLabels: BeanLabelRow[] } {
  // Old guest bean deletion left orphan labels. Do not relax any other validation.
  validateLocalData(original, { allowOrphanLabels: true });
  const beanIds = new Set(original.beans.map((bean) => bean.uid.toLowerCase()));
  const orphanLabels = original.beanLabels.filter((label) => !beanIds.has(label.bean_uid.toLowerCase()));
  const snapshot: LocalData = {
    ...original,
    beanLabels: original.beanLabels.filter((label) => beanIds.has(label.bean_uid.toLowerCase())),
  };
  validateLocalData(snapshot);
  return { snapshot, orphanLabels };
}

export function localBuildBackupPayload(): LocalBackupPayload {
  const { snapshot } = prepareLocalSnapshot(localGetAllData());
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    data: snapshot,
  };
}

export function localRestoreFromBackup(payload: unknown): ReturnType<typeof localGetAllData> {
  if (!isRecord(payload)) throw new LocalDataError('INVALID_BACKUP');
  let data: unknown = payload;
  if ('version' in payload || 'data' in payload || 'exported_at' in payload) {
    if (payload.version !== 1) throw new LocalDataError('UNSUPPORTED_BACKUP_VERSION');
    if (Object.keys(payload).length !== 3 || !isTimestamp(payload.exported_at)) {
      throw new LocalDataError('INVALID_BACKUP');
    }
    data = payload.data;
  }
  // Legacy raw exports must contain exactly the same complete five-collection snapshot.
  validateLocalData(data);
  writeData(data);
  return data;
}

// ---------------------------------------------------------------------------
// Bean labels (guest-only persistence)
// ---------------------------------------------------------------------------

export function localInsertBeanLabels(labels: Omit<BeanLabelRow, 'created_at'>[]): void {
  localSaveData({ beanLabels: labels });
}

export function localGetBeanLabel(uid: string): BeanLabelRow | null {
  return getAll<BeanLabelRow>(KEYS.beanLabels).find((l) => sameUid(l.uid, uid)) ?? null;
}

export function localListBeanLabelsForBean(beanUid: string): BeanLabelRow[] {
  return getAll<BeanLabelRow>(KEYS.beanLabels)
    .filter((l) => sameUid(l.bean_uid, beanUid))
    .sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime());
}

export function localClearBeanLabels(): void {
  writeStorageAtomically({ [KEYS.beanLabels]: null });
}

// ---------------------------------------------------------------------------
// Migrate local → Supabase
// ---------------------------------------------------------------------------

function withoutOwner<T extends { user_uid: string }>(row: T): Omit<T, 'user_uid'> {
  const { user_uid: _owner, ...writable } = row;
  return writable;
}

function unchangedRows<T extends { uid: string }>(snapshot: T[]): (row: T) => boolean {
  const originals = new Map(snapshot.map((row) => [row.uid.toLowerCase(), JSON.stringify(row)]));
  return (row) => originals.get(row.uid.toLowerCase()) === JSON.stringify(row);
}

function removeMigratedSnapshot(snapshot: LocalData, orphanLabels: BeanLabelRow[]): void {
  const current = localGetAllData();
  validateLocalData(current, { allowOrphanLabels: true });
  const beanIds = new Set(current.beans.map((bean) => bean.uid.toLowerCase()));
  const unchangedOrphan = unchangedRows(orphanLabels);
  const unchangedLabel = unchangedRows(snapshot.beanLabels);
  const unchangedBrew = unchangedRows(snapshot.brews);
  const unchangedParticleSize = unchangedRows(snapshot.particleSizes);
  const remaining: LocalData = {
    beans: [],
    grinders: [],
    brews: current.brews.filter((row) => !unchangedBrew(row)),
    particleSizes: current.particleSizes.filter((row) => !unchangedParticleSize(row)),
    beanLabels: current.beanLabels.filter((row) => !unchangedLabel(row) &&
      !(unchangedOrphan(row) && !beanIds.has(row.bean_uid.toLowerCase()))),
  };

  // Concurrent child additions/edits still need their otherwise unchanged local parents.
  const neededBeans = new Set([...remaining.brews, ...remaining.beanLabels].map((row) => row.bean_uid.toLowerCase()));
  const neededGrinders = new Set([...remaining.brews, ...remaining.particleSizes]
    .flatMap((row) => row.grinder_uid ? [row.grinder_uid.toLowerCase()] : []));
  const unchangedBean = unchangedRows(snapshot.beans);
  const unchangedGrinder = unchangedRows(snapshot.grinders);
  remaining.beans = current.beans.filter((row) => !unchangedBean(row) || neededBeans.has(row.uid.toLowerCase()));
  remaining.grinders = current.grinders.filter((row) => !unchangedGrinder(row) || neededGrinders.has(row.uid.toLowerCase()));
  validateLocalData(remaining);
  writeData(remaining);
}

/** Migrate one validated snapshot in one server transaction; retain concurrent local changes. */
export async function migrateLocalToSupabase(): Promise<{ beans: number; brews: number }> {
  const original = localGetAllData();
  const { snapshot, orphanLabels } = prepareLocalSnapshot(original);
  const counts = { beans: snapshot.beans.length, brews: snapshot.brews.length };
  if (!COLLECTIONS.some((collection) => original[collection].length)) return counts;
  const data: LocalSaveData = {
    beans: snapshot.beans.map(withoutOwner),
    brews: snapshot.brews.map(withoutOwner),
    grinders: snapshot.grinders.map(withoutOwner),
    particleSizes: snapshot.particleSizes.map(withoutOwner),
    beanLabels: snapshot.beanLabels,
  };
  try {
    // Dynamic import keeps Supabase out of the guest-only path.
    const { getSupabaseClient } = await import('../../config/supabase');
    const { error } = await getSupabaseClient().rpc('save_beanlog_data', { p_data: data });
    if (error) throw error;
  } catch (cause) {
    throw new LocalDataError('MIGRATION_FAILED', undefined, cause);
  }
  try {
    removeMigratedSnapshot(snapshot, orphanLabels);
  } catch (cause) {
    // The RPC is idempotent, so cleanup failures can be retried without duplicate inserts.
    throw new LocalDataError('MIGRATION_CLEANUP_FAILED', undefined, cause);
  }
  return counts;
}
