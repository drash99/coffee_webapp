import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareGrinder } from '../src/logging/utils/grinder';
import { localGetAllData, localGetOrCreateGrinder } from '../src/logging/storage/localDb';

const mocks = vi.hoisted(() => ({ ilike: vi.fn(), maybeSingle: vi.fn() }));
vi.mock('../src/config/supabase', () => ({
  getSupabaseClient: () => ({ from: () => {
    const query = {
      select: () => query,
      ilike: (field: string, value: string) => { mocks.ilike(field, value); return query; },
      order: () => query, limit: () => query, maybeSingle: mocks.maybeSingle,
    };
    return query;
  } }),
}));

beforeEach(() => {
  mocks.ilike.mockClear();
  mocks.maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
});

describe('grinder preparation', () => {
  it('reuses a pending grinder while a previous transaction may still be in flight', async () => {
    const pending = { uid: crypto.randomUUID(), maker: 'Example', model: 'Model' };
    expect(await prepareGrinder(' example ', 'MODEL', false, pending)).toBe(pending);
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
    const changed = await prepareGrinder('Example', 'Different model', false, pending);
    expect(changed.uid).not.toBe(pending.uid);
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('prepares new guest grinders without persisting side effects', async () => {
    const prepared = await prepareGrinder(' Example ', ' Model ', true);
    expect(prepared).toMatchObject({ maker: 'Example', model: 'Model' });
    expect(prepared.uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(localGetAllData().grinders).toEqual([]);
  });

  it('reuses guest grinders case-insensitively without changing their names', async () => {
    const uid = localGetOrCreateGrinder('Example', 'Model');
    expect(await prepareGrinder(' example ', 'MODEL', true)).toEqual({ uid, maker: 'Example', model: 'Model' });
    expect(localGetAllData().grinders).toHaveLength(1);
  });

  it('escapes wildcard characters when looking up a cloud grinder', async () => {
    await prepareGrinder('Maker_%', 'Model\\name', false);
    expect(mocks.ilike.mock.calls).toEqual([['maker', 'Maker\\_\\%'], ['model', 'Model\\\\name']]);
  });

  it('fails lookup before any enclosing save rather than creating a new grinder', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Lookup unavailable' } });
    await expect(prepareGrinder('Example', 'Model', false)).rejects.toThrow('Lookup unavailable');
  });
});
