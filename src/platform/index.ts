/**
 * Platform abstraction barrel export.
 *
 * Import from `../platform` to access camera, haptics, and platform detection.
 *
 * Examples:
 *   import { pickImageNative, hasNativeCamera } from '../platform';
 *   import { isNative, getPlatform } from '../platform';
 *   import { hapticTap } from '../platform';
 */
export { getPlatform, isNative } from './platform';
export type { Platform } from './platform';
export { pickImageNative, hasNativeCamera } from './camera';
export { hapticTap, hapticImpact } from './haptics';
export { addAppUrlOpenListener, getLaunchAppUrl } from './appLinks';
export { canPrintBrotherLabels, printBrotherLabels } from './brotherPrinter';
export { platformRequestJson } from './http';
export type { BrotherPrintLabel } from './brotherPrinter';
