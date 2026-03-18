const KEY_PRINTER_NAME = 'beanlog.labels.printerName';
const KEY_DEFAULT_GRAMS = 'beanlog.labels.defaultGrams';
const KEY_DEFAULT_COUNT = 'beanlog.labels.defaultCount';

export const DEFAULT_BROTHER_PRINTER_NAME = 'PT-P710BT';
export const DEFAULT_LABEL_GRAMS = '15';
export const DEFAULT_LABEL_COUNT = '4';

export function getLabelPrinterName(): string {
  try {
    return localStorage.getItem(KEY_PRINTER_NAME)?.trim() || DEFAULT_BROTHER_PRINTER_NAME;
  } catch {
    return DEFAULT_BROTHER_PRINTER_NAME;
  }
}

export function setLabelPrinterName(name: string): void {
  try {
    const next = name.trim();
    if (!next) {
      localStorage.removeItem(KEY_PRINTER_NAME);
      return;
    }
    localStorage.setItem(KEY_PRINTER_NAME, next);
  } catch {
    // ignore
  }
}

export function getDefaultLabelGrams(): string {
  try {
    return localStorage.getItem(KEY_DEFAULT_GRAMS)?.trim() || DEFAULT_LABEL_GRAMS;
  } catch {
    return DEFAULT_LABEL_GRAMS;
  }
}

export function setDefaultLabelGrams(value: string): void {
  try {
    const next = value.trim();
    if (!next) {
      localStorage.removeItem(KEY_DEFAULT_GRAMS);
      return;
    }
    localStorage.setItem(KEY_DEFAULT_GRAMS, next);
  } catch {
    // ignore
  }
}

export function getDefaultLabelCount(): string {
  try {
    return localStorage.getItem(KEY_DEFAULT_COUNT)?.trim() || DEFAULT_LABEL_COUNT;
  } catch {
    return DEFAULT_LABEL_COUNT;
  }
}

export function setDefaultLabelCount(value: string): void {
  try {
    const next = value.trim();
    if (!next) {
      localStorage.removeItem(KEY_DEFAULT_COUNT);
      return;
    }
    localStorage.setItem(KEY_DEFAULT_COUNT, next);
  } catch {
    // ignore
  }
}
