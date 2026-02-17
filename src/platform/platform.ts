/**
 * Platform detection utilities.
 *
 * Uses Capacitor's runtime check to distinguish between:
 * - **web**: running in a regular browser (desktop or mobile Safari/Chrome)
 * - **native**: running inside a Capacitor WebView shell (iOS / Android app)
 */
import { Capacitor } from '@capacitor/core';

export type Platform = 'web' | 'ios' | 'android';

/** Returns the current platform: 'ios', 'android', or 'web'. */
export function getPlatform(): Platform {
  const p = Capacitor.getPlatform();
  if (p === 'ios') return 'ios';
  if (p === 'android') return 'android';
  return 'web';
}

/** True when running inside a native Capacitor shell (iOS or Android). */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

