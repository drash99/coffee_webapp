import { Capacitor, registerPlugin } from '@capacitor/core';
import { getPlatform } from './platform';

export type BrotherPrintLabel = {
  pngDataUrl: string;
};

type BrotherPrinterPlugin = {
  printLabels(options: { printerName?: string; labels: BrotherPrintLabel[] }): Promise<{ printed: number }>;
};

const BrotherPrinter = registerPlugin<BrotherPrinterPlugin>('BrotherPrinter');
type CapacitorBridgeLike = typeof Capacitor & {
  PluginHeaders?: Array<{ name: string }>;
  nativePromise?: <O, R>(pluginName: string, methodName: string, options?: O) => Promise<R>;
};

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

  if (hasBrotherPrinterHeader()) {
    return BrotherPrinter.printLabels(options);
  }

  const bridge = Capacitor as CapacitorBridgeLike;
  if (!bridge.nativePromise) {
    throw new Error('Brother label printing is unavailable in this iOS build.');
  }

  // Fallback for local app plugins that are present natively but not yet exported in PluginHeaders.
  return bridge.nativePromise<typeof options, { printed: number }>(
    'BrotherPrinterPlugin',
    'printLabels',
    options,
  );
}
