import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HistoryPage } from '../src/logging/pages/HistoryPage';
import { BeanHistoryPage } from '../src/logging/pages/BeanHistoryPage';
import type { BeanRow, BrewRow } from '../src/logging/types';
import type { AiGuidance } from '../src/logging/ai/customServerClient';

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), guidance: vi.fn(), cache: vi.fn(),
  shareLookup: vi.fn(), shareUpsert: vi.fn(), clipboard: vi.fn(),
  t: (key: string) => key,
}));
vi.mock('../src/config/supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock('../src/i18n/I18nProvider', () => ({ useI18n: () => ({ t: mocks.t, lang: 'en-us' }) }));
vi.mock('../src/platform', () => ({ getPlatform: () => 'ios', canPrintBrotherLabels: () => false }));
vi.mock('../src/logging/ai/customServerClient', () => ({ requestBrewGuidance: mocks.guidance }));
vi.mock('../src/logging/ai/cache', () => ({
  buildAiGuidanceSignature: () => 'signature', getCachedBrewGuidance: () => null, setCachedBrewGuidance: mocks.cache,
}));

const user = { uid: '10000000-0000-4000-8000-000000000001', id: 'test@example.com' };
const beanA = '20000000-0000-4000-8000-000000000001';
const beanB = '20000000-0000-4000-8000-000000000002';
const brewA = '30000000-0000-4000-8000-000000000001';
const brewB = '30000000-0000-4000-8000-000000000002';
const notes = [{ path: ['Fruity', 'Berry'], color: '#ff0000' }];

function bean(uid: string, name: string): BeanRow {
  return {
    uid, user_uid: user.uid, bean_name: name, roastery: `Roaster ${name}`, producer: null,
    origin_location: null, origin_country: null, process: null, varietal: null,
    cup_notes: null, cup_flavor_notes: notes, roasted_on: '2026-09-14', created_at: '2026-09-14T12:00:00Z',
  };
}

function brew(uid: string, beanUid: string, recipe: string): BrewRow {
  return {
    uid, user_uid: user.uid, bean_uid: beanUid, brew_date: '2026-09-14T00:00:00Z',
    grinder_uid: null, grinder_setting: null, recipe, coffee_dose_g: 15, coffee_yield_g: 250,
    coffee_tds: null, water: null, water_temp_c: 93, grind_median_um: null,
    rating: 4, extraction_note: null, taste_note: null, taste_flavor_notes: notes,
    created_at: uid === brewA ? '2026-09-14T13:00:00Z' : '2026-09-14T12:00:00Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let beans: BeanRow[];
let brews: BrewRow[];
let orders: Array<{ table: string; column: string }>;

beforeEach(() => {
  vi.clearAllMocks();
  beans = [bean(beanA, 'Alpha'), bean(beanB, 'Beta')];
  brews = [brew(brewA, beanA, 'Recipe Alpha'), brew(brewB, beanB, 'Recipe Beta')];
  orders = [];
  mocks.clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.clipboard } });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.shareLookup.mockResolvedValue({ data: { share_token: 'current-token', revoked_at: null }, error: null });
  mocks.shareUpsert.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      order: (column: string) => { orders.push({ table, column }); return query; },
      eq: () => query,
      ilike: () => query,
      limit: () => query,
      maybeSingle: () => table === 'brew_shares' ? mocks.shareLookup() : Promise.resolve({ data: null, error: null }),
      upsert: mocks.shareUpsert,
      range: async (start: number) => ({
        data: (table === 'beans' ? beans : table === 'brews' ? brews.map(row => ({
          ...row, beans: beans.find(b => b.uid === row.bean_uid), grinders: null,
        })) : []).slice(start, start + 1),
        error: null,
      }),
    };
    return query;
  });
});

function seedGuest() {
  localStorage.setItem('beanlog.local.beans', JSON.stringify(beans));
  localStorage.setItem('beanlog.local.brews', JSON.stringify(brews));
}

describe('visible history selection', () => {
  it('selects the filtered brew initially, edits that brew, and clears details on an empty filter', async () => {
    seedGuest();
    const { rerender } = render(<HistoryPage user={user} isGuest beanUidFilter={beanB} />);
    expect(await screen.findByText('Recipe Beta')).toBeTruthy();
    expect(screen.queryByText('Recipe Alpha')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'history.edit.start' }));
    expect(screen.getByDisplayValue('Recipe Beta')).toBeTruthy();
    rerender(<HistoryPage user={user} isGuest beanUidFilter={beanA} />);
    expect(screen.queryByDisplayValue('Recipe Beta')).toBeNull();
    expect(screen.getByText('Recipe Alpha')).toBeTruthy();
    rerender(<HistoryPage user={user} isGuest beanUidFilter="missing" />);
    expect(screen.getByText('history.selectPrompt')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'history.delete.button' })).toBeNull();
  });

  it('reconciles field filters and deletes only the visible selection', async () => {
    seedGuest();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<HistoryPage user={user} isGuest />);
    await screen.findByText('Recipe Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'history.filter.button' }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Roaster Beta' } });
    expect(screen.getByText('Recipe Beta')).toBeTruthy();
    expect(screen.queryByText('Recipe Alpha')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'history.delete.button' })); });
    expect(JSON.parse(localStorage.getItem('beanlog.local.brews')!).map((row: BrewRow) => row.uid)).toEqual([brewA]);
    expect(screen.getByText('history.selectPrompt')).toBeTruthy();
  });
});

describe('unreadable guest storage', () => {
  it.each(['{broken', '[null]'])('does not crash guest grinder suggestions on %s', async (raw) => {
    seedGuest();
    localStorage.setItem('beanlog.local.grinders', raw);
    render(<HistoryPage user={user} isGuest />);
    expect(await screen.findByText('storage.error.invalidData')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'history.refresh' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'history.exportJson' }) as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.getItem('beanlog.local.grinders')).toBe(raw);
    expect(mocks.clipboard).not.toHaveBeenCalled();
  });

  it.each(['{broken', '[null]'])('does not crash guest bean suggestions on %s', async (raw) => {
    localStorage.setItem('beanlog.local.beans', raw);
    render(<BeanHistoryPage user={user} isGuest />);
    expect(await screen.findByText('storage.error.invalidData')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'beanHistory.refresh' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'beanHistory.exportJson' }) as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.getItem('beanlog.local.beans')).toBe(raw);
    expect(mocks.clipboard).not.toHaveBeenCalled();
  });

  it.each([HistoryPage, BeanHistoryPage])('shows existing load errors instead of crashing %s on denied storage', async (Page) => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    render(<Page user={user} isGuest />);
    expect(await screen.findByText('storage.error.readFailed')).toBeTruthy();
    expect(mocks.clipboard).not.toHaveBeenCalled();
  });
});

describe('selection-scoped requests', () => {
  it('ignores A guidance after A -> B -> A, including its final busy-state update', async () => {
    const old = deferred<AiGuidance>();
    const latest = deferred<AiGuidance>();
    mocks.guidance.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    render(<HistoryPage user={user} />);
    await screen.findByText('Recipe Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'history.ai.button' }));
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }));
    expect((screen.getByRole('button', { name: 'history.ai.button' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: 'history.ai.button' }));
    await act(async () => { old.resolve({ summary: 'Stale Alpha guidance', diagnosis: '', suggestions: [] }); });
    expect(screen.queryByText('Stale Alpha guidance')).toBeNull();
    expect((screen.getByRole('button', { name: 'history.ai.loading' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.cache).not.toHaveBeenCalled();
    await act(async () => { latest.resolve({ summary: 'Current guidance', diagnosis: '', suggestions: [] }); });
    expect(screen.getByText('Current guidance')).toBeTruthy();
  });

  it('ignores stale AI errors after the selection is filtered out', async () => {
    const pending = deferred<AiGuidance>();
    mocks.guidance.mockReturnValueOnce(pending.promise);
    const { rerender } = render(<HistoryPage user={user} />);
    await screen.findByText('Recipe Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'history.ai.button' }));
    rerender(<HistoryPage user={user} beanUidFilter={beanB} />);
    await act(async () => { pending.reject(new Error('Stale AI failure')); });
    expect(screen.queryByText('history.ai.error')).toBeNull();
    expect(screen.getByText('Recipe Beta')).toBeTruthy();
  });

  it('does not create or copy a share after changing selection during lookup', async () => {
    const pending = deferred<{ data: null; error: null }>();
    mocks.shareLookup.mockReturnValueOnce(pending.promise);
    render(<HistoryPage user={user} />);
    await screen.findByText('Recipe Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'history.share.button' }));
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }));
    await act(async () => { pending.resolve({ data: null, error: null }); });
    expect(mocks.shareUpsert).not.toHaveBeenCalled();
    expect(mocks.clipboard).not.toHaveBeenCalled();
    expect(screen.queryByText(/history.share.linkLabel/)).toBeNull();
    expect((screen.getByRole('button', { name: 'history.share.button' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ignores share creation completion for a previous selection', async () => {
    const pending = deferred<{ error: null }>();
    mocks.shareLookup.mockResolvedValueOnce({ data: null, error: null });
    mocks.shareUpsert.mockReturnValueOnce(pending.promise);
    render(<HistoryPage user={user} />);
    await screen.findByText('Recipe Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'history.share.button' }));
    await waitFor(() => expect(mocks.shareUpsert).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }));
    await act(async () => { pending.resolve({ error: null }); });
    expect(mocks.clipboard).not.toHaveBeenCalled();
    expect(screen.queryByText(/history.share.linkLabel/)).toBeNull();
  });
});

describe('full history exports and atomic edits', () => {
  it('exports all capped brew pages with stable ordering and matching total_count', async () => {
    render(<HistoryPage user={user} />);
    await screen.findByText('Recipe Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'history.exportJson' }));
    const payload = JSON.parse(mocks.clipboard.mock.calls[0][0]);
    expect(payload.count).toBe(2);
    expect(payload.total_count).toBe(2);
    expect(payload.brews.map((row: BrewRow) => row.uid)).toEqual([brewA, brewB]);
    expect(orders.filter(item => item.table === 'brews').map(item => item.column))
      .toEqual(['brew_date', 'created_at', 'uid', 'brew_date', 'created_at', 'uid', 'brew_date', 'created_at', 'uid']);
  });

  it('exports every capped bean page', async () => {
    render(<BeanHistoryPage user={user} />);
    await screen.findByRole('button', { name: 'beanHistory.edit.start' });
    fireEvent.click(screen.getByRole('button', { name: 'beanHistory.exportJson' }));
    const payload = JSON.parse(mocks.clipboard.mock.calls[0][0]);
    expect(payload.count).toBe(2);
    expect(payload.beans.map((row: BeanRow) => row.uid)).toEqual([beanA, beanB]);
  });

  it('sends the complete brew and new grinder in one atomic RPC, preserving the draft on failure', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'Atomic save failed' } });
    render(<HistoryPage user={user} />);
    await screen.findByText('Recipe Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'history.edit.start' }));
    fireEvent.change(screen.getByDisplayValue('Recipe Alpha'), { target: { value: 'Updated recipe' } });
    const field = (key: string) => screen.getByText(key, { selector: 'label' }).parentElement!.querySelector('input')!;
    fireEvent.change(field('grinder.field.maker'), { target: { value: 'New maker' } });
    fireEvent.change(field('grinder.field.model'), { target: { value: 'New model' } });
    fireEvent.click(screen.getByRole('button', { name: 'history.edit.save' }));
    await screen.findByText('Atomic save failed');
    expect(screen.getByDisplayValue('Updated recipe')).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, { p_data: data }] = mocks.rpc.mock.calls[0];
    expect(name).toBe('save_beanlog_data');
    expect(data.grinders).toEqual([{ uid: expect.any(String), maker: 'New maker', model: 'New model' }]);
    expect(data.brews[0]).toMatchObject({ uid: brewA, recipe: 'Updated recipe', bean_uid: beanA, taste_flavor_notes: notes,
      grinder_uid: data.grinders[0].uid, water_temp_c: 93, coffee_dose_g: 15 });
    expect(mocks.from.mock.calls.some(([table]) => table === 'brew_flavor_notes')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'history.edit.save' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]);
  });

  it('saves bean fields and flavor notes in one RPC', async () => {
    render(<BeanHistoryPage user={user} />);
    fireEvent.click(await screen.findByRole('button', { name: 'beanHistory.edit.start' }));
    fireEvent.change(screen.getByDisplayValue('Alpha'), { target: { value: 'Updated bean' } });
    fireEvent.click(screen.getByRole('button', { name: 'beanHistory.edit.save' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc).toHaveBeenCalledWith('save_beanlog_data', { p_data: { beans: [{
      uid: beanA, bean_name: 'Updated bean', roastery: 'Roaster Alpha', producer: null,
      origin_location: null, origin_country: null, process: null, varietal: null,
      cup_notes: null, cup_flavor_notes: notes, roasted_on: '2026-09-14',
    }] } });
    expect(mocks.from.mock.calls.some(([table]) => table === 'bean_flavor_notes')).toBe(false);
  });

  it('rolls back guest brew and grinder writes together on storage failure', async () => {
    seedGuest();
    render(<HistoryPage user={user} isGuest />);
    await screen.findByText('Recipe Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'history.edit.start' }));
    fireEvent.change(screen.getByDisplayValue('Recipe Alpha'), { target: { value: 'Unsaved recipe' } });
    const field = (key: string) => screen.getByText(key, { selector: 'label' }).parentElement!.querySelector('input')!;
    fireEvent.change(field('grinder.field.maker'), { target: { value: 'New maker' } });
    fireEvent.change(field('grinder.field.model'), { target: { value: 'New model' } });
    const before = localStorage.getItem('beanlog.local.brews');
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'beanlog.local.grinders') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    fireEvent.click(screen.getByRole('button', { name: 'history.edit.save' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'history.edit.save' }) as HTMLButtonElement).disabled).toBe(false));
    expect(localStorage.getItem('beanlog.local.brews')).toBe(before);
    expect(localStorage.getItem('beanlog.local.grinders')).toBeNull();
    expect(screen.getByDisplayValue('Unsaved recipe')).toBeTruthy();
    expect(screen.getByText('storage.error.writeFailed')).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps guest bean edits open and preserves saved data when storage fails', async () => {
    seedGuest();
    render(<BeanHistoryPage user={user} isGuest />);
    fireEvent.click(await screen.findByRole('button', { name: 'beanHistory.edit.start' }));
    fireEvent.change(screen.getByDisplayValue('Alpha'), { target: { value: 'Unsaved bean' } });
    const before = localStorage.getItem('beanlog.local.beans');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    fireEvent.click(screen.getByRole('button', { name: 'beanHistory.edit.save' }));
    expect(localStorage.getItem('beanlog.local.beans')).toBe(before);
    expect(screen.getByDisplayValue('Unsaved bean')).toBeTruthy();
    expect(screen.getByText('storage.error.writeFailed')).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
