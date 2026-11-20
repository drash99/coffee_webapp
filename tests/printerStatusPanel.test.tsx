import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { BrotherPrinterStatusPanel } from '../src/logging/components/BrotherPrinterStatusPanel';
import type { BrotherPrinterStatus } from '../src/platform';

const mocks = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock('../src/platform', () => ({ getBrotherPrinterStatus: mocks.status }));
const ready: BrotherPrinterStatus = {
  printerName: 'PT-P710BT1234', connection: 'connected', transport: 'Bluetooth', checkedAt: 1794160800000,
  state: 'ready', battery: { level: 2, maxLevel: 3, charging: true, mounted: true }, media: { widthMm: 24 },
};
const view = (printing = false, name = 'PT-P710BT') => <I18nProvider>
  <BrotherPrinterStatusPanel printerName={name} printing={printing} />
</I18nProvider>;

beforeEach(() => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  mocks.status.mockReset().mockResolvedValue(structuredClone(ready));
});
afterEach(() => vi.useRealTimers());

it('shows real battery steps, charging and tape width without inventing a tape percentage', async () => {
  render(view());
  await screen.findByText('Level 2/3');
  expect(screen.getByText('Charging')).toBeTruthy();
  expect(screen.getByText('24 mm')).toBeTruthy();
  expect(screen.getByText('Ready to print')).toBeTruthy();
  expect(screen.getByText('Unavailable')).toBeTruthy();
  expect(screen.queryByText(/67%/)).toBeNull();
});

it('shows percentages only if the printer actually reports a 100-step scale', async () => {
  mocks.status.mockResolvedValue({ ...ready, battery: { level: 73, maxLevel: 100 } });
  render(view());
  await screen.findByText('73%');
});

it('shows unknown data and detected media problems honestly', async () => {
  mocks.status.mockResolvedValue({ ...ready, battery: {}, media: { widthMm: 12 }, state: 'coverOpen' });
  render(view());
  await screen.findByText('Cover open');
  expect(screen.getAllByText('Unavailable')).toHaveLength(2);
  expect(screen.getByRole('alert').textContent).toContain('12 mm');
  expect(screen.queryByRole('progressbar')).toBeNull();
});

it('clears stale connected data when a refresh cannot reach the printer', async () => {
  render(view());
  await screen.findByText('Level 2/3');
  mocks.status.mockResolvedValue({ ...ready, connection: 'notFound' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh printer status' }));
  await screen.findByText('Printer not found');
  expect(screen.queryByText('Level 2/3')).toBeNull();
  expect(screen.queryByText('Ready to print')).toBeNull();
});

it('handles native query failures and allows retrying', async () => {
  mocks.status.mockRejectedValueOnce(new Error('Bluetooth denied'));
  render(view());
  await screen.findByText('Status check failed');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh printer status' }));
  await screen.findByText('Ready to print');
});

it('refreshes every 30 seconds and pauses while printing or hidden', async () => {
  vi.useFakeTimers();
  const { rerender } = render(view());
  await act(async () => {});
  expect(mocks.status).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(mocks.status).toHaveBeenCalledTimes(2);
  rerender(view(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(mocks.status).toHaveBeenCalledTimes(2);
  rerender(view());
  await act(async () => {});
  expect(mocks.status).toHaveBeenCalledTimes(3);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(mocks.status).toHaveBeenCalledTimes(3);
});

it('ignores old responses after changing the requested printer', async () => {
  let finish!: (value: BrotherPrinterStatus) => void;
  mocks.status.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(view());
  rerender(view(false, 'Other printer'));
  await screen.findByText('Ready to print');
  await act(async () => { finish({ ...ready, connection: 'notFound' }); });
  expect(screen.queryByText('Printer not found')).toBeNull();
  expect(screen.getByText('Ready to print')).toBeTruthy();
});
