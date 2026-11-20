// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeanLabelRow, BeanRow, BrewRow, GrinderParticleSizeRow, GrinderRow } from '../src/logging/types';
import {
  LocalDataError, localBuildBackupPayload, localClearAll, localDeleteBean, localGetAllData,
  localGetBeanLabel, localGetOrCreateGrinder, localHasData, localInsertBean, localInsertBeanLabels, localInsertBrew,
  localInsertParticleSize, localSearchParticleSizes,
  localListBrews, localListBrewsWithBeans, localRestoreFromBackup, localSaveData, localUpdateBean,
  localUpdateBrew, migrateLocalToSupabase, type LocalData, type LocalSaveData,
} from '../src/logging/storage';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../src/config/supabase', () => ({ getSupabaseClient: () => ({ rpc, from }) }));

const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const CREATED = '2026-09-14T10:00:00.000Z';
const LATER = '2026-09-14T12:00:00.000Z';
const keys = {
  beans: 'beanlog.local.beans', brews: 'beanlog.local.brews', grinders: 'beanlog.local.grinders',
  particleSizes: 'beanlog.local.particle_sizes', beanLabels: 'beanlog.local.bean_labels',
} as const;
const collections = Object.keys(keys) as (keyof LocalData)[];

function bean(patch: Partial<BeanRow> = {}): BeanRow {
  return {
    uid: uid(1), user_uid: 'guest', bean_name: 'Coffee', roastery: null, producer: null,
    origin_location: null, origin_country: null, process: null, varietal: null, cup_notes: null,
    cup_flavor_notes: [{ path: ['Fruity', 'Berry', 'Blueberry'], color: '#ab3456' }],
    roasted_on: '2026-09-01', created_at: CREATED, ...patch,
  };
}

function brew(patch: Partial<BrewRow> = {}): BrewRow {
  return {
    uid: uid(2), user_uid: 'guest', bean_uid: uid(1), grinder_uid: uid(3), brew_date: CREATED,
    grinder_setting: null, recipe: null, coffee_dose_g: 18, coffee_yield_g: 40, coffee_tds: null,
    water: null, water_temp_c: 93, grind_median_um: null, rating: 4.5, extraction_note: null,
    taste_note: null, taste_flavor_notes: [{ path: ['Sweet'], color: '#123' }], created_at: CREATED,
    ...patch,
  };
}

function grinder(patch: Partial<GrinderRow> = {}): GrinderRow {
  return { uid: uid(3), user_uid: 'guest', maker: null, model: 'Grinder', created_at: CREATED, ...patch };
}

function particleSize(patch: Partial<GrinderParticleSizeRow> = {}): GrinderParticleSizeRow {
  return {
    uid: uid(4), user_uid: 'guest', grinder_uid: uid(3), grinder_setting: '10',
    particle_median_um: 250, created_at: CREATED, ...patch,
  };
}

function label(patch: Partial<BeanLabelRow> = {}): BeanLabelRow {
  return { uid: uid(5), bean_uid: uid(1), grams: 20, created_at: CREATED, ...patch };
}

function fixture(): LocalData {
  return { beans: [bean()], brews: [brew()], grinders: [grinder()], particleSizes: [particleSize()], beanLabels: [label()] };
}

function empty(): LocalData {
  return { beans: [], brews: [], grinders: [], particleSizes: [], beanLabels: [] };
}

function backup(data: unknown = fixture()) {
  return { version: 1, exported_at: CREATED, data };
}

function storageSnapshot() {
  return Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]));
}

function seedRaw(data: LocalData) {
  for (const collection of collections) localStorage.setItem(keys[collection], JSON.stringify(data[collection]));
}

function failWriteOnce(position: number) {
  const original = Storage.prototype.setItem;
  let writes = 0;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (++writes === position) throw new DOMException('Full', 'QuotaExceededError');
    original.call(this, key, value);
  });
}

function deferRpc() {
  let resolve!: (value: { error: null }) => void;
  rpc.mockReturnValueOnce(new Promise<{ error: null }>((done) => { resolve = done; }));
  return () => resolve({ error: null });
}

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset().mockResolvedValue({ error: null });
  from.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('strict backup validation', () => {
  it('round-trips all collections, nullable values, flavor notes and original timestamps', () => {
    seedRaw(fixture());
    const exported = localBuildBackupPayload();
    expect(exported).toMatchObject({ version: 1, data: fixture() });
    expect(Number.isFinite(Date.parse(exported.exported_at))).toBe(true);
    localClearAll();
    expect(localRestoreFromBackup(exported)).toEqual(fixture());
    expect(localGetAllData()).toEqual(fixture());
  });

  it('exports a restorable snapshot with old orphan labels omitted but raw storage untouched', () => {
    const data = fixture();
    data.beanLabels.push(label({ uid: uid(15), bean_uid: uid(99) }));
    seedRaw(data);
    const before = storageSnapshot();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    const exported = localBuildBackupPayload();
    expect(exported.data).toEqual(fixture());
    expect(storageSnapshot()).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    localClearAll();
    expect(localRestoreFromBackup(JSON.parse(JSON.stringify(exported)))).toEqual(fixture());
    expect(localGetAllData()).toEqual(fixture());
  });

  it.each(['dangling brew', 'dangling grinder', 'malformed orphan', 'duplicate orphan'])('refuses to export %s without modifying local data', (kind) => {
    const data = fixture();
    data.beanLabels.push(label({ uid: uid(15), bean_uid: uid(99) }));
    if (kind === 'dangling brew') data.brews[0].bean_uid = uid(99);
    if (kind === 'dangling grinder') data.particleSizes[0].grinder_uid = uid(99);
    if (kind === 'malformed orphan') data.beanLabels[1].grams = 'wrong' as unknown as number;
    if (kind === 'duplicate orphan') data.beanLabels.push({ ...data.beanLabels[1] });
    seedRaw(data);
    const before = storageSnapshot();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    expect(() => localBuildBackupPayload()).toThrowError(expect.objectContaining({
      code: kind.startsWith('dangling') ? 'INVALID_REFERENCE' :
        kind === 'duplicate orphan' ? 'DUPLICATE_ID' : 'INVALID_DATA',
    }));
    expect(storageSnapshot()).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('accepts only the complete raw legacy snapshot, including optional creation timestamps', () => {
    const data = fixture();
    for (const collection of collections) for (const row of data[collection]) delete row.created_at;
    data.beans[0].cup_flavor_notes = null;
    data.beans[0].roasted_on = null;
    data.brews[0].taste_flavor_notes = null;
    data.brews[0].brew_date = '2024-02-29';
    data.brews[0].grinder_uid = null;
    data.beanLabels[0].grams = null;
    expect(localRestoreFromBackup(data)).toEqual(data);
  });

  const invalidEnvelopes: [string, unknown][] = [
    ['empty object', {}], ['null', null], ['array', []], ['string', 'backup'],
    ['unversioned envelope', { data: fixture() }],
    ['future version', { ...backup(), version: 2 }],
    ['future version with raw collections', { ...fixture(), version: 2 }],
    ['string version', { ...backup(), version: '1' }],
    ['zero version', { ...backup(), version: 0 }],
    ['missing export time', { version: 1, data: fixture() }],
    ['invalid export time', { ...backup(), exported_at: 'yesterday' }],
    ['missing data', { version: 1, exported_at: CREATED, other: fixture() }],
    ['extra envelope field', { ...backup(), surprise: true }],
    ['extra raw field', { ...fixture(), unrelated: true }],
  ];
  it.each(invalidEnvelopes)('rejects %s without touching existing storage', (_, payload) => {
    seedRaw(fixture());
    localStorage.setItem('unrelated', 'preserve');
    const original = storageSnapshot();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    expect(() => localRestoreFromBackup(payload)).toThrow(LocalDataError);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(original);
  });

  it('exposes a stable unsupported-version code', () => {
    expect(() => localRestoreFromBackup({ ...backup(), version: 2 }))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_BACKUP_VERSION' }));
  });

  it.each(collections)('requires the %s array in both raw and versioned backups', (collection) => {
    seedRaw(fixture());
    const before = storageSnapshot();
    const data: Partial<LocalData> = fixture();
    delete data[collection];
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(() => localRestoreFromBackup(data)).toThrow(LocalDataError);
    expect(() => localRestoreFromBackup(backup(data))).toThrow(LocalDataError);
    expect(() => localRestoreFromBackup(backup({ ...data, [collection]: {} }))).toThrow(LocalDataError);
    expect(write).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(before);
  });

  const requiredFields = collections.flatMap((collection) =>
    Object.keys(fixture()[collection][0]).filter((field) => field !== 'created_at')
      .map((field) => [collection, field] as const),
  );
  it.each(requiredFields)('requires even nullable %s.%s fields', (collection, field) => {
    const data = fixture();
    delete (data[collection][0] as Record<string, unknown>)[field];
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(() => localRestoreFromBackup(backup(data))).toThrowError(expect.objectContaining({ code: 'INVALID_DATA' }));
    expect(write).not.toHaveBeenCalled();
  });

  const malformedFields: [keyof LocalData, string, unknown][] = [
    ['beans', 'uid', 'not-a-uuid'], ['beans', 'user_uid', 'someone'], ['beans', 'bean_name', 10],
    ['beans', 'created_at', null], ['beans', 'created_at', '2026-09-14'],
    ['beans', 'roasted_on', '2026-02-29'], ['beans', 'roasted_on', '2026-04-31'],
    ['beans', 'roasted_on', '2026-00-01'], ['beans', 'roasted_on', '2026-01-00'],
    ['beans', 'roasted_on', '2026-13-01'], ['beans', 'roasted_on', CREATED],
    ['brews', 'bean_uid', null], ['brews', 'grinder_uid', ''],
    ['brews', 'brew_date', '2026-02-30T00:00:00.000Z'], ['brews', 'brew_date', '2026-09-14T24:00:00Z'],
    ['brews', 'brew_date', '2026-09-14T10:00:00'], ['brews', 'brew_date', 'not a date'],
    ['brews', 'coffee_dose_g', '18'], ['brews', 'coffee_tds', Number.NaN],
    ['brews', 'coffee_yield_g', Number.POSITIVE_INFINITY], ['brews', 'water_temp_c', Number.NEGATIVE_INFINITY],
    ['brews', 'grind_median_um', {}], ['brews', 'rating', true],
    ['grinders', 'maker', []], ['grinders', 'model', {}],
    ['particleSizes', 'particle_median_um', null], ['particleSizes', 'particle_median_um', Number.NaN],
    ['particleSizes', 'grinder_setting', null], ['particleSizes', 'grinder_uid', null],
    ['beanLabels', 'grams', '20'], ['beanLabels', 'grams', Number.POSITIVE_INFINITY],
  ];
  it.each(malformedFields)('rejects malformed %s.%s (%j)', (collection, field, value) => {
    seedRaw(fixture());
    const before = storageSnapshot();
    const data = fixture();
    (data[collection][0] as Record<string, unknown>)[field] = value;
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(() => localRestoreFromBackup(backup(data))).toThrow(LocalDataError);
    expect(write).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(before);
  });

  it.each([
    {}, [null], [{ path: [], color: '#123456' }], [{ path: ['Fruity', '', 'Berry'], color: '#123456' }],
    [{ path: ['a', 'b', 'c', 'd'], color: '#123456' }], [{ path: [1], color: '#123456' }],
    [{ path: ['Fruity'], color: 'red' }], [{ path: ['Fruity'], color: '#xyzxyz' }],
    [{ path: ['Fruity'] }], [{ path: 'Fruity', color: '#123456' }],
  ])('rejects malformed flavor notes: %j', (notes) => {
    for (const [collection, field] of [['beans', 'cup_flavor_notes'], ['brews', 'taste_flavor_notes']] as const) {
      const data = fixture();
      (data[collection][0] as Record<string, unknown>)[field] = notes;
      expect(() => localRestoreFromBackup(backup(data))).toThrow(LocalDataError);
    }
    expect(localStorage.length).toBe(0);
  });

  it.each(collections)('rejects null rows, unknown fields and duplicate IDs in %s', (collection) => {
    const data = fixture();
    const first = data[collection][0];
    for (const rows of [[null], [{ ...first, unexpected: 1 }], [first, { ...first }]]) {
      expect(() => localRestoreFromBackup(backup({ ...data, [collection]: rows }))).toThrow(LocalDataError);
    }
    expect(localStorage.length).toBe(0);
  });

  it('detects duplicate UUIDs even with different casing', () => {
    const data = fixture();
    data.beans.push(bean({ uid: uid(0xab) }), bean({ uid: uid(0xab).toUpperCase() }));
    expect(() => localRestoreFromBackup(data)).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
  });

  it.each([
    ['brews', 'bean_uid'], ['brews', 'grinder_uid'], ['particleSizes', 'grinder_uid'], ['beanLabels', 'bean_uid'],
  ] as const)('rejects dangling %s.%s without pruning a backup', (collection, field) => {
    const data = fixture();
    (data[collection][0] as Record<string, unknown>)[field] = uid(99);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(() => localRestoreFromBackup(data)).toThrowError(expect.objectContaining({ code: 'INVALID_REFERENCE' }));
    expect(write).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 4, 5])('rolls back every collection when restore write %i fails', (position) => {
    seedRaw(fixture());
    localStorage.setItem('beanlog.guest.active', 'true');
    const before = storageSnapshot();
    failWriteOnce(position);
    expect(() => localRestoreFromBackup(backup(empty())))
      .toThrowError(expect.objectContaining({ code: 'STORAGE_WRITE_FAILED' }));
    expect(storageSnapshot()).toEqual(before);
  });

  it('reclaims quota before restoring a previous larger value during rollback', () => {
    const originalData = fixture();
    originalData.beans[0].bean_name = 'b'.repeat(1000);
    seedRaw(originalData);
    const before = storageSnapshot();
    const limit = Object.values(before).reduce((sum, value) => sum + value!.length, 0);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      const used = Object.values(storageSnapshot()).reduce((sum, item) => sum + item!.length, 0);
      if (used - (localStorage.getItem(key)?.length ?? 0) + value.length > limit) {
        throw new DOMException('Full', 'QuotaExceededError');
      }
      original.call(this, key, value);
    });
    const next = fixture();
    next.brews[0].recipe = 'r'.repeat(1000);
    next.grinders[0].maker = 'g'.repeat(2000);
    expect(() => localRestoreFromBackup(next)).toThrowError(expect.objectContaining({ code: 'STORAGE_WRITE_FAILED' }));
    expect(storageSnapshot()).toEqual(before);
  });
});

describe('atomic local saves and guest CRUD', () => {
  it('upserts a complete graph atomically, assigns guest owners and preserves creation times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(LATER);
    const data = fixture();
    for (const collection of collections) {
      for (const row of data[collection]) {
        delete row.created_at;
        if ('user_uid' in row) row.user_uid = uid(90);
      }
    }
    localSaveData(data);
    const initial = localGetAllData();
    for (const collection of collections) {
      expect(initial[collection][0].created_at).toBe(LATER);
      if (collection !== 'beanLabels') expect(initial[collection][0]).toHaveProperty('user_uid', 'guest');
    }
    expect(initial.beanLabels[0]).not.toHaveProperty('user_uid');
    localSaveData({ beans: [bean({ bean_name: 'Changed', created_at: CREATED })] });
    const saved = localGetAllData();
    expect(saved.beans).toHaveLength(1);
    expect(saved.beans[0]).toMatchObject({ bean_name: 'Changed', created_at: LATER, user_uid: 'guest' });
    expect(saved.brews).toEqual(initial.brews);
    expect(saved.grinders).toEqual(initial.grinders);
  });

  it('preserves supplied historical creation times on new full writable rows', () => {
    localSaveData(fixture());
    expect(localGetAllData()).toEqual(fixture());
    localSaveData(fixture());
    expect(localGetAllData()).toEqual(fixture());
  });

  it('does not touch omitted or empty collections', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    localSaveData({});
    localSaveData({ beans: [] });
    expect(write).not.toHaveBeenCalled();
    localSaveData({ beans: [bean()] });
    expect(Object.keys(localStorage)).toEqual([keys.beans]);
  });

  it('rejects field patches, duplicate inputs and dangling references before any write', () => {
    seedRaw(fixture());
    const before = storageSnapshot();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    for (const data of [
      { beans: [{ uid: uid(1), bean_name: 'Partial' }] },
      { beans: [bean(), bean()] }, { beans: null }, { unknown: [] },
      { brews: [brew({ bean_uid: uid(99) })] },
      { brews: [brew({ grinder_uid: uid(99) })] },
      { particleSizes: [particleSize({ grinder_uid: uid(99) })] },
      { beanLabels: [label({ bean_uid: uid(99) })] },
    ]) {
      expect(() => localSaveData(data as LocalSaveData)).toThrow(LocalDataError);
    }
    expect(write).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(before);
  });

  it.each([
    { beans: [bean({ bean_name: 'Updated' })] },
    { brews: [brew({ uid: uid(12) })] },
    { grinders: [grinder({ uid: uid(13) })] },
    { particleSizes: [particleSize({ uid: uid(14) })] },
  ])('repairs old orphan labels as part of ordinary guest saves: %j', (input) => {
    const data = fixture();
    data.beanLabels.push(label({ uid: uid(15), bean_uid: uid(99) }));
    seedRaw(data);
    localSaveData(input);
    expect(localGetAllData().beanLabels).toEqual([label()]);
    for (const collection of collections) {
      for (const row of (input as LocalSaveData)[collection] ?? []) {
        expect(localGetAllData()[collection]).toContainEqual(expect.objectContaining(row));
      }
    }
  });

  it('preserves an old orphan label when the same save restores its missing parent', () => {
    const data = fixture();
    const orphan = label({ uid: uid(15), bean_uid: uid(99) });
    data.beanLabels.push(orphan);
    seedRaw(data);
    localSaveData({ beans: [bean({ uid: uid(99) })] });
    expect(localGetAllData().beanLabels).toEqual([label(), orphan]);
  });

  it('allows a previously orphaned label to be explicitly repaired', () => {
    const data = fixture();
    data.beanLabels.push(label({ uid: uid(15), bean_uid: uid(99) }));
    seedRaw(data);
    localSaveData({ beanLabels: [label({ uid: uid(15), bean_uid: uid(1) })] });
    expect(localGetAllData().beanLabels).toEqual([label(), label({ uid: uid(15) })]);
  });

  it.each([15, 16])('rejects incoming orphan labels rather than pruning them (uid %i)', (id) => {
    const data = fixture();
    data.beanLabels.push(label({ uid: uid(15), bean_uid: uid(99) }));
    seedRaw(data);
    const before = storageSnapshot();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(() => localSaveData({ beanLabels: [label({ uid: uid(id), bean_uid: uid(99) })] }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_REFERENCE' }));
    expect(write).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(before);
  });

  it.each(['dangling brew', 'dangling calibration', 'malformed orphan', 'duplicate orphan'])('does not mask %s during guest-save repair', (kind) => {
    const data = fixture();
    data.beanLabels.push(label({ uid: uid(15), bean_uid: uid(99) }));
    if (kind === 'dangling brew') data.brews[0].bean_uid = uid(99);
    if (kind === 'dangling calibration') data.particleSizes[0].grinder_uid = uid(99);
    if (kind === 'malformed orphan') data.beanLabels[1].grams = 'wrong' as unknown as number;
    if (kind === 'duplicate orphan') data.beanLabels.push({ ...data.beanLabels[1] });
    seedRaw(data);
    const before = storageSnapshot();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(() => localSaveData({ beans: [bean({ bean_name: 'Updated' })] })).toThrow(LocalDataError);
    expect(write).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(before);
  });

  it.each([1, 2, 3, 4, 5])('restores the original orphan labels and all rows if repair write %i fails', (position) => {
    const data = fixture();
    data.beanLabels.push(label({ uid: uid(15), bean_uid: uid(99) }));
    seedRaw(data);
    const before = storageSnapshot();
    failWriteOnce(position);
    expect(() => localSaveData({
      beans: [bean({ bean_name: 'Changed' })], brews: [brew({ recipe: 'Changed' })],
      grinders: [grinder({ model: 'Changed' })], particleSizes: [particleSize({ particle_median_um: 999 })],
    })).toThrowError(expect.objectContaining({ code: 'STORAGE_WRITE_FAILED' }));
    expect(storageSnapshot()).toEqual(before);
  });

  it('does not repair an orphan label imported by backup restore', () => {
    const data = fixture();
    data.beanLabels.push(label({ uid: uid(15), bean_uid: uid(99) }));
    seedRaw(data);
    const before = storageSnapshot();
    expect(() => localRestoreFromBackup(backup(data))).toThrowError(expect.objectContaining({ code: 'INVALID_REFERENCE' }));
    expect(storageSnapshot()).toEqual(before);
    localSaveData({ beans: [bean({ bean_name: 'Updated' })] });
    expect(localGetAllData().beanLabels).toEqual([label()]);
  });

  it.each([1, 2, 3, 4, 5])('restores missing keys after a new save fails at write %i', (position) => {
    localStorage.setItem('preference', 'keep');
    const before = storageSnapshot();
    failWriteOnce(position);
    expect(() => localSaveData(fixture())).toThrowError(expect.objectContaining({ code: 'STORAGE_WRITE_FAILED' }));
    expect(storageSnapshot()).toEqual(before);
  });

  it('rolls back updates to existing rows as well as new rows', () => {
    localSaveData({ beans: [bean()], grinders: [grinder()] });
    const before = storageSnapshot();
    failWriteOnce(2);
    expect(() => localSaveData({ beans: [bean({ bean_name: 'Changed' })], brews: [brew()] })).toThrow(LocalDataError);
    expect(storageSnapshot()).toEqual(before);
  });

  it('surfaces storage rollback failure instead of reporting a successful rollback', () => {
    seedRaw(fixture());
    const original = Storage.prototype.setItem;
    let writes = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (++writes > 1) throw new DOMException('Denied', 'SecurityError');
      original.call(this, key, value);
    });
    expect(() => localRestoreFromBackup(empty())).toThrowError(expect.objectContaining({ code: 'STORAGE_ROLLBACK_FAILED' }));
  });

  it('does not overwrite malformed existing storage', () => {
    localStorage.setItem(keys.beans, '{broken');
    const before = storageSnapshot();
    expect(() => localSaveData({ beans: [bean()] })).toThrowError(expect.objectContaining({ code: 'INVALID_DATA' }));
    expect(storageSnapshot()).toEqual(before);
    localStorage.setItem(keys.beans, '{}');
    expect(() => localSaveData({ beans: [bean()] })).toThrow(LocalDataError);
  });

  it('reports storage read failures without attempting writes', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(() => localSaveData({ beans: [bean()] })).toThrowError(expect.objectContaining({ code: 'STORAGE_READ_FAILED' }));
    expect(write).not.toHaveBeenCalled();
  });

  it('cascade-deletes only the selected bean, its brews and its labels', () => {
    const data = fixture();
    data.beans.push(bean({ uid: uid(10) }));
    data.brews.push(brew({ uid: uid(11), bean_uid: uid(10) }));
    data.beanLabels.push(label({ uid: uid(12), bean_uid: uid(10) }));
    localSaveData(data);
    localDeleteBean(uid(1));
    const remaining = localGetAllData();
    expect(remaining.beans.map((row) => row.uid)).toEqual([uid(10)]);
    expect(remaining.brews.map((row) => row.uid)).toEqual([uid(11)]);
    expect(remaining.beanLabels.map((row) => row.uid)).toEqual([uid(12)]);
    expect(remaining.grinders).toEqual(data.grinders);
    expect(remaining.particleSizes).toEqual(data.particleSizes);
    expect(localGetBeanLabel(uid(5))).toBeNull();
  });

  it.each([1, 2, 3])('rolls back a bean cascade when write %i fails', (position) => {
    seedRaw(fixture());
    const before = storageSnapshot();
    failWriteOnce(position);
    expect(() => localDeleteBean(uid(1))).toThrow(LocalDataError);
    expect(storageSnapshot()).toEqual(before);
  });

  it('keeps creation times and row identities through the existing insert/update APIs', () => {
    localInsertBean(bean());
    localInsertBrew(brew({ grinder_uid: null }));
    localInsertBeanLabels([label()]);
    const created = localGetAllData().beans[0].created_at;
    localUpdateBean(uid(1), { uid: uid(90), user_uid: uid(90), created_at: LATER, bean_name: 'Edit' });
    localUpdateBrew(uid(2), { uid: uid(90), user_uid: uid(90), created_at: LATER, recipe: 'Edit' });
    expect(localGetAllData().beans[0]).toMatchObject({ uid: uid(1), user_uid: 'guest', created_at: created, bean_name: 'Edit' });
    expect(localGetAllData().brews[0]).toMatchObject({ uid: uid(2), user_uid: 'guest', recipe: 'Edit' });
  });

  it('orders brews by date, creation time, then reverse insertion order, without reordering storage', () => {
    const data = fixture();
    data.brews = [
      brew({ uid: uid(20), brew_date: '2026-09-13', created_at: LATER }),
      brew({ uid: uid(21), created_at: CREATED }),
      brew({ uid: uid(22), created_at: LATER }),
      brew({ uid: uid(23), created_at: LATER }),
      brew({ uid: uid(24), brew_date: '2026-09-15', created_at: CREATED }),
    ];
    seedRaw(data);
    const before = storageSnapshot();
    const expected = [24, 23, 22, 21, 20].map(uid);
    expect(localListBrews().map((row) => row.uid)).toEqual(expected);
    expect(localListBrewsWithBeans().map((row) => row.uid)).toEqual(expected);
    expect(storageSnapshot()).toEqual(before);
    localUpdateBrew(uid(22), { recipe: 'Updated recipe' });
    expect(localListBrews().map((row) => row.uid)).toEqual(expected);
  });

  it('uses reverse insertion order when legacy brews lack creation times', () => {
    const data = fixture();
    data.brews = [brew({ uid: uid(20) }), brew({ uid: uid(21) })];
    for (const row of data.brews) delete row.created_at;
    seedRaw(data);
    expect(localListBrews().map((row) => row.uid)).toEqual([uid(21), uid(20)]);
  });

  it('detects grinder-only and calibration-only guest data', () => {
    expect(localHasData()).toBe(false);
    localSaveData({ grinders: [grinder()] });
    expect(localHasData()).toBe(true);
    localStorage.clear();
    localStorage.setItem(keys.particleSizes, JSON.stringify([particleSize()]));
    expect(localHasData()).toBe(true);
  });

  it('keeps the existing calibration APIs compatible with validated saves', () => {
    const grinderUid = localGetOrCreateGrinder('Maker', 'Model');
    expect(localGetOrCreateGrinder('maker', 'MODEL')).toBe(grinderUid);
    localInsertParticleSize(particleSize({ grinder_uid: grinderUid }));
    expect(localGetAllData().grinders).toHaveLength(1);
    expect(localSearchParticleSizes(grinderUid)).toEqual([{ grinder_setting: '10', particle_median_um: 250 }]);
    expect(localSearchParticleSizes(uid(99))).toEqual([]);
  });

  it('rolls back a partially failed clear and leaves session/preferences alone', () => {
    seedRaw(fixture());
    localStorage.setItem('beanlog.guest.active', 'true');
    const before = storageSnapshot();
    const original = Storage.prototype.removeItem;
    let calls = 0;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (++calls === 3) throw new Error('Storage unavailable');
      original.call(this, key);
    });
    expect(() => localClearAll()).toThrow(LocalDataError);
    expect(storageSnapshot()).toEqual(before);
  });
});

describe('single-transaction guest migration', () => {
  it('sends one RPC with all collections, no guest owners and original creation times', async () => {
    seedRaw(fixture());
    localStorage.setItem('beanlog.guest.active', 'true');
    localStorage.setItem('unrelated', 'keep');
    await expect(migrateLocalToSupabase()).resolves.toEqual({ beans: 1, brews: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
    const [name, { p_data }] = rpc.mock.calls[0];
    expect(name).toBe('save_beanlog_data');
    expect(Object.keys(p_data).sort()).toEqual([...collections].sort());
    for (const collection of collections) {
      expect(p_data[collection]).toHaveLength(1);
      expect(p_data[collection][0].created_at).toBe(CREATED);
      expect(p_data[collection][0]).not.toHaveProperty('user_uid');
    }
    expect(p_data.beans[0].cup_flavor_notes).toEqual(bean().cup_flavor_notes);
    expect(p_data.brews[0].taste_flavor_notes).toEqual(brew().taste_flavor_notes);
    expect(localGetAllData()).toEqual(empty());
    expect(localStorage.getItem('beanlog.guest.active')).toBe('true');
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('keeps every local record on RPC error and permits retry with the same IDs', async () => {
    seedRaw(fixture());
    const before = storageSnapshot();
    const cause = { code: 'XX000', message: 'Transient failure' };
    rpc.mockResolvedValueOnce({ error: cause });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await expect(migrateLocalToSupabase()).rejects.toMatchObject({ code: 'MIGRATION_FAILED', cause });
    expect(write).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(before);
    await migrateLocalToSupabase();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(localHasData()).toBe(false);
  });

  it('retains data when the RPC promise rejects', async () => {
    seedRaw(fixture());
    const before = storageSnapshot();
    rpc.mockRejectedValueOnce(new Error('Offline'));
    await expect(migrateLocalToSupabase()).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
    expect(storageSnapshot()).toEqual(before);
  });

  it('performs no local writes until the RPC confirms success', async () => {
    seedRaw(fixture());
    const before = storageSnapshot();
    const finish = deferRpc();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const migration = migrateLocalToSupabase();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(write).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(before);
    finish();
    await migration;
    expect(localHasData()).toBe(false);
  });

  it('retains concurrent additions/edits in every collection and their referenced parents', async () => {
    seedRaw(fixture());
    const finish = deferRpc();
    const migration = migrateLocalToSupabase();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    localSaveData({
      beans: [bean({ bean_name: 'Concurrent edit' }), bean({ uid: uid(11) })],
      brews: [brew({ recipe: 'Concurrent edit' }), brew({ uid: uid(12), bean_uid: uid(11) })],
      grinders: [grinder({ model: 'Concurrent edit' }), grinder({ uid: uid(13) })],
      particleSizes: [particleSize({ particle_median_um: 500 }), particleSize({ uid: uid(14), grinder_uid: uid(13) })],
      beanLabels: [label({ grams: 30 }), label({ uid: uid(15), bean_uid: uid(11) })],
    });
    const concurrent = localGetAllData();
    finish();
    await migration;
    expect(localGetAllData()).toEqual(concurrent);
    expect(rpc.mock.calls[0][1].p_data.beans[0].bean_name).toBe('Coffee');
    expect(rpc.mock.calls[0][1].p_data.brews[0].recipe).toBeNull();
  });

  it('keeps unchanged parents needed by newly added brews, labels and calibration records', async () => {
    seedRaw(fixture());
    const finish = deferRpc();
    const migration = migrateLocalToSupabase();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    localSaveData({
      brews: [brew({ uid: uid(12) })], beanLabels: [label({ uid: uid(15) })],
      particleSizes: [particleSize({ uid: uid(14) })],
    });
    finish();
    await migration;
    const remaining = localGetAllData();
    expect(remaining.beans).toEqual([bean()]);
    expect(remaining.grinders).toEqual([grinder()]);
    expect(remaining.brews.map((row) => row.uid)).toEqual([uid(12)]);
    expect(remaining.beanLabels.map((row) => row.uid)).toEqual([uid(15)]);
    expect(remaining.particleSizes.map((row) => row.uid)).toEqual([uid(14)]);
    await migrateLocalToSupabase();
    expect(localHasData()).toBe(false);
  });

  it('does not resurrect records deleted while migration is pending', async () => {
    seedRaw(fixture());
    const finish = deferRpc();
    const migration = migrateLocalToSupabase();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    localDeleteBean(uid(1));
    localSaveData({ beans: [bean({ uid: uid(11) })] });
    finish();
    await migration;
    expect(localGetAllData()).toEqual({ ...empty(), beans: [bean({ uid: uid(11) })] });
  });

  it('omits and safely prunes only valid orphan labels from the old bean-delete defect', async () => {
    const data = fixture();
    data.beanLabels.push(label({ uid: uid(15), bean_uid: uid(99) }));
    seedRaw(data);
    await migrateLocalToSupabase();
    expect(rpc.mock.calls[0][1].p_data.beanLabels).toEqual([label()]);
    expect(localHasData()).toBe(false);
  });

  it('does not prune old orphan labels on migration failure', async () => {
    const data = fixture();
    data.beanLabels.push(label({ uid: uid(15), bean_uid: uid(99) }));
    seedRaw(data);
    const before = storageSnapshot();
    rpc.mockResolvedValueOnce({ error: { message: 'Retry' } });
    await expect(migrateLocalToSupabase()).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
    expect(storageSnapshot()).toEqual(before);
  });

  it('keeps an omitted orphan label whose parent was restored concurrently', async () => {
    const data = fixture();
    const orphan = label({ uid: uid(15), bean_uid: uid(99) });
    data.beanLabels.push(orphan);
    seedRaw(data);
    const finish = deferRpc();
    const migration = migrateLocalToSupabase();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    localStorage.setItem(keys.beans, JSON.stringify([...data.beans, bean({ uid: uid(99) })]));
    finish();
    await migration;
    expect(localGetAllData()).toEqual({ ...empty(), beans: [bean({ uid: uid(99) })], beanLabels: [orphan] });
  });

  it.each(['dangling brew', 'dangling calibration', 'malformed orphan', 'duplicate label'])('does not hide %s behind orphan cleanup', async (kind) => {
    const data = fixture();
    data.beanLabels.push(label({ uid: uid(15), bean_uid: uid(99) }));
    if (kind === 'dangling brew') data.brews[0].bean_uid = uid(99);
    if (kind === 'dangling calibration') data.particleSizes[0].grinder_uid = uid(99);
    if (kind === 'malformed orphan') data.beanLabels[1].grams = 'wrong' as unknown as number;
    if (kind === 'duplicate label') data.beanLabels.push(label());
    seedRaw(data);
    const before = storageSnapshot();
    await expect(migrateLocalToSupabase()).rejects.toBeInstanceOf(LocalDataError);
    expect(rpc).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(before);
  });

  it('leaves concurrently corrupted data untouched and reports cleanup failure after server success', async () => {
    seedRaw(fixture());
    const finish = deferRpc();
    const migration = migrateLocalToSupabase();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    localStorage.setItem(keys.beanLabels, JSON.stringify([label({ bean_uid: uid(99) })]));
    const before = storageSnapshot();
    finish();
    await expect(migration).rejects.toMatchObject({ code: 'MIGRATION_CLEANUP_FAILED' });
    expect(storageSnapshot()).toEqual(before);
  });

  it('rolls back partial cleanup after confirmed migration and can retry', async () => {
    seedRaw(fixture());
    const before = storageSnapshot();
    failWriteOnce(3);
    await expect(migrateLocalToSupabase()).rejects.toMatchObject({
      code: 'MIGRATION_CLEANUP_FAILED', cause: expect.objectContaining({ code: 'STORAGE_WRITE_FAILED' }),
    });
    expect(storageSnapshot()).toEqual(before);
    await migrateLocalToSupabase();
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(localHasData()).toBe(false);
  });

  it('migrates calibration-only data and handles an entirely empty store without an RPC', async () => {
    await expect(migrateLocalToSupabase()).resolves.toEqual({ beans: 0, brews: 0 });
    expect(rpc).not.toHaveBeenCalled();
    localSaveData({ grinders: [grinder()], particleSizes: [particleSize()] });
    await expect(migrateLocalToSupabase()).resolves.toEqual({ beans: 0, brews: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_data.particleSizes).toHaveLength(1);
    expect(localHasData()).toBe(false);
  });
});
