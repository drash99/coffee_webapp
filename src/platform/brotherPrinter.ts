import { Capacitor, registerPlugin } from '@capacitor/core';
import { getPlatform } from './platform';

export type BrotherPrintLabel = {
  pngDataUrl: string;
};

export type BrotherPrinterState = 'ready' | 'noPaper' | 'coverOpen' | 'busy' | 'paperJam' |
  'highVoltageAdapter' | 'batteryEmpty' | 'batteryTrouble' | 'tubeNotDetected' | 'motorSlow' |
  'unsupportedCharger' | 'incompatibleEquipment' | 'systemError' | 'otherError';

export type BrotherPrinterStatus = {
  connection: 'connected' | 'notFound' | 'unreachable';
  printerName: string;
  checkedAt: number;
  transport?: string;
  state?: BrotherPrinterState;
  battery?: { level?: number; maxLevel?: number; charging?: boolean; mounted?: boolean };
  media?: { widthMm?: number };
};

type BrotherPrinterPlugin = {
  printLabels(options: { printerName?: string; labels: BrotherPrintLabel[] }): Promise<{ printed: number }>;
  getStatus(options: { printerName?: string }): Promise<BrotherPrinterStatus>;
};

const BrotherPrinter = registerPlugin<BrotherPrinterPlugin>('BrotherPrinter');
type CapacitorBridgeLike = typeof Capacitor & {
  PluginHeaders?: Array<{ name: string }>;
  nativePromise?: <O, R>(pluginName: string, methodName: string, options?: O) => Promise<R>;
};

function extractPluginErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const maybeMessage = 'message' in error ? error.message : null;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage;
    const maybeLocalized = 'localizedDescription' in error ? error.localizedDescription : null;
    if (typeof maybeLocalized === 'string' && maybeLocalized.trim()) return maybeLocalized;
  }
  return 'Brother label printing failed.';
}

function hasBrotherPrinterHeader(): boolean {
  const bridge = Capacitor as CapacitorBridgeLike;
  return bridge.PluginHeaders?.some((header) => header.name === 'BrotherPrinter') ?? false;
}

export function canPrintBrotherLabels(): boolean {
  return getPlatform() === 'ios';
}

export async function printBrotherLabels(options: {
  printerName?: string;
  labels: BrotherPrintLabel[];
}): Promise<{ printed: number }> {
  if (!canPrintBrotherLabels()) {
    throw new Error('Brother label printing is only available on iOS.');
  }

  const normalizedOptions = {
    ...options,
    printerName: options.printerName?.trim() || undefined,
  };

  try {
    if (hasBrotherPrinterHeader()) {
      return await BrotherPrinter.printLabels(normalizedOptions);
    }

    const bridge = Capacitor as CapacitorBridgeLike;
    if (!bridge.nativePromise) {
      throw new Error('Brother label printing is unavailable in this iOS build.');
    }

    // Fallback for local app plugins that are present natively but not yet exported in PluginHeaders.
    return await bridge.nativePromise<typeof normalizedOptions, { printed: number }>(
      'BrotherPrinterPlugin',
      'printLabels',
      normalizedOptions,
    );
  } catch (error) {
    throw new Error(extractPluginErrorMessage(error));
  }
}

export async function getBrotherPrinterStatus(options: { printerName?: string }): Promise<BrotherPrinterStatus> {
  if (!canPrintBrotherLabels()) throw new Error('Brother printer status is only available on iOS.');
  const normalizedOptions = { printerName: options.printerName?.trim() || undefined };
  try {
    if (hasBrotherPrinterHeader()) return await BrotherPrinter.getStatus(normalizedOptions);
    const bridge = Capacitor as CapacitorBridgeLike;
    if (!bridge.nativePromise) throw new Error('Brother printer status is unavailable in this iOS build.');
    return await bridge.nativePromise<typeof normalizedOptions, BrotherPrinterStatus>(
      'BrotherPrinterPlugin', 'getStatus', normalizedOptions,
    );
  } catch (error) {
    throw new Error(extractPluginErrorMessage(error));
  }
}
