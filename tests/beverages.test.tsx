import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { LoggingApp } from '../src/logging/LoggingApp';
import { localBuildBackupPayload, localGetAllData, localRestoreFromBackup, localSaveData } from '../src/logging/storage';
import type { BeanlogSaveData } from '../src/logging/storage/cloudDb';

vi.mock('../src/config/supabase', () => ({ isSupabaseConfigured: () => false }));
vi.mock('../src/platform', () => ({ getPlatform: () => 'web', isNative: () => false, canPrintBrotherLabels: () => false }));

const user = { uid: 'guest', id: 'guest' };
const noAction = () => {};
const mount = (props: Partial<Parameters<typeof LoggingApp>[0]> = {}) => render(<I18nProvider>
  <LoggingApp user={user} isGuest onAuthSuccess={noAction} onExitGuest={noAction} onEnterGuest={noAction} {...props} />
</I18nProvider>);
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });

it('records tea-specific steeping and tea notes in one save', async () => {
  mount();
  click('Tea');
  expect(screen.getByRole('heading', { name: 'New tea session' })).toBeTruthy();
  change('Name', 'Spring Sencha');
  change('Style', 'green');
  change('Harvest / season', 'First flush');
  change('Tea leaves (g)', '4.5');
  change('Water (mL)', '130');
  change('Steep time (seconds)', '55');
  change('Infusion number', '2');
  const notes = screen.getAllByRole('button', { name: /Select \(broad\)/ });
  fireEvent.click(notes[notes.length - 1]);
  fireEvent.click(screen.getByRole('option', { name: 'Mouthfeel' }));
  fireEvent.click(screen.getByRole('button', { name: /Select \(narrow\)/ }));
  fireEvent.click(screen.getByRole('option', { name: 'Umami' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Add note' })[1]);
  click('Save tasting');
  await screen.findByText('Saved.');
  const { beans, brews } = localGetAllData();
  expect(beans).toHaveLength(1);
  expect(beans[0]).toMatchObject({ beverage_type: 'tea', beverage_details: { teaStyle: 'green', harvest: 'First flush' } });
  expect(brews[0]).toMatchObject({ bean_uid: beans[0].uid, grinder_uid: null,
    beverage_details: { leafGrams: 4.5, waterMl: 130, steepSeconds: 55, infusions: 2 },
    taste_flavor_notes: [{ path: ['Mouthfeel', 'Umami'] }],
  });
  click('Coffee');
  expect(screen.queryByRole('option', { name: /Spring Sencha/ })).toBeNull();
});

it('stores wine metadata and restores it through guest backup', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  mount();
  click('Wine');
  expect(screen.queryByLabelText('Steep time (seconds)')).toBeNull();
  expect(screen.queryByLabelText(/Grinder/)).toBeNull();
  change('Name', 'Cellar Pinot Noir');
  change('Style', 'red');
  change('Grape variety', 'Pinot Noir');
  change('Vintage', '2022');
  change('Alcohol (%)', '13.5');
  change('Food pairing', 'Mushroom risotto');
  change('Tannins', 'medium');
  click('Save tasting');
  await screen.findByText('Saved.');
  const snapshot = localBuildBackupPayload();
  localStorage.clear();
  localRestoreFromBackup(snapshot);
  expect(localGetAllData().beans[0]).toMatchObject({ varietal: 'Pinot Noir', beverage_type: 'wine',
    beverage_details: { wineStyle: 'red', vintage: 2022, abv: 13.5 } });
  expect(localGetAllData().brews[0].beverage_details).toEqual({ tannins: 'medium', pairing: 'Mushroom risotto' });
  click('History');
  const tasting = await screen.findByRole('button', { name: /Cellar Pinot Noir/ });
  expect(tasting.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Mushroom risotto')).toBeTruthy();
  expect(screen.getByText('2022')).toBeTruthy();
  click('Edit tasting');
  expect((screen.getByLabelText('Food pairing') as HTMLInputElement).value).toBe('Mushroom risotto');
  expect(screen.queryByLabelText('Steep time (seconds)')).toBeNull();
  change('Food pairing', 'Roasted mushrooms');
  click('Save changes');
  await screen.findByText('Roasted mushrooms');
  try {
    click('Export JSON');
    await screen.findByText('Copied 1 records as JSON.');
    expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({
      beverage_type: 'wine', count: 1, brews: [{
        bean: { bean_name: 'Cellar Pinot Noir', beverage_details: { vintage: 2022 } },
        beverage_details: { tannins: 'medium', pairing: 'Roasted mushrooms' },
      }],
    });
    expect(writeText.mock.calls[0][0]).not.toContain('user_uid');
  } finally {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it.each([
  { name: 'Old Oolong', auto: true },
  { name: 'Mountain Reserve No. 8', auto: false },
])('moves $name and all linked records without losing notes or details', async ({ name, auto }) => {
  const beanId = crypto.randomUUID();
  const brewId = crypto.randomUUID();
  const data: BeanlogSaveData = {
    beans: [{ uid: beanId, bean_name: name, roastery: 'Original vendor', producer: null, origin_country: null,
      origin_location: null, process: null, varietal: null, roasted_on: null, cup_notes: null,
      cup_flavor_notes: [{ path: ['Roasted', 'Toast'], color: '#92400e' }] }],
    brews: [{ uid: brewId, bean_uid: beanId, brew_date: '2026-11-19T12:00:00Z', recipe: 'Gongfu', water: null,
      water_temp_c: 93, coffee_dose_g: 6, coffee_yield_g: null, coffee_tds: null, grinder_uid: null,
      grinder_setting: null, grind_median_um: null, rating: 4, extraction_note: null, taste_note: 'Old session',
      taste_flavor_notes: [{ path: ['Sweet', 'Honey'], color: '#f59e0b' }] }],
  };
  localSaveData(data);
  mount({ initialLogTab: 'beans' });
  if (!auto) {
    click('Edit bean');
    fireEvent.change(screen.getByRole('combobox', { name: /^Beverage type/ }), { target: { value: 'tea' } });
    click('Save changes');
  } else {
    expect(screen.queryByRole('button', { name: 'Edit bean' })).toBeNull();
  }
  await waitFor(() => expect(localGetAllData().beans[0].beverage_type).toBe('tea'));
  expect(localGetAllData().beans[0].cup_flavor_notes).toEqual(data.beans![0].cup_flavor_notes);
  expect(localGetAllData().brews[0]).toMatchObject(data.brews![0]);
  click('Tea');
  expect(await screen.findByRole('button', { name: new RegExp(name) })).toBeTruthy();
  expect(screen.getByText('Original record details')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Print label' })).toBeNull();
  click('History');
  const tasting = await screen.findByRole('button', { name: label => label.includes(name) });
  expect(tasting.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Old session')).toBeTruthy();
  expect(screen.getByText('Sweet / Honey')).toBeTruthy();
  click('Edit tasting');
  change('Tasting notes', 'Updated tea session');
  change('Steep time (seconds)', '45');
  click('Save changes');
  await screen.findByText('Updated tea session');
  expect(localGetAllData().brews[0]).toMatchObject({
    uid: brewId, brew_date: data.brews![0].brew_date, bean_uid: beanId, coffee_dose_g: 6,
    beverage_details: { steepSeconds: 45 }, taste_flavor_notes: data.brews![0].taste_flavor_notes,
  });
  click('Coffee');
  const history = await screen.findByRole('heading', { name: 'Brew history' });
  expect(within(history.parentElement!).queryByText(name)).toBeNull();
});

it('fills a tea draft from pasted JSON, leaving the tasting and storage untouched until save', async () => {
  mount();
  click('Tea');
  change('Tea leaves (g)', '5');
  change('LLM result JSON', '```json\n' + JSON.stringify({
    beverage_type: 'tea', bean_name: 'Mountain Oolong', producer: 'Valley Garden', origin_country: 'Taiwan',
    origin_location: 'Nantou', varietal: 'Qing Xin', process: 'Light oxidation',
    beverage_details: { teaStyle: 'OOLONG', harvest: 'Spring 2026' }, cup_notes: ['Orchid', 'Silky'],
    cup_flavor_notes: [{ path: ['Floral', 'Orchid'] }, { path: ['Fruit', 'Black Fruit'] }],
  }) + '\n```');
  click('Import pasted JSON');
  expect(screen.getByText('Draft filled in. Review the details before saving.')).toBeTruthy();
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Mountain Oolong');
  expect((screen.getByLabelText('Style') as HTMLSelectElement).value).toBe('oolong');
  expect((screen.getByLabelText('Tea leaves (g)') as HTMLInputElement).value).toBe('5');
  expect(screen.getByText('Floral / Orchid')).toBeTruthy();
  expect(localGetAllData().beans).toHaveLength(0);
  click('Save tasting');
  await screen.findByText('Saved.');
  expect(localGetAllData().beans[0]).toMatchObject({
    beverage_type: 'tea', producer: 'Valley Garden', varietal: 'Qing Xin', process: 'Light oxidation',
    beverage_details: { teaStyle: 'oolong', harvest: 'Spring 2026' }, cup_notes: 'Orchid, Silky',
    cup_flavor_notes: [{ path: ['Floral', 'Orchid'], color: '#a65376' }],
  });
});

it('copies the wine prompt with wine references and imports only matching JSON from the clipboard', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const readText = vi.fn()
    .mockResolvedValueOnce(JSON.stringify({ beverage_type: 'tea', bean_name: 'Wrong tea' }))
    .mockResolvedValueOnce(JSON.stringify({
      beverage_type: 'wine', bean_name: 'Cellar Reserve', varietal: 'Pinot Noir', process: 'not a wine field',
      beverage_details: { wineStyle: 'red', vintage: '2022', abv: 13.5, harvest: 'not a wine field' },
      cup_flavor_notes: [{ path: ['Fruit', 'Red Berries'], color: '#000000' }],
    }));
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText } });
  const empty = { roastery: null, producer: null, origin_country: null, origin_location: null,
    process: null, varietal: null, roasted_on: null, cup_notes: null, cup_flavor_notes: [] };
  localSaveData({ beans: [
    { ...empty, uid: crypto.randomUUID(), bean_name: 'Saved Pinot', producer: 'Cellar Estate', origin_location: 'Burgundy', beverage_type: 'wine' },
    { ...empty, uid: crypto.randomUUID(), bean_name: 'Tea Reference', beverage_type: 'tea' },
  ] });
  try {
    mount({ initialLogTab: 'beans' });
    click('Wine');
    click('New wine');
    click('Copy prompt');
    await screen.findByText('Prompt copied. Paste it into your LLM with the label photo.');
    expect(writeText.mock.calls[0][0]).toContain('Cellar Estate');
    expect(writeText.mock.calls[0][0]).toContain('Burgundy');
    expect(writeText.mock.calls[0][0]).toContain('allowed_flavor_wheel');
    expect(writeText.mock.calls[0][0]).not.toContain('Tea Reference');
    change('Name', 'My draft');
    click('Import from clipboard');
    expect((await screen.findByRole('alert')).textContent).toContain('matches this beverage type');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('My draft');
    click('Import from clipboard');
    await screen.findByText('Draft filled in. Review the details before saving.');
    expect((screen.getByLabelText('Vintage') as HTMLInputElement).value).toBe('2022');
    expect((screen.getByLabelText('Alcohol (%)') as HTMLInputElement).value).toBe('13.5');
    expect(localGetAllData().beans).toHaveLength(2);
    click('Save beverage');
    await screen.findByText('Saved.');
    expect(localGetAllData().beans.find(row => row.bean_name === 'Cellar Reserve')).toMatchObject({
      beverage_type: 'wine', varietal: 'Pinot Noir', process: null,
      beverage_details: { wineStyle: 'red', vintage: 2022, abv: 13.5 },
      cup_flavor_notes: [{ path: ['Fruit', 'Red Berries'], color: '#a44c54' }],
    });
  } finally {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('lists tea products and tastings with selection, filters, sorting and editing', async () => {
  mount();
  click('Tea');
  change('Name', 'Garden Sencha');
  change('Style', 'green');
  change('Tasting date', '2026-11-19');
  change('Tasting notes', 'Grassy notes');
  click('Save tasting');
  await screen.findByText('Saved.');
  change('Saved beverage', '');
  change('Name', 'Mountain Oolong');
  change('Style', 'oolong');
  change('Tasting date', '2026-11-20');
  change('Tasting notes', 'Floral notes');
  click('Save tasting');
  await waitFor(() => expect(localGetAllData().brews).toHaveLength(2));
  click('Teas');
  expect(await screen.findByText('Your beverages')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Garden Sencha/ }));
  expect(screen.getByText('Green')).toBeTruthy();
  click('Edit beverage');
  change('Harvest / season', 'First flush');
  click('Save changes');
  await screen.findByText('First flush');
  expect(localGetAllData().beans.find(row => row.bean_name === 'Garden Sencha')?.beverage_details)
    .toEqual({ teaStyle: 'green', harvest: 'First flush' });
  click('History');
  expect(await screen.findByText('Floral notes')).toBeTruthy();
  change('Sort', 'date_asc');
  const entries = screen.getAllByRole('button', { name: /2026.*(Sencha|Oolong)/ });
  expect(entries[0].textContent).toContain('Garden Sencha');
  click('Filter');
  change('Name', 'Sencha');
  expect(screen.getByText('Grassy notes')).toBeTruthy();
  expect(screen.queryByText('Floral notes')).toBeNull();
  expect(screen.queryByRole('button', { name: /Mountain Oolong/ })).toBeNull();
});
