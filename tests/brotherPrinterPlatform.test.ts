import { beforeEach, expect, it, vi } from 'vitest';
import { getBrotherPrinterStatus } from '../src/platform/brotherPrinter';

const mocks = vi.hoisted(() => ({ platform: 'ios', headers: true, status: vi.fn(), native: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    get PluginHeaders() { return mocks.headers ? [{ name: 'BrotherPrinter' }] : []; },
    nativePromise: mocks.native,
  },
  registerPlugin: () => ({ getStatus: mocks.status }),
}));
vi.mock('../src/platform/platform', () => ({ getPlatform: () => mocks.platform }));

const status = { connection: 'connected', printerName: 'PT-P710BT', checkedAt: 1 };
beforeEach(() => {
  mocks.platform = 'ios';
  mocks.headers = true;
  mocks.status.mockReset().mockResolvedValue(status);
  mocks.native.mockReset().mockResolvedValue(status);
});

it('uses the registered status method with a normalized name', async () => {
  expect(await getBrotherPrinterStatus({ printerName: ' PT-P710BT ' })).toEqual(status);
  expect(mocks.status).toHaveBeenCalledExactlyOnceWith({ printerName: 'PT-P710BT' });
  expect(mocks.native).not.toHaveBeenCalled();
});

it('supports the local plugin bridge fallback', async () => {
  mocks.headers = false;
  expect(await getBrotherPrinterStatus({ printerName: ' PT-P710BT ' })).toEqual(status);
  expect(mocks.native).toHaveBeenCalledExactlyOnceWith('BrotherPrinterPlugin', 'getStatus', { printerName: 'PT-P710BT' });
});

it('keeps bridge errors actionable', async () => {
  mocks.status.mockRejectedValue({ message: 'Bluetooth permission denied' });
  await expect(getBrotherPrinterStatus({})).rejects.toThrow('Bluetooth permission denied');
});

it('never calls native status on the web', async () => {
  mocks.platform = 'web';
  await expect(getBrotherPrinterStatus({})).rejects.toThrow('only available on iOS');
  expect(mocks.status).not.toHaveBeenCalled();
  expect(mocks.native).not.toHaveBeenCalled();
});
