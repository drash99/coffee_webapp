import type { AiBrewPayload } from './serialize';

export type AiSuggestion = {
  title: string;
  details: string;
};

export type AiTargets = {
  ratio?: string;
  water_temp?: string;
  brew_time?: string;
};

export type AiGuidance = {
  summary: string;
  diagnosis: string;
  suggestions: AiSuggestion[];
  targets?: AiTargets;
  rawText?: string;
};

type GeminiContent = {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
};

export async function requestBrewGuidance(
  apiKey: string,
  modelId: string,
  payload: AiBrewPayload,
): Promise<AiGuidance> {
  const systemPrompt =
    'You are a specialty coffee brewing coach. ' +
    'You receive JSON describing a brew, its bean, and a few past brews with the same bean, plus user_prefs. ' +
    'Return concise, practical guidance focused on what to change next time. ' +
    'Use user_prefs.language for your output language (en-us or ko-kr). ' +
    'When mentioning temperatures, use user_prefs.tempUnit for display (convert from °C internally if needed). ' +
    'Prioritise 3–5 concrete suggestions, not generic coffee theory.';

  const userPrompt = [
    'Here is the brew context as JSON:',
    '```json',
    JSON.stringify(payload),
    '```',
    '',
    'Respond ONLY with JSON in this exact shape:',
    '{',
    '  "summary": string,',
    '  "diagnosis": string,',
    '  "suggestions": [ { "title": string, "details": string } ],',
    '  "targets": { "ratio"?: string, "water_temp"?: string, "brew_time"?: string }',
    '}',
    '',
    'Do not include any extra commentary outside of the JSON.',
  ].join('\n');

  const body = {
    contents: [
      { role: 'user', parts: [{ text: systemPrompt }] } as GeminiContent,
      { role: 'user', parts: [{ text: userPrompt }] } as GeminiContent,
    ],
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelId,
    )}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Gemini error: ${res.status}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text =
    json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')?.trim() ??
    '';

  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  let parsed: unknown;
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      summary: text,
      diagnosis: '',
      suggestions: [],
      rawText: text,
    };
  }

  const obj = parsed as {
    summary?: string;
    diagnosis?: string;
    suggestions?: Array<{ title?: string; details?: string }>;
    targets?: AiTargets;
  };

  return {
    summary: obj.summary || '',
    diagnosis: obj.diagnosis || '',
    suggestions:
      obj.suggestions
        ?.map((s) => ({
          title: s.title || '',
          details: s.details || '',
        }))
        .filter((s) => s.title || s.details) ?? [],
    targets: obj.targets,
    rawText: text,
  };
}
