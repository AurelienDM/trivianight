import type { QuestionType } from '../shared/types.js';
import {
  answerLeaksInPrompt,
  isDuplicateQuestion,
  looksLikeMultipleChoicePrompt,
  normalizeChoices,
} from '../shared/questionNormalize.js';
import { AiNotConfiguredError, callAiJson } from '../grading/aiClient.js';
import { clampDraftEffort, draftPassForEffort, modelForAuthorJob, resolveAuthorJob, type AuthorJob } from './authorRouting.js';
import { getSettings } from '../storage/settingsStorage.js';
import { LlmRateLimitError, MistralRateLimitError } from '../grading/llmQueue.js';
import { MistralNotConfiguredError } from '../grading/mistralClient.js';

export type AuthorDifficulty = 'easy' | 'medium' | 'hard';

export interface ExistingQuestionRef {
  prompt: string;
  acceptedAnswers?: string[];
  correctAnswer?: string;
  type?: string;
}

export interface AuthorRequest {
  theme?: string;
  category?: string;
  difficulty?: AuthorDifficulty;
  questionType?: QuestionType | 'any';
  count?: number;
  era?: string;
  extraInstructions?: string;
  /** Full-round draft (cap 16, higher max_tokens, round-oriented prompt) */
  roundMode?: boolean;
  /** bulk = Haiku (quiz, round, bank batch). single = Sonnet (one question). */
  job?: AuthorJob;
  /** Existing questions across the quiz — avoid repeats */
  existingQuestions?: ExistingQuestionRef[];
}

export interface AuthoredSuggestion {
  id: string;
  prompt: string;
  type: QuestionType;
  difficulty: AuthorDifficulty;
  correctAnswer: string;
  acceptedVariants: string[];
  points: number;
  /** Search terms for Deezer/local — never fabricated media IDs */
  mediaSearchTerms?: string[];
  /** Clean MC options (4 strings, no A)/B) prefixes) */
  choices?: string[];
  hostNotes?: string;
  needsFactCheck: boolean;
}

const ALLOWED_TYPES: QuestionType[] = [
  'open',
  'music',
  'video',
  'image',
  'brand_logo',
  'numeric',
  'ordering',
  'multiple_choice',
];

function clampCount(n: number | undefined, roundMode: boolean): number {
  const fallback = roundMode ? 8 : 4;
  const max = roundMode ? 16 : 8;
  const v = Number(n ?? fallback);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(v)));
}

function normalizeType(t: unknown): QuestionType {
  if (typeof t === 'string' && (ALLOWED_TYPES as string[]).includes(t)) return t as QuestionType;
  return 'open';
}

function normalizeDifficulty(d: unknown): AuthorDifficulty {
  if (d === 'easy' || d === 'medium' || d === 'hard') return d;
  return 'medium';
}

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function authorMaxTokens(count: number, roundMode: boolean): number {
  if (!roundMode) return 900;
  return Math.min(2800, 400 + count * 280);
}

function formatExisting(existing: ExistingQuestionRef[]): string {
  if (!existing.length) return 'none';
  return existing
    .slice(0, 40)
    .map((q, i) => {
      const ans = q.correctAnswer || q.acceptedAnswers?.[0] || '?';
      return `${i + 1}. ${clip(q.prompt, 120)} → ${clip(ans, 40)}`;
    })
    .join('\n');
}

function buildHardConstraints(opts: {
  difficulty: AuthorDifficulty;
  questionType: QuestionType | 'any' | undefined;
  count: number;
  era: string;
  theme: string;
  category: string;
  extra: string;
  roundMode: boolean;
}): string {
  const typeLock =
    opts.questionType && opts.questionType !== 'any'
      ? `- Question type: EVERY item MUST be type "${opts.questionType}" (no other types).`
      : opts.roundMode
        ? '- Question type: mixed across the round (prefer open; sprinkle music/numeric/etc).'
        : '- Question type: mixed (prefer open).';
  const eraLine = opts.era
    ? `- Era: ALL questions must fit era/period "${opts.era}".`
    : '- Era: any.';
  const themeLine = opts.theme
    ? `- Round title/theme: stay on "${opts.theme}".`
    : '- Theme: general.';
  const catLine = opts.category
    ? `- Category focus: "${opts.category}".`
    : '- Category: general knowledge.';
  const extraLine = opts.extra
    ? `- Extra instructions (must follow): ${opts.extra}`
    : '- Extra instructions: none.';
  return `HARD CONSTRAINTS (must obey — do not ignore):
- Difficulty: ALL items must be "${opts.difficulty}".
${typeLock}
- Count: return exactly ${opts.count} question(s).
${eraLine}
${themeLine}
${catLine}
${extraLine}`;
}

function mapRawSuggestions(
  list: Array<Record<string, unknown>>,
  count: number,
  lockedDifficulty?: AuthorDifficulty,
): AuthoredSuggestion[] {
  return list.slice(0, count + 4).map((q, i) => {
    const correct = String(q.correctAnswer ?? q.answer ?? '').trim();
    const variants = Array.isArray(q.acceptedVariants)
      ? q.acceptedVariants.map(String).map((s) => s.trim()).filter(Boolean)
      : [];
    if (correct && !variants.includes(correct)) variants.unshift(correct);
    const mediaSearchTerms = Array.isArray(q.mediaSearchTerms)
      ? q.mediaSearchTerms.map(String).filter(Boolean).slice(0, 6)
      : undefined;
    let choices = Array.isArray(q.choices)
      ? q.choices.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8)
      : undefined;
    choices = normalizeChoices(choices);
    const rawType = String(q.type ?? '').trim();
    let type = normalizeType(q.type);
    const prompt = String(q.prompt ?? q.question ?? '').trim() || `Draft question ${i + 1}`;
    let hostNotes = q.hostNotes ? String(q.hostNotes) : undefined;
    // Legacy / model "connections" → open; fold clues into host notes
    if (rawType === 'connections') {
      type = 'open';
      const clues = Array.isArray(q.connectionClues)
        ? q.connectionClues.map(String).map((s) => s.trim()).filter(Boolean)
        : [];
      if (clues.length) {
        const clueLine = `clues: ${clues.join(' | ')}`;
        hostNotes = hostNotes ? `${hostNotes}\n${clueLine}` : clueLine;
      }
    }
    if (type === 'numeric') {
      const p = prompt.toLowerCase();
      const okNumeric = /^(how many|how much|what year|in which year|which year)\b/.test(p)
        || /\b(how many|what year|in which year)\b/.test(p);
      if (!okNumeric && /^(which|who|whom|whose|name)\b/.test(p)) type = 'open';
    }
    if (type === 'video') type = 'open';
    if (looksLikeMultipleChoicePrompt(prompt) && choices && choices.length >= 2) {
      type = 'multiple_choice';
    }
    // Music search terms must be title/artist from the answer, not vague themes
    let terms = mediaSearchTerms;
    if (type === 'music' && correct) {
      const answerTokens = new Set(
        correct.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t.length > 1),
      );
      const filtered = (terms ?? []).filter((t) => {
        const toks = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
        return toks.some((tok) => answerTokens.has(tok));
      });
      terms = filtered.length
        ? filtered
        : [correct, ...variants.filter((v) => v !== correct)].slice(0, 3);
    }
    let finalPrompt = prompt;
    if (type === 'brand_logo') {
      // Logo is the clue — keep a generic prompt; brand name is the answer
      finalPrompt = 'Which brand does this logo belong to?';
      terms = terms?.length
        ? terms
        : [correct, ...variants.filter((v) => v !== correct)].filter(Boolean).slice(0, 3);
    }
    return {
      id: `draft-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      prompt: finalPrompt,
      type,
      difficulty: lockedDifficulty ?? normalizeDifficulty(q.difficulty),
      correctAnswer: correct,
      acceptedVariants: variants.length ? variants : correct ? [correct] : [],
      points: Number(q.points) > 0 ? Number(q.points) : 1,
      mediaSearchTerms: terms,
      choices,
      hostNotes,
      needsFactCheck: q.needsFactCheck !== false,
    };
  });
}

function filterSuggestions(
  suggestions: AuthoredSuggestion[],
  existing: ExistingQuestionRef[],
  count: number,
  lockedType?: QuestionType,
): AuthoredSuggestion[] {
  const kept: AuthoredSuggestion[] = [];
  const seen: ExistingQuestionRef[] = [...existing];
  for (const s of suggestions) {
    if (!s.prompt.trim()) continue;
    if (lockedType && s.type !== lockedType) continue;
    if (answerLeaksInPrompt(s.prompt, s.acceptedVariants)) continue;
    if (s.type === 'multiple_choice' && (!s.choices || s.choices.length < 2)) continue;
    if (isDuplicateQuestion(
      { prompt: s.prompt, correctAnswer: s.correctAnswer, acceptedAnswers: s.acceptedVariants },
      seen,
    )) {
      continue;
    }
    kept.push(s);
    seen.push({ prompt: s.prompt, acceptedAnswers: s.acceptedVariants, correctAnswer: s.correctAnswer });
    if (kept.length >= count) break;
  }
  return kept;
}

async function callAuthor(
  system: string,
  user: string,
  count: number,
  roundMode: boolean,
  lockedDifficulty: AuthorDifficulty,
  job: AuthorJob,
  temperature: number,
) {
  const raw = (await callAiJson({
    system,
    user,
    temperature,
    maxTokens: authorMaxTokens(count, roundMode),
    purpose: 'author',
    job,
  })) as { questions?: Array<Record<string, unknown>> };
  return mapRawSuggestions(
    Array.isArray(raw.questions) ? raw.questions : [],
    count,
    lockedDifficulty,
  );
}

export async function authorQuestionsWithMistral(req: AuthorRequest): Promise<{
  suggestions: AuthoredSuggestion[];
  disclaimer: string;
  model: string;
  job: AuthorJob;
}> {
  const roundMode = !!req.roundMode;
  const count = clampCount(req.count, roundMode);
  const job = resolveAuthorJob({ job: req.job, count });
  const settings = await getSettings();
  const routed = modelForAuthorJob(settings, job);
  const pass = draftPassForEffort(settings.aiDraftEffort);
  const existing = req.existingQuestions ?? [];
  const difficulty = normalizeDifficulty(req.difficulty);
  const lockedType =
    req.questionType && req.questionType !== 'any' ? req.questionType : undefined;
  const theme = clip(req.theme || (roundMode ? 'general' : 'general'), 80);
  const category = clip(req.category || 'general knowledge', 80);
  const era = clip(req.era || '', 40);
  const extra = clip(req.extraInstructions || '', 160);

  console.log(
    `[ai:author] job=${job} model=${routed.model} effort=${clampDraftEffort(settings.aiDraftEffort)} temp=${pass.temperature} difficulty=${difficulty} type=${lockedType ?? 'any'} count=${count} era=${era || 'any'} theme=${theme} extra=${extra ? `${extra.length}c` : 'none'}`,
  );

  const hard = buildHardConstraints({
    difficulty,
    questionType: req.questionType,
    count,
    era,
    theme,
    category,
    extra,
    roundMode,
  });

  const varietyBlock = `VARIETY (mandatory):
- Diversify topics, eras/decades, answer entities, and prompt phrasing across the batch.
- Do NOT cluster on the same country/person/film/brand/decade.
- Prefer distinct answer entities — never reuse the same correctAnswer (or close alias) twice.
- Vary openers (Who / What / Which / In which year / How many / Name the…).
- When type is mixed/any, rotate categories (geo, history, science, entertainment, sport, food, tech).`;

  const categoryHint =
    !lockedType && (!req.category || /general/i.test(category))
      ? `Rotate sub-topics across: geography, history, science & nature, film/TV, music, sport, food & drink, tech.`
      : `Stay usefully within category “${category}” but still vary entities and eras.`;

  const system = roundMode
    ? `Pub-quiz ROUND drafts for host review. JSON only:
{"questions":[{"prompt":"...","type":"open|music|image|brand_logo|numeric|ordering|multiple_choice","difficulty":"easy|medium|hard","correctAnswer":"...","acceptedVariants":["..."],"points":1,"choices":["opt1","opt2","opt3","opt4"],"mediaSearchTerms":["Title - Artist"],"hostNotes":"optional","needsFactCheck":true}]}
Rules: exactly ${count} distinct questions for one round; no true/false; no fake media IDs; needsFactCheck true if unsure; numeric ONLY for how-many/what-year; never numeric for which/who/name; NEVER put the answer in the prompt (no parenthetical spoilers, no "answer is X"); multiple_choice MUST include exactly 4 clean choices[]; NEVER use type connections (use open for “what links” style); for music, mediaSearchTerms MUST be song title/artist from correctAnswer (e.g. "Bohemian Rhapsody - Queen"), or album+artist when the prompt names an album and the answer is the artist — do NOT ask the host to clarify title/artist when the prompt already names the album; never vague themes; ordering uses " > "; for brand_logo use prompt "Which brand does this logo belong to?", correctAnswer = brand name (+ aliases), mediaSearchTerms = [brand name] (logos resolved later — never invent image URLs); do NOT repeat any existing question listed by the user.

${varietyBlock}

${hard}

${pass.instruction}`
    : `Pub-quiz DRAFTS for host review. JSON only:
{"questions":[{"prompt":"...","type":"open|music|image|brand_logo|numeric|ordering|multiple_choice","difficulty":"easy|medium|hard","correctAnswer":"...","acceptedVariants":["..."],"points":1,"choices":["opt1","opt2","opt3","opt4"],"mediaSearchTerms":["Title - Artist"],"hostNotes":"optional","needsFactCheck":true}]}
Rules: no true/false; no fake media IDs; needsFactCheck true if unsure; numeric ONLY for how-many/what-year; NEVER embed the answer in the prompt; multiple_choice needs 4 clean choices[]; never type connections; music mediaSearchTerms = title/artist from correctAnswer (or album when prompt names it); brand_logo: generic logo prompt + brand as answer + mediaSearchTerms=[brand]; do NOT ask host to clarify when album+artist are already known; do NOT repeat existing questions.

${varietyBlock}

${hard}

${pass.instruction}`;

  const baseUser = roundMode
    ? `Draft a full round of ${count} question(s).
${hard}
${varietyBlock}
${categoryHint}
Round theme: ${theme}
Category: ${category}
Difficulty (ALL items): ${difficulty}
Type: ${lockedType ?? 'mixed types across the round'}
Era: ${era || 'any'}
Extra: ${extra || 'none'}
Existing questions (do NOT repeat these prompts, Q→A pairs, or answer entities):
${formatExisting(existing)}
Audience: in-person pub quiz. Host will review before publish — do not claim verified.`
    : `Draft ${count} question(s).
${hard}
${varietyBlock}
${categoryHint}
Theme: ${theme}
Category: ${category}
Difficulty (ALL items): ${difficulty}
Type: ${lockedType ?? 'mixed (prefer open)'}
Era: ${era || 'any'}
Extra: ${extra || 'none'}
Existing questions (do NOT repeat prompts or answer entities):
${formatExisting(existing)}`;

  let mapped = await callAuthor(system, baseUser, count, roundMode, difficulty, job, pass.temperature);
  let suggestions = filterSuggestions(mapped, existing, count, lockedType);

  // One refill for gaps (skip on rate limit) — same HARD CONSTRAINTS
  if (suggestions.length < count) {
    const need = count - suggestions.length;
    try {
      const refillUser = `${baseUser}

Need ${need} MORE distinct question(s). Obey the same HARD CONSTRAINTS.
Avoid these already drafted:
${formatExisting(suggestions.map((s) => ({ prompt: s.prompt, acceptedAnswers: s.acceptedVariants, correctAnswer: s.correctAnswer })))}`;
      mapped = await callAuthor(system, refillUser, need, roundMode, difficulty, job, pass.temperature);
      const more = filterSuggestions(mapped, [
        ...existing,
        ...suggestions.map((s) => ({
          prompt: s.prompt,
          acceptedAnswers: s.acceptedVariants,
          correctAnswer: s.correctAnswer,
        })),
      ], need, lockedType);
      suggestions = [...suggestions, ...more].slice(0, count);
    } catch (err) {
      if (!(err instanceof LlmRateLimitError)) throw err;
      // keep partial
    }
  }

  const modelNote = job === 'bulk'
    ? `Bulk draft used ${routed.model}.`
    : `Single question used ${routed.model}.`;
  return {
    suggestions,
    model: routed.model,
    job,
    disclaimer: roundMode
      ? `AI round drafts only — review, edit, and Publish selected. ${modelNote} Duplicates and answer-in-prompt drafts are dropped. No media IDs are verified.`
      : `AI drafts only — host must review before adding. ${modelNote} Duplicates and answer-in-prompt drafts are dropped. Use Deezer search for music.`,
  };
}

export {
  AiNotConfiguredError,
  MistralNotConfiguredError,
  MistralRateLimitError,
  LlmRateLimitError,
  isDuplicateQuestion,
  answerLeaksInPrompt,
};
