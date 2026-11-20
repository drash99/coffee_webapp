import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BeanHistoryPage } from '../src/logging/pages/BeanHistoryPage';
import { BeanLabelLayoutError } from '../src/logging/utils/beanLabelImage';

const mocks = vi.hoisted(() => ({ native: true, print: vi.fn(), images: vi.fn(), insert: vi.fn(), status: vi.fn() }));
vi.mock('../src/config/supabase', () => ({
  getSupabaseClient: () => ({ from: (table: string) => {
    const query = {
      select: () => query, order: () => query, eq: () => query, insert: mocks.insert,
      range: async (start: number) => ({ data: table === 'beans' && start === 0 ? beans : [], error: null }),
    };
    return query;
  } }),
}));
vi.mock('../src/i18n/I18nProvider', () => {
  const t = (key: string, vars?: { beanName?: string; grams?: string }) => key === 'beanLabels.previewAlt'
    ? `${vars?.beanName} label` : key === 'beanLabels.gramsInline' ? `${vars?.grams}g` : key;
  return { useI18n: () => ({ t, lang: 'en-us' }) };
});
vi.mock('../src/platform', () => ({
  canPrintBrotherLabels: () => mocks.native, printBrotherLabels: mocks.print, getBrotherPrinterStatus: mocks.status,
}));
vi.mock('../src/logging/utils/beanLabelImage', async importOriginal => ({
  ...await importOriginal<typeof import('../src/logging/utils/beanLabelImage')>(),
  renderBeanLabelImages: mocks.images,
}));
vi.mock('../src/logging/utils/qr', () => ({ toQrDataUrl: async () => 'data:image/png;base64,cXI=' }));
vi.mock('../src/logging/hooks/useBeanSuggestions', () => ({ useBeanSuggestions: () => ({
  roasteries: [], countries: [], varietals: [], locationsForCountry: () => [], producersForLocation: () => [],
}) }));

const user = { uid: '10000000-0000-4000-8000-000000000001', id: 'test' };
const beans = ['Alpha', 'Beta'].map((bean_name, index) => ({
  uid: `20000000-0000-4000-8000-00000000000${index + 1}`, bean_name,
  roastery: 'Test roaster', origin_location: 'Gedeb', origin_country: 'Ethiopia',
  producer: 'Test farm', process: 'Washed', varietal: 'Heirloom', cup_notes: null,
  cup_flavor_notes: [], roasted_on: '2026-11-01', created_at: '2026-11-01T12:00:00Z',
}));
const pages = [1, 2].map(index => ({
  printDataUrl: `data:image/png;base64,cHJpbnQ${index}`,
  previewDataUrl: `data:image/png;base64,cHJldmlldw${index}`,
  lengthDots: index === 1 ? 300 : 540,
}));

async function openLabels() {
  render(<BeanHistoryPage user={user} />);
  fireEvent.click(await screen.findByRole('button', { name: 'beanLabels.printMode' }));
}

beforeEach(() => {
  mocks.native = true;
  mocks.print.mockReset().mockResolvedValue({ printed: 2 });
  mocks.insert.mockReset().mockResolvedValue({ error: null });
  mocks.images.mockReset().mockResolvedValue(pages[0]).mockResolvedValueOnce(pages[0]).mockResolvedValueOnce(pages[1]);
  mocks.status.mockReset().mockResolvedValue({ connection: 'notFound', printerName: 'PT-P710BT', checkedAt: Date.now() });
  localStorage.setItem('beanlog.labels.defaultCount', '2');
});

it('shows a preview before saving records or sending anything to the printer', async () => {
  await openLabels();
  const preview = await screen.findByAltText('Alpha label');
  expect(preview.getAttribute('src')).toBe(pages[0].previewDataUrl);
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.print).not.toHaveBeenCalled();
  expect(mocks.images).toHaveBeenCalledTimes(1);
});

it.each([true, false])('prints the exact first preview with separate QR records for the rest (native=%s)', async native => {
  mocks.native = native;
  const printDialog = vi.spyOn(window, 'print').mockImplementation(() => {});
  await openLabels();
  await screen.findByAltText('Alpha label');
  const firstQr = mocks.images.mock.calls[0][0].qrText as string;
  fireEvent.click(screen.getByRole('button', { name: 'beanLabels.generateAndPrint' }));
  await waitFor(() => expect(document.querySelectorAll('.print-label-sheet img')).toHaveLength(2));
  const previews = Array.from(document.querySelectorAll('.print-label-sheet img'));
  expect(previews.map(image => image.getAttribute('src'))).toEqual(pages.map(page => page.previewDataUrl));
  expect(previews[0].getAttribute('width')).toBe('300');
  expect(previews[0].getAttribute('height')).toBe('128');
  expect(previews[1].getAttribute('width')).toBe('540');
  expect(mocks.images.mock.calls[0][0]).toMatchObject({ beanName: 'Alpha', roasteryText: 'Test roaster' });
  expect(mocks.images.mock.calls[0][0].details).toEqual([
    { label: 'beanLabels.line.origin', value: 'Ethiopia · Gedeb' },
    { label: 'beanLabels.line.producer', value: 'Test farm' },
    { label: 'beanLabels.line.process', value: 'Washed' },
    { label: 'beanLabels.line.varietal', value: 'Heirloom' },
  ]);
  expect(mocks.images.mock.calls[0][0].footerText).toBe('beanLabels.roastDate: 2026-11-01 · 15g');
  const inserted = mocks.insert.mock.calls[0][0];
  expect(firstQr).toContain(inserted[0].uid);
  expect(new Set(inserted.map((row: { uid: string }) => row.uid)).size).toBe(2);
  if (native) {
    expect(mocks.print).toHaveBeenCalledExactlyOnceWith({
      printerName: 'PT-P710BT', labels: pages.map(page => ({ pngDataUrl: page.printDataUrl })),
    });
  } else {
    await waitFor(() => expect(printDialog).toHaveBeenCalledTimes(1));
    expect(mocks.print).not.toHaveBeenCalled();
  }
});

it('reports overlong content before printing and disables the print button', async () => {
  mocks.images.mockReset().mockRejectedValueOnce(new BeanLabelLayoutError());
  await openLabels();
  await screen.findByText('beanLabels.error.tooLong');
  expect((screen.getByRole('button', { name: 'beanLabels.generateAndPrint' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.print).not.toHaveBeenCalled();
});

it('keeps the selected bean and label settings fixed while the bitmap job is being printed', async () => {
  let finish!: (value: { printed: number }) => void;
  mocks.print.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await openLabels();
  await screen.findByAltText('Alpha label');
  fireEvent.click(screen.getByRole('button', { name: 'beanLabels.generateAndPrint' }));
  await waitFor(() => expect(mocks.print).toHaveBeenCalled());
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByPlaceholderText('15') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByPlaceholderText('4') as HTMLInputElement).disabled).toBe(true);
  await act(async () => { finish({ printed: 2 }); });
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false);
  expect(Array.from(document.querySelectorAll('.print-label-sheet img')).map(image => image.getAttribute('src')))
    .toEqual(pages.map(page => page.previewDataUrl));
});

it('reserves fresh preview identifiers after each saved batch', async () => {
  await openLabels();
  await screen.findByAltText('Alpha label');
  fireEvent.click(screen.getByRole('button', { name: 'beanLabels.generateAndPrint' }));
  await waitFor(() => expect(mocks.print).toHaveBeenCalledTimes(1));
  await waitFor(() => expect((screen.getByRole('button', { name: 'beanLabels.generateAndPrint' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'beanLabels.generateAndPrint' }));
  await waitFor(() => expect(mocks.print).toHaveBeenCalledTimes(2));
  const ids = mocks.insert.mock.calls.flatMap(call => call[0].map((row: { uid: string }) => row.uid));
  expect(new Set(ids).size).toBe(4);
});

it('updates previews for weight and bean changes without saving anything', async () => {
  await openLabels();
  await screen.findByAltText('Alpha label');
  fireEvent.change(screen.getByPlaceholderText('15'), { target: { value: '20' } });
  await waitFor(() => expect(mocks.images.mock.lastCall?.[0].footerText).toContain('20g'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: beans[1].uid } });
  await screen.findByAltText('Beta label');
  expect(screen.queryByAltText('Alpha label')).toBeNull();
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.print).not.toHaveBeenCalled();
});

it('ignores a stale preview that finishes after the user selects another bean', async () => {
  let finish!: (value: typeof pages[0]) => void;
  mocks.images.mockReset().mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(pages[1]);
  await openLabels();
  await waitFor(() => expect(mocks.images).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: beans[1].uid } });
  await screen.findByAltText('Beta label');
  await act(async () => { finish(pages[0]); });
  expect(screen.queryByAltText('Alpha label')).toBeNull();
  expect(screen.getByAltText('Beta label').getAttribute('src')).toBe(pages[1].previewDataUrl);
});

it.each([['15', '-1'], ['4', '1.5'], ['4', '201']])('blocks invalid input %s=%s', async (placeholder, value) => {
  await openLabels();
  await screen.findByAltText('Alpha label');
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
  expect((screen.getByRole('button', { name: 'beanLabels.generateAndPrint' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.print).not.toHaveBeenCalled();
});
