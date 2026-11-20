import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { fetchAllRows } from '../src/logging/utils/pagination';
import { useBeanSuggestions } from '../src/logging/hooks/useBeanSuggestions';
import { useGrinderSuggestions } from '../src/logging/hooks/useGrinderSuggestions';
import { useRecipeSuggestions } from '../src/logging/hooks/useRecipeSuggestions';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../src/config/supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ from }),
}));

describe('fetchAllRows', () => {
  it('advances by actual rows and continues through short pages to an empty page', async () => {
    const records = Array.from({ length: 1001 }, (_, uid) => ({ uid }));
    const range = vi.fn(async (start: number, end: number) => ({
      data: records.slice(start, Math.min(end + 1, start + 137)), error: null,
    }));
    const factory = vi.fn(() => ({ range }));
    expect(await fetchAllRows<{ uid: number }>(factory)).toEqual(records);
    expect(range.mock.calls.map(([start]) => start)).toEqual([0, 137, 274, 411, 548, 685, 822, 959, 1001]);
    expect(factory).toHaveBeenCalledTimes(9);
    expect(range.mock.calls.every(([start, end]) => end - start === 499)).toBe(true);
  });

  it('handles exact page boundaries and an empty dataset', async () => {
    const range = vi.fn()
      .mockResolvedValueOnce({ data: [1, 2], error: null })
      .mockResolvedValue({ data: [], error: null });
    expect(await fetchAllRows(() => ({ range }), 2)).toEqual([1, 2]);
    expect(range).toHaveBeenLastCalledWith(2, 3);
    expect(await fetchAllRows(() => ({ range }), 2)).toEqual([]);
  });

  it('rejects a later page error instead of returning a partial export', async () => {
    const range = vi.fn()
      .mockResolvedValueOnce({ data: [1], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Network failed' } });
    await expect(fetchAllRows(() => ({ range }))).rejects.toThrow('Network failed');
  });

  it.each([0, -1, 1.5, Infinity, NaN])('rejects invalid page size %s without querying', async (size) => {
    const factory = vi.fn();
    await expect(fetchAllRows(factory, size)).rejects.toThrow(RangeError);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('suggestion pagination and refresh', () => {
  let beans: Record<string, string>[];
  let grinders: Record<string, string>[];
  let orders: string[];

  beforeEach(() => {
    beans = [{ roastery: 'First' }, { roastery: 'Last', origin_country: 'Peru', origin_location: 'Cusco', producer: 'Farm' }];
    grinders = [{ maker: 'First', model: 'A' }, { maker: 'Last', model: 'B' }];
    orders = [];
    from.mockImplementation((table: string) => {
      const query = {
        select: () => query,
        order: (column: string) => { orders.push(column); return query; },
        range: async (start: number) => ({
          data: (table === 'beans' ? beans : grinders).slice(start, start + 1), error: null,
        }),
      };
      return query;
    });
  });

  it('includes every bean suggestion, reloads on refreshKey, and clears in guest mode', async () => {
    const { result, rerender } = renderHook(({ uid, key }) => useBeanSuggestions(uid, key), {
      initialProps: { uid: 'user' as string | undefined, key: 0 },
    });
    await waitFor(() => expect(result.current.roasteries).toEqual(['First', 'Last']));
    expect(result.current.producersForLocation('Peru', 'Cusco')).toEqual(['Farm']);
    expect(orders).toEqual(['created_at', 'uid', 'created_at', 'uid', 'created_at', 'uid']);
    beans = [{ roastery: 'Updated' }];
    rerender({ uid: 'user', key: 1 });
    await waitFor(() => expect(result.current.roasteries).toEqual(['Updated']));
    rerender({ uid: undefined, key: 1 });
    expect(result.current.roasteries).toEqual([]);
  });

  it('includes every grinder suggestion and reloads on refreshKey', async () => {
    const { result, rerender } = renderHook(({ key }) => useGrinderSuggestions('user', key), { initialProps: { key: 0 } });
    await waitFor(() => expect(result.current.makers).toEqual(['First', 'Last']));
    expect(result.current.modelsForMaker('Last')).toEqual(['B']);
    grinders = [{ maker: 'Updated', model: 'C' }];
    rerender({ key: 1 });
    await waitFor(() => expect(result.current.makers).toEqual(['Updated']));
  });

  it('includes every recipe and refreshes without retaining stale recipes in guest mode', async () => {
    let recipes = [{ recipe: 'First' }, { recipe: 'Last' }];
    from.mockImplementation(() => {
      const query = {
        select: () => query,
        order: () => query,
        range: async (start: number) => ({ data: recipes.slice(start, start + 1), error: null }),
      };
      return query;
    });
    const { result, rerender } = renderHook(({ uid, key }) => useRecipeSuggestions(uid, key), {
      initialProps: { uid: 'user' as string | undefined, key: 0 },
    });
    await waitFor(() => expect(result.current.recipes).toEqual(['First', 'Last']));
    recipes = [{ recipe: 'Updated' }];
    rerender({ uid: 'user', key: 1 });
    await waitFor(() => expect(result.current.recipes).toEqual(['Updated']));
    rerender({ uid: undefined, key: 1 });
    expect(result.current.recipes).toEqual([]);
  });
});
