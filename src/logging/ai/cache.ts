import type { AiBrewPayload } from './serialize';
import type { AiGuidance } from './customServerClient';

const KEY_GUIDANCE_CACHE_PREFIX = 'beanlog.ai.guidance.';

type CachedAiGuidance = {
  signature: string;
  guidance: AiGuidance;
  savedAt: string;
};

export function buildAiGuidanceSignature(serverBaseUrl: string, modelId: string, payload: AiBrewPayload): string {
  return JSON.stringify({
    serverBaseUrl: serverBaseUrl.trim().toLowerCase(),
    modelId: modelId.trim(),
    payload,
  });
}

export function getCachedBrewGuidance(brewUid: string, signature: string): AiGuidance | null {
  try {
    const raw = localStorage.getItem(`${KEY_GUIDANCE_CACHE_PREFIX}${brewUid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAiGuidance;
    if (parsed.signature !== signature || !parsed.guidance) return null;
    return parsed.guidance;
  } catch {
    return null;
  }
}

export function setCachedBrewGuidance(brewUid: string, signature: string, guidance: AiGuidance): void {
  try {
    const payload: CachedAiGuidance = {
      signature,
      guidance,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(`${KEY_GUIDANCE_CACHE_PREFIX}${brewUid}`, JSON.stringify(payload));
  } catch {
    // ignore
  }
}
