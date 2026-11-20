import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { enUS } from '../src/i18n/locales/en-us';
import { NewBrewPage } from '../src/logging/pages/NewBrewPage';
import { localGetAllData, localInsertBean, localInsertBrew } from '../src/logging/storage/localDb';
import type { BeanRow, BrewRow } from '../src/logging/types';

const mocks = vi.hoisted(() => ({ save: vi.fn(), range: vi.fn(), findGrinder: vi.fn() }));

vi.mock('../src/logging/storage/cloudDb', () => ({ saveCloudData: mocks.save }));
vi.mock('../src/config/supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ from: () => {
    const query = {
      select: () => query, order: () => query, range: mocks.range,
      ilike: () => query, limit: () => query, maybeSingle: mocks.findGrinder,
    };
    return query;
  } }),
}));
vi.mock('../src/logging/hooks/useBeanSuggestions', () => ({ useBeanSuggestions: () => ({
  roasteries: [], countries: [], varietals: [], locationsForCountry: () => [], producersForLocation: () => [],
}) }));
vi.mock('../src/logging/hooks/useGrinderSuggestions', () => ({ useGrinderSuggestions: () => ({
  makers: [], modelsForMaker: () => [],
}) }));
vi.mock('../src/logging/hooks/useRecipeSuggestions', () => ({ useRecipeSuggestions: () => ({ recipes: [] }) }));

const bean: Omit<BeanRow, 'user_uid'> = {
  uid: '11111111-1111-4111-8111-111111111111', bean_name: 'Original bean', roastery: 'Test roaster',
  producer: null, origin_location: null, origin_country: null, process: null, varietal: null,
  cup_notes: null, cup_flavor_notes: [], roasted_on: '2026-09-14',
};
const brew: Omit<BrewRow, 'user_uid'> = {
  uid: '22222222-2222-4222-8222-222222222222', bean_uid: bean.uid, brew_date: '2026-09-14T05:00:00Z',
  grinder_uid: null, grinder_setting: null, recipe: 'First recipe', coffee_dose_g: 15, coffee_yield_g: 250,
  coffee_tds: null, water: null, water_temp_c: null, grind_median_um: null, rating: 4,
  extraction_note: null, taste_note: null, taste_flavor_notes: [],
};

function renderPage(isGuest = false) {
  return render(<I18nProvider><NewBrewPage user={{ uid: 'user-1', id: 'tester' }} isGuest={isGuest} /></I18nProvider>);
}

beforeEach(() => {
  mocks.save.mockReset();
  mocks.range.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.findGrinder.mockReset().mockResolvedValue({ data: null, error: null });
});

describe('new brew saving', () => {
  it('keeps the page available when stored recipe data is corrupt', async () => {
    localStorage.setItem('beanlog.local.brews', '{broken');
    renderPage(true);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', enUS['storage.error.invalidData']);
    expect(screen.getByRole('button', { name: enUS['newBrew.save'] })).toBeTruthy();
    expect(localStorage.getItem('beanlog.local.brews')).toBe('{broken');
  });

  it('reuses bean, brew, and grinder IDs when retrying an ambiguous server failure', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce(undefined);
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(enUS['bean.placeholder.name']), { target: { value: 'New coffee' } });
    fireEvent.change(screen.getByPlaceholderText(enUS['grinder.placeholder.maker']), { target: { value: 'Example' } });
    fireEvent.change(screen.getByPlaceholderText(enUS['grinder.placeholder.model']), { target: { value: 'Model' } });
    fireEvent.click(screen.getByRole('button', { name: enUS['newBrew.save'] }));
    await screen.findByText('Response lost');
    fireEvent.click(screen.getByRole('button', { name: enUS['newBrew.save'] }));
    await screen.findByText(enUS['newBrew.saved']);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0]).toEqual(mocks.save.mock.calls[0][0]);
    expect(mocks.save.mock.calls[0][0].beans).toHaveLength(1);
    expect(mocks.save.mock.calls[0][0].brews).toHaveLength(1);
    expect(mocks.save.mock.calls[0][0].grinders).toHaveLength(1);
    expect(mocks.findGrinder).toHaveBeenCalledTimes(1);
  });

  it('reuses calibration and grinder IDs until a calibration save is confirmed', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValue(undefined);
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(enUS['grinder.placeholder.maker']), { target: { value: 'Example' } });
    fireEvent.change(screen.getByPlaceholderText(enUS['grinder.placeholder.model']), { target: { value: 'Model' } });
    fireEvent.change(screen.getByPlaceholderText(enUS['grinder.placeholder.setting']), { target: { value: '24' } });
    fireEvent.change(screen.getByPlaceholderText(enUS['grindMap.placeholder.particleMedianUm']), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: enUS['grindMap.save'] }));
    await screen.findByText('Response lost');
    fireEvent.click(screen.getByRole('button', { name: enUS['grindMap.save'] }));
    await screen.findByText(enUS['grindMap.saved']);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0]).toEqual(mocks.save.mock.calls[0][0]);
    expect(mocks.findGrinder).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: enUS['grindMap.save'] }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3));
    expect(mocks.save.mock.calls[2][0].particleSizes[0].uid).not.toBe(mocks.save.mock.calls[0][0].particleSizes[0].uid);
  });

  it('keeps a committed save successful when the list refresh fails', async () => {
    mocks.save.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(mocks.range).toHaveBeenCalled());
    mocks.range.mockResolvedValue({ data: null, error: { message: 'Refresh unavailable' } });
    fireEvent.change(screen.getByPlaceholderText(enUS['bean.placeholder.name']), { target: { value: 'Committed coffee' } });
    fireEvent.click(screen.getByRole('button', { name: enUS['newBrew.save'] }));
    await screen.findByText(enUS['newBrew.savedRefreshFailed']);
    expect(screen.getByText(enUS['newBrew.saved'])).toBeTruthy();
    expect((screen.getByPlaceholderText(enUS['bean.placeholder.name']) as HTMLInputElement).value).toBe('');
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('preserves saved bean edits when applying a prior brew and saving again', async () => {
    localInsertBean(bean);
    localInsertBrew(brew);
    renderPage(true);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: bean.uid } });
    await screen.findByRole('button', { name: enUS['newBrew.preset.applyLastBrew'] });
    fireEvent.change(screen.getByPlaceholderText(enUS['bean.placeholder.name']), { target: { value: 'Renamed bean' } });
    fireEvent.click(screen.getByRole('button', { name: enUS['newBrew.bean.save'] }));
    await screen.findByText(enUS['newBrew.bean.saved']);
    fireEvent.click(await screen.findByRole('button', { name: enUS['newBrew.preset.applyLastBrew'] }));
    expect((screen.getByPlaceholderText(enUS['bean.placeholder.name']) as HTMLInputElement).value).toBe('Renamed bean');
    fireEvent.click(screen.getByRole('button', { name: enUS['newBrew.save'] }));
    await screen.findByText(enUS['newBrew.saved']);
    expect(localGetAllData().beans[0].bean_name).toBe('Renamed bean');
    expect(localGetAllData().brews).toHaveLength(2);
  });

  it('applies the newest same-day brew recipe', async () => {
    localInsertBean(bean);
    localInsertBrew(brew);
    localInsertBrew({ ...brew, uid: '33333333-3333-4333-8333-333333333333', recipe: 'Latest recipe' });
    renderPage(true);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: bean.uid } });
    fireEvent.click(await screen.findByRole('button', { name: enUS['newBrew.preset.applyLastBrew'] }));
    expect((screen.getByPlaceholderText(enUS['brew.placeholder.recipe']) as HTMLTextAreaElement).value).toBe('Latest recipe');
  });
});
