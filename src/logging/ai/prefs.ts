const KEY_API = 'beanlog.ai.gemini.apiKey';
const KEY_TEMP_UNIT = 'beanlog.ai.gemini.tempUnit';
const KEY_MODEL_ID = 'beanlog.ai.gemini.modelId';

export type AiTempUnit = 'C' | 'F';
export const DEFAULT_GEMINI_MODEL_ID = 'gemini-3.1-flash-lite-preview';

export function getGeminiApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_API) || null;
  } catch {
    return null;
  }
}

export function setGeminiApiKey(key: string): void {
  try {
    if (!key.trim()) {
      localStorage.removeItem(KEY_API);
    } else {
      localStorage.setItem(KEY_API, key.trim());
    }
  } catch {
    // ignore
  }
}

export function clearGeminiApiKey(): void {
  try {
    localStorage.removeItem(KEY_API);
  } catch {
    // ignore
  }
}

export function getGeminiTempUnit(): AiTempUnit {
  try {
    const v = localStorage.getItem(KEY_TEMP_UNIT);
    return v === 'F' ? 'F' : 'C';
  } catch {
    return 'C';
  }
}

export function setGeminiTempUnit(unit: AiTempUnit): void {
  try {
    localStorage.setItem(KEY_TEMP_UNIT, unit);
  } catch {
    // ignore
  }
}

export function getGeminiModelId(): string {
  try {
    return localStorage.getItem(KEY_MODEL_ID)?.trim() || DEFAULT_GEMINI_MODEL_ID;
  } catch {
    return DEFAULT_GEMINI_MODEL_ID;
  }
}

export function setGeminiModelId(modelId: string): void {
  try {
    const next = modelId.trim();
    if (!next) {
      localStorage.removeItem(KEY_MODEL_ID);
      return;
    }
    localStorage.setItem(KEY_MODEL_ID, next);
  } catch {
    // ignore
  }
}
