import {
  DEFAULT_AI_DRAFT_EFFORT,
  DEFAULT_BULK_MODEL,
  DEFAULT_MISTRAL_MODEL,
  DEFAULT_SINGLE_MODEL,
  type AppSettingsStored,
} from '../shared/settings.js';

export type AuthorJob = 'bulk' | 'single';

export function clampDraftEffort(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_AI_DRAFT_EFFORT;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Slider position changes temperature and prompt strictness, not the model. */
export function draftPassForEffort(effort: unknown): { temperature: number; instruction: string } {
  const n = clampDraftEffort(effort);
  const temperature = Math.round((0.85 - (n / 100) * 0.65) * 100) / 100;
  const instruction = n < 34
    ? 'PASS: faster drafts. Keep questions lively and short. Prefer familiar facts over obscure ones.'
    : n < 67
      ? 'PASS: balanced. Clear prompts, fair pub-quiz difficulty, checkable answers.'
      : 'PASS: stricter. Unambiguous wording, widely checkable facts, no trick questions, no ambiguous names. Set needsFactCheck true unless the fact is commonplace.';
  return { temperature, instruction };
}

/**
 * Explicit job wins. A missing job treats a one-question request as single
 * (regenerate) and anything larger as bulk.
 */
export function resolveAuthorJob(req: { job?: unknown; count?: unknown }): AuthorJob {
  if (req.job === 'single' || req.job === 'bulk') return req.job;
  const count = Number(req.count ?? 1);
  return Number.isFinite(count) && count <= 1 ? 'single' : 'bulk';
}

export function modelForAuthorJob(
  settings: Pick<AppSettingsStored, 'aiProvider' | 'bulkModel' | 'singleModel' | 'anthropicModel' | 'mistralModel'>,
  job: AuthorJob,
): { provider: 'anthropic' | 'mistral'; model: string } {
  const provider = settings.aiProvider === 'anthropic' ? 'anthropic' : 'mistral';
  if (provider === 'mistral') {
    return {
      provider,
      model: (settings.mistralModel && settings.mistralModel.trim()) || DEFAULT_MISTRAL_MODEL,
    };
  }
  const bulk = (settings.bulkModel && settings.bulkModel.trim()) || DEFAULT_BULK_MODEL;
  const single = (settings.singleModel && settings.singleModel.trim())
    || (settings.anthropicModel && settings.anthropicModel.trim())
    || DEFAULT_SINGLE_MODEL;
  return { provider, model: job === 'bulk' ? bulk : single };
}
