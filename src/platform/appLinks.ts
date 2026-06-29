import { App as CapacitorApp } from '@capacitor/app';
import { isNative } from './platform';

export async function getLaunchAppUrl(): Promise<string | null> {
  if (!isNative()) return null;
  try {
    return (await CapacitorApp.getLaunchUrl())?.url ?? null;
  } catch {
    return null;
  }
}

export async function addAppUrlOpenListener(onUrl: (url: string) => void): Promise<() => void> {
  if (!isNative()) return () => {};
  try {
    const handle = await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      const next = url?.trim();
      if (next) onUrl(next);
    });
    return () => {
      void handle.remove();
    };
  } catch {
    return () => {};
  }
}
