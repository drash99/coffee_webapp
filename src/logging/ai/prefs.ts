const KEY_SERVER_HOST = 'beanlog.ai.server.host';
const KEY_SERVER_PORT = 'beanlog.ai.server.port';
const KEY_SERVER_BEARER_TOKEN = 'beanlog.ai.server.bearerToken';
const KEY_TEMP_UNIT = 'beanlog.ai.tempUnit';
const KEY_MODEL_ID = 'beanlog.ai.server.modelId';

export type AiTempUnit = 'C' | 'F';

export type AiServerConfig = {
  host: string;
  port: string;
  bearerToken: string | null;
  modelId: string;
};

export const DEFAULT_AI_SERVER_HOST = '172.30.1.16';
export const DEFAULT_AI_SERVER_PORT = '8787';
export const DEFAULT_AI_MODEL_ID = 'codex-main';

function getStoredString(key: string): string | null {
  try {
    const value = localStorage.getItem(key)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

function setStoredString(key: string, value: string): void {
  try {
    const next = value.trim();
    if (!next) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, next);
  } catch {
    // ignore
  }
}

export function getAiServerHost(): string {
  return getStoredString(KEY_SERVER_HOST) ?? DEFAULT_AI_SERVER_HOST;
}

export function setAiServerHost(host: string): void {
  setStoredString(KEY_SERVER_HOST, host);
}

export function getAiServerPort(): string {
  return getStoredString(KEY_SERVER_PORT) ?? DEFAULT_AI_SERVER_PORT;
}

export function setAiServerPort(port: string): void {
  setStoredString(KEY_SERVER_PORT, port);
}

export function getAiBearerToken(): string | null {
  return getStoredString(KEY_SERVER_BEARER_TOKEN);
}

export function setAiBearerToken(token: string): void {
  setStoredString(KEY_SERVER_BEARER_TOKEN, token);
}

export function clearAiBearerToken(): void {
  try {
    localStorage.removeItem(KEY_SERVER_BEARER_TOKEN);
  } catch {
    // ignore
  }
}

export function getAiTempUnit(): AiTempUnit {
  try {
    const v = localStorage.getItem(KEY_TEMP_UNIT);
    return v === 'F' ? 'F' : 'C';
  } catch {
    return 'C';
  }
}

export function setAiTempUnit(unit: AiTempUnit): void {
  try {
    localStorage.setItem(KEY_TEMP_UNIT, unit);
  } catch {
    // ignore
  }
}

export function getAiModelId(): string {
  return getStoredString(KEY_MODEL_ID) ?? DEFAULT_AI_MODEL_ID;
}

export function setAiModelId(modelId: string): void {
  setStoredString(KEY_MODEL_ID, modelId);
}

export function getAiServerConfig(): AiServerConfig {
  return {
    host: getAiServerHost(),
    port: getAiServerPort(),
    bearerToken: getAiBearerToken(),
    modelId: getAiModelId(),
  };
}

export function buildAiServerBaseUrl(host: string, port: string): string {
  const nextHost = host.trim();
  const nextPort = port.trim();

  if (!nextHost) {
    throw new Error('AI server host is required.');
  }

  if (!nextPort) {
    throw new Error('AI server port is required.');
  }

  const numericPort = Number(nextPort);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error('AI server port must be between 1 and 65535.');
  }

  if (/^https?:\/\//i.test(nextHost)) {
    const url = new URL(nextHost);
    url.port = String(numericPort);
    return url.origin;
  }

  return `http://${nextHost}:${numericPort}`;
}

export function getAiServerBaseUrl(): string {
  return buildAiServerBaseUrl(getAiServerHost(), getAiServerPort());
}
