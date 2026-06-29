import { CapacitorHttp } from '@capacitor/core';
import { isNative } from './platform';

export type PlatformHttpOptions = {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  data?: unknown;
};

export type PlatformJsonResponse<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  text: string;
};

function parseJsonText<T>(text: string): T | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function platformRequestJson<T>({
  url,
  method = 'GET',
  headers,
  data,
}: PlatformHttpOptions): Promise<PlatformJsonResponse<T>> {
  if (isNative()) {
    const response = await CapacitorHttp.request({
      url,
      method,
      headers,
      data,
      responseType: 'text',
    });

    const text =
      typeof response.data === 'string'
        ? response.data
        : response.data == null
          ? ''
          : JSON.stringify(response.data);

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data: parseJsonText<T>(text),
      text,
    };
  }

  const response = await fetch(url, {
    method,
    headers,
    body: data == null ? undefined : JSON.stringify(data),
  });
  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    data: parseJsonText<T>(text),
    text,
  };
}
