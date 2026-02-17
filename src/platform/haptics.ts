/**
 * Haptic feedback abstraction.
 *
 * Provides light tactile feedback on native platforms (tap buttons, star ratings, etc.).
 * No-ops silently on web.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

/** Light haptic tap — use on button presses, toggles, star rating changes. */
export async function hapticTap(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Silently ignore — haptics is a nice-to-have
  }
}

/** Medium haptic impact — use on destructive actions (delete confirm), saves. */
export async function hapticImpact(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch {
    // Silently ignore
  }
}

