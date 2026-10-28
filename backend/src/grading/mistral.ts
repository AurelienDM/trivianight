import type { GradeResult, GradeVerdict } from '../shared/types.js';
import { callAiJson, isGradingAssistAvailable } from './aiClient.js';
import {
  getCachedGradeSuggestion,
  gradeCacheKey,
  LlmRateLimitError,
  MistralRateLimitError,
  setCachedGradeSuggestion,
} from './llmQueue.js';

export interface MistralSuggestion {
  verdict: GradeVerdict;
  confidence: number;
  reason: string;
  /** Always requires host confirmation — never applied silently */
  requiresHostConfirmation: true;
  matchedAnswer?: string;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function shouldAskAi(deterministic: GradeResult): boolean {
  if (deterministic.verdict === 'review') return true;
  if (deterministic.confidence < 0.85) return true;
  // Clear high-confidence outcomes never hit the API
  return false;
}

/**
 * Ask the active AI provider for a grading suggestion on ambiguous answers.
 * Never auto-applies — host must confirm.
 * No-ops when key missing, grading assist disabled, or deterministic is already clear.
 */
export async function suggestGradeWithMistral(input: {
  given: string;
  acceptedAnswers: string[];
  prompt: string;
  deterministic: GradeResult;
}): Promise<MistralSuggestion | null> {
  if (!(await isGradingAssistAvailable())) return null;

  if (!shouldAskAi(input.deterministic)) {
    return null;
  }
  if (!input.given.trim()) return null;

  const cacheKey = gradeCacheKey(input.given, input.acceptedAnswers);
  const cached = getCachedGradeSuggestion(cacheKey) as MistralSuggestion | null;
  if (cached && cached.requiresHostConfirmation) {
    return cached;
  }

  const system = `Grade pub-quiz answers. JSON only:
{"verdict":"correct"|"incorrect"|"review","confidence":0-1,"reason":"short","matchedAnswer":"optional"}
Fair to typos; prefer review if unsure; never invent accepted answers.`;

  const accepted = input.acceptedAnswers.slice(0, 8).map((a) => clip(a, 80));
  const user = `Q: ${clip(input.prompt, 220)}
Accepted: ${JSON.stringify(accepted)}
Given: ${JSON.stringify(clip(input.given, 160))}
Det: ${input.deterministic.verdict}/${input.deterministic.confidence.toFixed(2)}/${clip(input.deterministic.reason ?? '', 40)}`;

  try {
    const parsed = (await callAiJson({
      system,
      user,
      temperature: 0,
      maxTokens: 120,
      purpose: 'grade',
    })) as {
      verdict?: GradeVerdict;
      confidence?: number;
      reason?: string;
      matchedAnswer?: string;
    };
    if (!parsed.verdict || !['correct', 'incorrect', 'review'].includes(parsed.verdict)) {
      return null;
    }
    const suggestion: MistralSuggestion = {
      verdict: parsed.verdict,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      reason: clip(parsed.reason ?? 'AI suggestion', 160),
      matchedAnswer: parsed.matchedAnswer ? clip(String(parsed.matchedAnswer), 120) : undefined,
      requiresHostConfirmation: true,
    };
    setCachedGradeSuggestion(cacheKey, suggestion);
    return suggestion;
  } catch (err) {
    if (err instanceof LlmRateLimitError) throw err;
    console.warn('AI grading error', err);
    return null;
  }
}

export { MistralRateLimitError, LlmRateLimitError };
