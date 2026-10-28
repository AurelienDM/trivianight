import { getSettings } from '../storage/settingsStorage.js';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_MISTRAL_MODEL,
  type AiProvider,
} from '../shared/settings.js';
import { modelForAuthorJob, type AuthorJob } from '../ai/authorRouting.js';
import { callAnthropicJson, getResolvedAnthropicModel } from './anthropicClient.js';
import { callMistralJson, getResolvedMistralModel } from './mistralClient.js';
import type { LlmPurpose } from './llmQueue.js';

export class AiNotConfiguredError extends Error {
  readonly provider: AiProvider;

  constructor(provider: AiProvider, message?: string) {
    super(message ?? `${provider === 'anthropic' ? 'Anthropic' : 'Mistral'} API key not configured`);
    this.name = 'AiNotConfiguredError';
    this.provider = provider;
  }
}

export async function resolveAiProvider(): Promise<AiProvider> {
  const settings = await getSettings();
  return settings.aiProvider === 'anthropic' ? 'anthropic' : 'mistral';
}

export async function getActiveAiModel(): Promise<string> {
  const provider = await resolveAiProvider();
  if (provider === 'anthropic') {
    return (await getResolvedAnthropicModel()) || DEFAULT_ANTHROPIC_MODEL;
  }
  return (await getResolvedMistralModel()) || DEFAULT_MISTRAL_MODEL;
}

async function assertProviderConfigured(provider: AiProvider): Promise<void> {
  const settings = await getSettings();
  if (provider === 'anthropic') {
    const key = settings.anthropicApiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || '';
    if (!key) throw new AiNotConfiguredError('anthropic');
    return;
  }
  const key = settings.mistralApiKey?.trim() || process.env.MISTRAL_API_KEY?.trim() || '';
  if (!key) throw new AiNotConfiguredError('mistral');
}

/**
 * JSON chat via the active Settings provider + model (shared rate-limit queue).
 */
export async function callAiJson(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  purpose?: LlmPurpose;
  /** Authoring only. Bulk → Haiku, single → Sonnet, when Anthropic is the provider. */
  job?: AuthorJob;
}): Promise<unknown> {
  const provider = await resolveAiProvider();
  await assertProviderConfigured(provider);
  if (provider === 'anthropic') {
    let model: string | undefined;
    if (opts.purpose === 'author' || opts.job) {
      const settings = await getSettings();
      model = modelForAuthorJob(settings, opts.job ?? 'bulk').model;
    }
    return callAnthropicJson({ ...opts, model });
  }
  return callMistralJson(opts);
}

export async function isAuthoringAvailable(): Promise<boolean> {
  const settings = await getSettings();
  const provider = settings.aiProvider === 'anthropic' ? 'anthropic' : 'mistral';
  if (provider === 'anthropic') {
    return !!(settings.anthropicApiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
  }
  return !!(settings.mistralApiKey?.trim() || process.env.MISTRAL_API_KEY?.trim());
}

export async function isGradingAssistAvailable(): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.mistralEnabled) return false;
  return isAuthoringAvailable();
}
