import { Router } from 'express';
import { requireHostPasscode } from '../middleware/requireHostPasscode.js';
import {
  AiNotConfiguredError,
  authorQuestionsWithMistral,
  LlmRateLimitError,
  MistralNotConfiguredError,
  MistralRateLimitError,
  type AuthorRequest,
} from '../ai/authorQuestions.js';
import { getPublicSettings } from '../storage/settingsStorage.js';
import { getActiveAiModel, resolveAiProvider } from '../grading/aiClient.js';
import { AnthropicWorkspaceRequiredError } from '../grading/anthropicClient.js';
import { getLlmUsage } from '../grading/llmQueue.js';
import { addManyToBank } from '../storage/questionBank.js';
import { attachMediaForBankItem } from '../services/bankMediaAttach.js';

const router = Router();

router.get('/status', async (_req, res) => {
  const s = await getPublicSettings();
  const provider = await resolveAiProvider();
  res.json({
    provider,
    configured: s.authoringAvailable,
    gradingEnabled: s.mistralEnabled && s.authoringAvailable,
    authoringAvailable: s.authoringAvailable,
    model: s.activeModel || (await getActiveAiModel()),
    bulkModel: s.bulkModel,
    singleModel: s.singleModel,
    aiDraftEffort: s.aiDraftEffort,
    mistralKeyConfigured: s.mistralKeyConfigured,
    anthropicKeyConfigured: s.anthropicKeyConfigured,
    anthropicWorkspaceConfigured: s.anthropicWorkspaceConfigured,
    usage: getLlmUsage(),
  });
});

router.post('/author', requireHostPasscode, async (req, res) => {
  const body = req.body as AuthorRequest;
  try {
    const result = await authorQuestionsWithMistral(body);
    let mediaAttached = 0;
    let bankAdded = 0;
    let bankSkipped = 0;
    // Enrich with logo/Deezer media, then persist into the host question bank
    try {
      const enriched = [];
      for (const s of result.suggestions) {
        const attach = await attachMediaForBankItem({
          type: s.type,
          prompt: s.prompt,
          acceptedAnswers: s.acceptedVariants,
          correctAnswer: s.correctAnswer,
          mediaSearchTerms: s.mediaSearchTerms,
          notes: s.hostNotes,
        });
        if (attach.attached) mediaAttached += 1;
        enriched.push({
          prompt: s.prompt,
          type: s.type,
          acceptedAnswers: s.acceptedVariants,
          correctAnswer: s.correctAnswer,
          points: s.points,
          choices: s.choices,
          notes: attach.notes ?? s.hostNotes,
          mediaSearchTerms: s.mediaSearchTerms,
          media: attach.media,
          source: 'ai-author',
          roundTitle: body.theme,
          category: body.category,
        });
        // Also surface media on the suggestion for Editor publish paths
        if (attach.media) {
          (s as { media?: unknown }).media = attach.media;
        }
        if (attach.notes) s.hostNotes = attach.notes;
      }
      const bankResult = await addManyToBank(enriched);
      bankAdded = bankResult.added;
      bankSkipped = bankResult.skipped;
    } catch (bankErr) {
      console.warn('[bank] auto-add after author failed', bankErr);
    }
    res.json({
      ...result,
      mediaAttached,
      bankAdded,
      bankSkipped,
    });
  } catch (err) {
    if (err instanceof AnthropicWorkspaceRequiredError) {
      return res.status(400).json({
        error: err.message,
        code: 'anthropic_workspace_required',
        hint: 'Paste your Anthropic Workspace ID in Settings → Anthropic (or set ANTHROPIC_WORKSPACE_ID). Unscoped keys require the anthropic-workspace-id header.',
      });
    }
    if (err instanceof AiNotConfiguredError || err instanceof MistralNotConfiguredError) {
      const provider = err instanceof AiNotConfiguredError ? err.provider : 'mistral';
      const label = provider === 'anthropic' ? 'Anthropic' : 'Mistral';
      return res.status(400).json({
        error: `${label} API key not configured`,
        code: 'ai_not_configured',
        provider,
        hint: `Add an ${label} API key in Settings (or set the env key). Authoring never runs without a key for the selected provider.`,
      });
    }
    if (err instanceof LlmRateLimitError || err instanceof MistralRateLimitError) {
      return res.status(429).json({
        error: err.message,
        code: 'rate_limited',
        retryAfterMs: err.retryAfterMs,
        hint: 'Local queue / provider 429 — wait, then try once. No automatic retries.',
      });
    }
    console.warn('AI author failed', err);
    res.status(502).json({
      error: err instanceof Error ? err.message : 'AI request failed',
      code: 'ai_error',
    });
  }
});

export default router;
