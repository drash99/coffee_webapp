import type { AiBrewPayload } from './serialize';
import { buildAiServerBaseUrl, type AiServerConfig } from './prefs';
import { platformRequestJson } from '../../platform';

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

export type AiServerHealth = {
  status?: string;
  server?: string;
  version?: string;
};

export type AiServerModel = {
  id: string;
  object?: string;
  owned_by?: string;
};

type ServerInputMessage = {
  role: 'system' | 'user' | 'assistant';
  content: Array<{ type: 'input_text'; text: string }>;
};

type ServerResponsePayload = {
  id?: string;
  status?: string;
  model?: string;
  feature?: string;
  output_text?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

const BREW_GUIDANCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    diagnosis: { type: 'string' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          details: { type: 'string' },
        },
        required: ['title', 'details'],
      },
    },
    targets: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ratio: { type: 'string' },
        water_temp: { type: 'string' },
        brew_time: { type: 'string' },
      },
      required: ['ratio', 'water_temp', 'brew_time'],
    },
  },
  required: ['summary', 'diagnosis', 'suggestions', 'targets'],
} as const;

function getBaseUrl(config: Pick<AiServerConfig, 'host' | 'port'>): string {
  return buildAiServerBaseUrl(config.host, config.port);
}

function buildHeaders(config: Pick<AiServerConfig, 'bearerToken'>, json = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  const token = config.bearerToken?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function parseErrorMessage(
  status: number,
  text: string,
  json: { error?: { message?: string } } | Record<string, unknown> | null,
): string {
  const maybeError = (json as { error?: { message?: string } } | null)?.error;
  const message = maybeError?.message?.trim();
  if (message) return message;
  return text.trim() || `AI server error: ${status}`;
}

function formatRecipeSnippet(text: string | null | undefined): string {
  const value = text?.trim();
  if (!value) return '(empty)';
  return value;
}

function buildRecipeHighlights(payload: AiBrewPayload): string {
  const lines = [
    'Important field guide:',
    '- current_brew.recipe and past_brews[*].recipe are freeform user-entered brew recipe text.',
    '- recipe may contain brew method, pours, timings, ratios, agitation notes, or other workflow details.',
    '- Treat recipe as a primary input when diagnosing what to change next time.',
    '',
    'Current brew recipe:',
    formatRecipeSnippet(payload.current_brew.recipe),
  ];

  if (payload.past_brews.length > 0) {
    lines.push('', 'Recent same-bean recipes:');
    payload.past_brews.slice(0, 5).forEach((brew, index) => {
      lines.push(`${index + 1}. ${brew.brew_date}: ${formatRecipeSnippet(brew.recipe)}`);
    });
  }

  return lines.join('\n');
}

function buildBrewGuidanceMessages(payload: AiBrewPayload): ServerInputMessage[] {
  const systemPrompt =
    'You are a specialty coffee brewing coach. ' +
    'You receive JSON describing a brew, its bean, and a few past brews with the same bean, plus user_prefs. ' +
    'The recipe fields are important: current_brew.recipe and past_brews[*].recipe are freeform brew recipe notes entered by the user. ' +
    'Read them carefully and use them when diagnosing technique, flow, ratio, or process issues. ' +
    'Return concise, practical guidance focused on what to change next time. ' +
    'Use user_prefs.language for your output language (en-us or ko-kr). ' +
    'When mentioning temperatures, use user_prefs.tempUnit for display (convert from °C internally if needed). ' +
    'Prioritise 3–5 concrete suggestions, not generic coffee theory.';

  const userPrompt = [
    buildRecipeHighlights(payload),
    '',
    'Here is the brew context as JSON:',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    'Respond ONLY with JSON in this exact shape:',
    '{',
    '  "summary": string,',
    '  "diagnosis": string,',
    '  "suggestions": [ { "title": string, "details": string } ],',
    '  "targets": { "ratio": string, "water_temp": string, "brew_time": string }',
    '}',
    '',
    'If a target is not needed, return an empty string for that field.',
    '',
    'Do not include any extra commentary outside of the JSON.',
  ].join('\n');

  return [
    {
      role: 'system',
      content: [{ type: 'input_text', text: systemPrompt }],
    },
    {
      role: 'user',
      content: [{ type: 'input_text', text: userPrompt }],
    },
  ];
}

function parseGuidanceOutput(text: string): AiGuidance {
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

export async function requestBrewGuidance(
  config: AiServerConfig,
  payload: AiBrewPayload,
): Promise<AiGuidance> {
  const response = await platformRequestJson<ServerResponsePayload>({
    url: `${getBaseUrl(config)}/v1/responses`,
    method: 'POST',
    headers: buildHeaders(config, true) as Record<string, string>,
    data: {
      model: config.modelId,
      feature: 'brew_guidance',
      stream: false,
      max_output_tokens: 900,
      input: buildBrewGuidanceMessages(payload),
      response_format: {
        type: 'json_schema',
        name: 'brew_guidance',
        schema: BREW_GUIDANCE_SCHEMA,
      },
      metadata: {
        app_feature: 'brew_guidance',
        app_name: 'beanlog',
        language: payload.user_prefs.language,
      },
    },
  });

  if (!response.ok) {
    throw new Error(parseErrorMessage(response.status, response.text, response.data));
  }

  const json = response.data as ServerResponsePayload | null;
  if (json?.status && json.status !== 'completed' && !json.output_text?.trim()) {
    throw new Error(json.error?.message || `AI server response status: ${json.status}`);
  }

  const text = json?.output_text?.trim() ?? '';
  if (!text) {
    throw new Error('Empty response from AI server');
  }

  return parseGuidanceOutput(text);
}

export async function fetchAiServerHealth(config: Pick<AiServerConfig, 'host' | 'port' | 'bearerToken'>): Promise<AiServerHealth> {
  const response = await platformRequestJson<AiServerHealth>({
    url: `${getBaseUrl(config)}/v1/health`,
    headers: buildHeaders(config) as Record<string, string>,
  });

  if (!response.ok) {
    throw new Error(parseErrorMessage(response.status, response.text, response.data));
  }

  return response.data ?? {};
}

export async function fetchAiServerModels(config: Pick<AiServerConfig, 'host' | 'port' | 'bearerToken'>): Promise<AiServerModel[]> {
  const response = await platformRequestJson<{ data?: AiServerModel[] }>({
    url: `${getBaseUrl(config)}/v1/models`,
    headers: buildHeaders(config) as Record<string, string>,
  });

  if (!response.ok) {
    throw new Error(parseErrorMessage(response.status, response.text, response.data));
  }

  const json = response.data ?? {};
  return (json.data ?? []).filter((model) => Boolean(model.id?.trim()));
}
