/**
 * Unified camera / image-picker abstraction.
 *
 * - **Native (Capacitor):** Uses `@capacitor/camera` which shows the OS-native
 *   camera / gallery picker and returns a data URL, converted to a `File`.
 * - **Web:** Returns `null` — the caller should fall back to an `<input type="file">`.
 */
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

/**
 * Prompt the user to take a photo or pick from gallery (native only).
 *
 * Returns a `File` on success, or `null` if cancelled.
 * On web, always returns `null` — callers should use file input instead.
 */
export async function pickImageNative(): Promise<File | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Prompt, // shows "Camera" / "Gallery" action sheet
      quality: 90,
      width: 4096, // cap max dimension to save memory
      correctOrientation: true,
    });

    if (!photo.dataUrl) return null;

    // Convert data URL → File object so the rest of the pipeline stays unchanged
    const res = await fetch(photo.dataUrl);
    const blob = await res.blob();
    const ext = photo.format ?? 'jpeg';
    return new File([blob], `capture.${ext}`, { type: `image/${ext}` });
  } catch {
    // User cancelled or permission denied — treat as no-op
    return null;
  }
}

/**
 * Whether native camera picking is available.
 * Use this to decide between the native camera button vs the web file input.
 */
export function hasNativeCamera(): boolean {
  return Capacitor.isNativePlatform();
}

