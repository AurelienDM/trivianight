import { getSettings } from '../storage/settingsStorage.js';
import {
  DEFAULT_ANTHROPIC_MODEL,
  FALLBACK_ANTHROPIC_MODELS,
} from '../shared/settings.js';
import {
  apply429Cooldown,
  clipText,
  enqueueLlm,
  estimateTokens,
  LlmRateLimitError,
  parseRetryAfterMs,
  type LlmPurpose,
} from './llmQueue.js';

const MODELS_CACHE_TTL_MS = 5 * 60_000;
const MODELS_TIMEOUT_MS = 8_000;
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicNotConfiguredError extends Error {
  constructor(message = 'Anthropic API key not configured') {
    super(message);
    this.name = 'AnthropicNotConfiguredError';
  }
}

export class AnthropicWorkspaceRequiredError extends Error {
  readonly code = 'anthropic_workspace_required' as const;

  constructor(
    message = 'Anthropic API key requires a Workspace ID. Paste it in Settings (or set ANTHROPIC_WORKSPACE_ID).',
  ) {
    super(message);
    this.name = 'AnthropicWorkspaceRequiredError';
  }
}

export async function getAnthropicApiKey(): Promise<string> {
  const settings = await getSettings();
  const key = settings.anthropicApiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || '';
  if (!key) throw new AnthropicNotConfiguredError();
  return key;
}

export async function getAnthropicWorkspaceId(): Promise<string> {
  const settings = await getSettings();
  return settings.anthropicWorkspaceId?.trim() || process.env.ANTHROPIC_WORKSPACE_ID?.trim() || '';
}

export async function getResolvedAnthropicModel(): Promise<string> {
  const settings = await getSettings();
  const fromSettings = settings.anthropicModel?.trim();
  return fromSettings || DEFAULT_ANTHROPIC_MODEL;
}

/** Auth headers for all Anthropic API calls (Messages, models, validate). */
export async function anthropicAuthHeaders(apiKey?: string): Promise<Record<string, string>> {
  const key = apiKey ?? (await getAnthropicApiKey());
  const headers: Record<string, string> = {
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
  };
  const workspaceId = await getAnthropicWorkspaceId();
  if (workspaceId) {
    headers['anthropic-workspace-id'] = workspaceId;
  }
  return headers;
}

function looksLikeWorkspaceRequired(status: number, body: string): boolean {
  if (status !== 400) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes('workspace')
    && (lower.includes('not scoped')
      || lower.includes('workspace_id')
      || lower.includes('anthropic-workspace-id')
      || lower.includes('scoped to a workspace')
      || lower.includes('requires a workspace'))
  );
}

function throwIfWorkspaceRequired(status: number, body: string): void {
  if (looksLikeWorkspaceRequired(status, body)) {
    throw new AnthropicWorkspaceRequiredError(
      'Anthropic returned workspace_required (HTTP 400). Paste your Workspace ID in Settings → Anthropic, or set ANTHROPIC_WORKSPACE_ID.',
    );
  }
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Anthropic returned empty content');
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error('Anthropic response was not valid JSON');
}

async function upstreamChat(opts: {
  apiKey: string;
  system: string;
  user: string;
  temperature: number;
  model: string;
  maxTokens: number;
  purpose: LlmPurpose;
}): Promise<{ content: string }> {
  const sys = clipText(opts.system, opts.purpose === 'author' ? 2200 : 1200);
  const user = clipText(opts.user, opts.purpose === 'author' ? 4000 : 2000);
  const promptChars = sys.length + user.length;
  console.log(
    `[anthropic] tokens purpose=${opts.purpose} chars=${promptChars} ~tok=${estimateTokens(promptChars)} max_tokens=${opts.maxTokens}`,
  );

  const auth = await anthropicAuthHeaders(opts.apiKey);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      system: sys,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (res.status === 429) {
    const retryAfterMs = parseRetryAfterMs(res);
    apply429Cooldown(retryAfterMs);
    console.warn(`[anthropic] 429 purpose=${opts.purpose} cooldownMs=${retryAfterMs}`);
    throw new LlmRateLimitError(
      `Anthropic rate limited (429). Wait ~${Math.ceil(retryAfterMs / 1000)}s — not retrying automatically.`,
      retryAfterMs,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throwIfWorkspaceRequired(res.status, text);
    throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (data.usage) {
    console.log(
      `[anthropic] tokens purpose=${opts.purpose} prompt=${data.usage.input_tokens ?? '?'} completion=${data.usage.output_tokens ?? '?'}`,
    );
  }
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text' || typeof b.text === 'string')
    .map((b) => b.text ?? '')
    .join('\n');
  return { content: text };
}

export async function callAnthropicJson(opts: {
  system: string;
  user: string;
  temperature?: number;
  model?: string;
  maxTokens?: number;
  purpose?: LlmPurpose;
  apiKey?: string;
}): Promise<unknown> {
  const purpose = opts.purpose ?? 'grade';
  const maxTokens = opts.maxTokens ?? (purpose === 'author' ? 900 : purpose === 'validate' ? 16 : 120);
  const apiKey = opts.apiKey ?? (await getAnthropicApiKey());
  const model = opts.model ?? (await getResolvedAnthropicModel());

  const system =
    purpose === 'validate'
      ? opts.system
      : `${opts.system}\n\nRespond with a single JSON object only — no markdown fences.`;

  const { content } = await enqueueLlm(purpose, 'anthropic', () =>
    upstreamChat({
      apiKey,
      system,
      user: opts.user,
      temperature: opts.temperature ?? 0.4,
      model,
      maxTokens,
      purpose,
    }),
  );

  if (purpose === 'validate') {
    return { ok: true, content };
  }
  return extractJson(content);
}

interface ModelsCacheEntry {
  expiresAt: number;
  models: Array<{ id: string; name: string }>;
  source: 'api' | 'fallback';
}
let modelsCache: ModelsCacheEntry | null = null;

function looksLikeChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  if (!lower) return false;
  if (!lower.includes('claude')) return false;
  if (lower.includes('embed')) return false;
  return true;
}

async function upstreamListModels(apiKey: string): Promise<Array<{ id: string; name: string }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS);
  try {
    const auth = await anthropicAuthHeaders(apiKey);
    const res = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: auth,
      signal: controller.signal,
    });
    if (res.status === 429) {
      const retryAfterMs = parseRetryAfterMs(res);
      apply429Cooldown(retryAfterMs);
      console.warn(`[anthropic] 429 purpose=models cooldownMs=${retryAfterMs}`);
      throw new LlmRateLimitError(
        `Anthropic rate limited (429). Wait ~${Math.ceil(retryAfterMs / 1000)}s — not retrying automatically.`,
        retryAfterMs,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throwIfWorkspaceRequired(res.status, text);
      throw new Error(`Anthropic models HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: Array<{ id?: string; display_name?: string; name?: string }> };
    const list = Array.isArray(data.data) ? data.data : [];
    const models = list
      .map((m) => {
        const id = String(m.id ?? '').trim();
        if (!id || !looksLikeChatModel(id)) return null;
        return { id, name: String(m.display_name ?? m.name ?? id) };
      })
      .filter((m): m is { id: string; name: string } => !!m)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!models.length) throw new Error('No chat models in Anthropic response');
    return models;
  } finally {
    clearTimeout(timer);
  }
}

export async function listAnthropicModels(): Promise<{
  models: Array<{ id: string; name: string }>;
  source: 'api' | 'fallback';
  selected: string;
  error?: string;
}> {
  const selected = await getResolvedAnthropicModel();
  const now = Date.now();
  if (modelsCache && now < modelsCache.expiresAt) {
    console.log(`[anthropic] cache hit purpose=models source=${modelsCache.source}`);
    return { models: modelsCache.models, source: modelsCache.source, selected };
  }

  try {
    const apiKey = await getAnthropicApiKey();
    const models = await enqueueLlm('models', 'anthropic', () => upstreamListModels(apiKey));
    const ids = new Set(models.map((m) => m.id));
    const merged = [...models];
    for (const fb of FALLBACK_ANTHROPIC_MODELS) {
      if (!ids.has(fb.id)) merged.push(fb);
    }
    if (!ids.has(selected) && !merged.some((m) => m.id === selected)) {
      merged.unshift({ id: selected, name: selected });
    }
    modelsCache = { expiresAt: now + MODELS_CACHE_TTL_MS, models: merged, source: 'api' };
    return { models: merged, source: 'api', selected };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Models list failed';
    console.warn(`[anthropic] models fallback: ${message}`);
    const models = [...FALLBACK_ANTHROPIC_MODELS];
    if (!models.some((m) => m.id === selected)) {
      models.unshift({ id: selected, name: selected });
    }
    modelsCache = { expiresAt: now + MODELS_CACHE_TTL_MS, models, source: 'fallback' };
    return { models, source: 'fallback', selected, error: message };
  }
}

export async function validateAnthropicApiKey(apiKey: string): Promise<{
  ok: boolean;
  error?: string;
  code?: string;
}> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: 'No API key configured' };
  try {
    await callAnthropicJson({
      system: 'Reply with {}',
      user: '{}',
      temperature: 0,
      maxTokens: 16,
      purpose: 'validate',
      apiKey: key,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof AnthropicWorkspaceRequiredError) {
      return { ok: false, error: err.message, code: err.code };
    }
    if (err instanceof LlmRateLimitError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Validate failed' };
  }
}
