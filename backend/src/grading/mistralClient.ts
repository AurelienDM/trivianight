import { getSettings } from '../storage/settingsStorage.js';
import {
  DEFAULT_MISTRAL_MODEL,
  FALLBACK_MISTRAL_MODELS,
} from '../shared/settings.js';
import {
  apply429Cooldown,
  clipText,
  enqueueLlm,
  estimateTokens,
  getCachedGradeSuggestion,
  getLlmUsage,
  getMistralUsage,
  gradeCacheKey,
  LlmRateLimitError,
  MistralRateLimitError,
  parseRetryAfterMs,
  setCachedGradeSuggestion,
  type LlmPurpose,
} from './llmQueue.js';

export type MistralPurpose = LlmPurpose;

export class MistralNotConfiguredError extends Error {
  constructor(message = 'Mistral API key not configured') {
    super(message);
    this.name = 'MistralNotConfiguredError';
  }
}

export {
  getCachedGradeSuggestion,
  getMistralUsage,
  getLlmUsage,
  gradeCacheKey,
  LlmRateLimitError,
  MistralRateLimitError,
  setCachedGradeSuggestion,
};

export async function getMistralApiKey(): Promise<string> {
  const settings = await getSettings();
  const key = settings.mistralApiKey?.trim() || process.env.MISTRAL_API_KEY?.trim() || '';
  if (!key) throw new MistralNotConfiguredError();
  return key;
}

export async function getResolvedMistralModel(): Promise<string> {
  const settings = await getSettings();
  const fromSettings = settings.mistralModel?.trim();
  return fromSettings || DEFAULT_MISTRAL_MODEL;
}

const MODELS_CACHE_TTL_MS = 5 * 60_000;
const MODELS_TIMEOUT_MS = 8_000;

async function upstreamChat(opts: {
  apiKey: string;
  system: string;
  user: string;
  temperature: number;
  model: string;
  maxTokens: number;
  jsonMode: boolean;
  purpose: LlmPurpose;
}): Promise<{ content: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const sys = clipText(opts.system, opts.purpose === 'author' ? 2200 : 1200);
  const user = clipText(opts.user, opts.purpose === 'author' ? 4000 : 2000);
  const promptChars = sys.length + user.length;
  console.log(
    `[mistral] tokens purpose=${opts.purpose} chars=${promptChars} ~tok=${estimateTokens(promptChars)} max_tokens=${opts.maxTokens}`,
  );

  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const retryAfterMs = parseRetryAfterMs(res);
    apply429Cooldown(retryAfterMs);
    console.warn(`[mistral] 429 purpose=${opts.purpose} cooldownMs=${retryAfterMs}`);
    throw new MistralRateLimitError(
      `Mistral rate limited (429). Wait ~${Math.ceil(retryAfterMs / 1000)}s — not retrying automatically.`,
      retryAfterMs,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mistral HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (data.usage) {
    console.log(
      `[mistral] tokens purpose=${opts.purpose} prompt=${data.usage.prompt_tokens ?? '?'} completion=${data.usage.completion_tokens ?? '?'}`,
    );
  }
  return { content: data.choices?.[0]?.message?.content ?? '', usage: data.usage };
}

export async function callMistralJson(opts: {
  system: string;
  user: string;
  temperature?: number;
  model?: string;
  maxTokens?: number;
  purpose?: LlmPurpose;
  apiKey?: string;
}): Promise<unknown> {
  const purpose = opts.purpose ?? 'grade';
  const maxTokens = opts.maxTokens ?? (purpose === 'author' ? 900 : purpose === 'validate' ? 1 : 120);
  const apiKey = opts.apiKey ?? (await getMistralApiKey());
  const model = opts.model ?? (await getResolvedMistralModel());

  const { content } = await enqueueLlm(purpose, 'mistral', () =>
    upstreamChat({
      apiKey,
      system: opts.system,
      user: opts.user,
      temperature: opts.temperature ?? 0.4,
      model,
      maxTokens,
      jsonMode: purpose !== 'validate',
      purpose,
    }),
  );

  if (purpose === 'validate') {
    return { ok: true, content };
  }
  if (!content.trim()) throw new Error('Mistral returned empty content');
  return JSON.parse(content);
}

function looksLikeChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  if (!lower) return false;
  if (lower.includes('embed')) return false;
  if (lower.includes('moderation')) return false;
  if (lower.includes('ocr')) return false;
  if (lower.includes('transcri')) return false;
  return true;
}

async function upstreamListModels(apiKey: string): Promise<Array<{ id: string; name: string }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.mistral.ai/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (res.status === 429) {
      const retryAfterMs = parseRetryAfterMs(res);
      apply429Cooldown(retryAfterMs);
      console.warn(`[mistral] 429 purpose=models cooldownMs=${retryAfterMs}`);
      throw new MistralRateLimitError(
        `Mistral rate limited (429). Wait ~${Math.ceil(retryAfterMs / 1000)}s — not retrying automatically.`,
        retryAfterMs,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Mistral models HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
    const list = Array.isArray(data.data) ? data.data : [];
    const models = list
      .map((m) => {
        const id = String(m.id ?? '').trim();
        if (!id || !looksLikeChatModel(id)) return null;
        return { id, name: String(m.name ?? id) };
      })
      .filter((m): m is { id: string; name: string } => !!m)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!models.length) throw new Error('No chat models in Mistral response');
    return models;
  } finally {
    clearTimeout(timer);
  }
}

interface ModelsCacheEntry {
  expiresAt: number;
  models: Array<{ id: string; name: string }>;
  source: 'api' | 'fallback';
}
let modelsCache: ModelsCacheEntry | null = null;

/** List chat models via queue; on failure/429 return curated fallback (still 200 to UI). */
export async function listMistralModels(): Promise<{
  models: Array<{ id: string; name: string }>;
  source: 'api' | 'fallback';
  selected: string;
  error?: string;
}> {
  const selected = await getResolvedMistralModel();
  const now = Date.now();
  if (modelsCache && now < modelsCache.expiresAt) {
    console.log(`[mistral] cache hit purpose=models source=${modelsCache.source}`);
    return { models: modelsCache.models, source: modelsCache.source, selected };
  }

  try {
    const apiKey = await getMistralApiKey();
    const models = await enqueueLlm('models', 'mistral', () => upstreamListModels(apiKey));
    const ids = new Set(models.map((m) => m.id));
    const merged = [...models];
    for (const fb of FALLBACK_MISTRAL_MODELS) {
      if (!ids.has(fb.id)) merged.push(fb);
    }
    if (!ids.has(selected) && !merged.some((m) => m.id === selected)) {
      merged.unshift({ id: selected, name: selected });
    }
    modelsCache = { expiresAt: now + MODELS_CACHE_TTL_MS, models: merged, source: 'api' };
    return { models: merged, source: 'api', selected };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Models list failed';
    console.warn(`[mistral] models fallback: ${message}`);
    const models = [...FALLBACK_MISTRAL_MODELS];
    if (!models.some((m) => m.id === selected)) {
      models.unshift({ id: selected, name: selected });
    }
    modelsCache = { expiresAt: now + MODELS_CACHE_TTL_MS, models, source: 'fallback' };
    return { models, source: 'fallback', selected, error: message };
  }
}

/** Tiny authenticated ping — goes through the same queue (max_tokens: 1). */
export async function validateMistralApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: 'No API key configured' };
  try {
    await callMistralJson({
      system: 'Reply with {}',
      user: '{}',
      temperature: 0,
      maxTokens: 1,
      purpose: 'validate',
      apiKey: key,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof LlmRateLimitError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Validate failed' };
  }
}
