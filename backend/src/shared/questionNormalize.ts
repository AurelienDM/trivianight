import type { Question, QuestionType, Quiz } from './types.js';

const LETTER_ONLY = /^[A-Za-z]$/;
const LETTER_PREFIX = /^([A-Za-z])[\).:\-]\s*(.+)$/;

/** Prompts that ask for a name/identity should not be typed numeric. */
export function looksLikeNumericPrompt(prompt: string): boolean {
  const p = (prompt || '').trim().toLowerCase();
  if (!p) return false;
  if (/^(how many|how much)\b/.test(p)) return true;
  if (/^(what year|in which year|which year)\b/.test(p)) return true;
  if (/\b(how many|what year|in which year)\b/.test(p)) return true;
  return false;
}

/** True when type is numeric but the prompt reads like open/who/which-name. */
export function numericPromptMismatch(type: QuestionType | string, prompt: string): boolean {
  if (type !== 'numeric') return false;
  const p = (prompt || '').trim().toLowerCase();
  if (!p) return false;
  if (looksLikeNumericPrompt(p)) return false;
  if (/^(which|who|whom|whose|name)\b/.test(p)) return true;
  if (/^what (is|was|are|were) (the|a|an)\b/.test(p) && !/\b(year|number|score|population|distance)\b/.test(p)) {
    return true;
  }
  return false;
}

/** Pick-list / NOT-a phrasing should be multiple_choice, not connections. */
export function looksLikeMultipleChoicePrompt(prompt: string): boolean {
  const p = (prompt || '').trim().toLowerCase();
  if (!p) return false;
  if (/\bwhich of (these|the following)\b/.test(p)) return true;
  if (/\bwhich (one )?of these\b/.test(p)) return true;
  if (/\bnot a\b/.test(p) && /\bwhich\b/.test(p)) return true;
  if (/\bwhich of the following\b/.test(p)) return true;
  return false;
}

/**
 * Fix MC arrays like ['A','Vienna','B','Berlin',…] or ['A) Vienna','B) Berlin'].
 * Returns clean option labels (typically 4).
 */
export function normalizeChoices(choices: string[] | undefined | null): string[] | undefined {
  if (!choices?.length) return choices ?? undefined;
  const raw = choices.map((c) => String(c ?? '').trim()).filter(Boolean);
  if (!raw.length) return undefined;

  const merged: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i]!;
    const next = raw[i + 1];
    if (LETTER_ONLY.test(cur) && next && !LETTER_ONLY.test(next)) {
      merged.push(stripLetterPrefix(next));
      i += 1;
      continue;
    }
    merged.push(stripLetterPrefix(cur));
  }

  const cleaned = merged.filter((c) => !LETTER_ONLY.test(c));
  return cleaned.length ? cleaned : undefined;
}

function stripLetterPrefix(label: string): string {
  const m = label.match(LETTER_PREFIX);
  if (m?.[2]) return m[2].trim();
  return label.trim();
}

/** Pull choices from notes like `choices: A|B|C|D` or comma/pipe lists. */
export function extractChoicesFromNotes(notes?: string): string[] | undefined {
  if (!notes?.trim()) return undefined;
  const m = notes.match(/choices?\s*[:=]\s*(.+)/i);
  const raw = m?.[1]?.trim();
  if (!raw) return undefined;
  const parts = raw.split(/\s*[|,/;]\s*|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  return normalizeChoices(parts);
}

/** Detect answer embedded in the prompt (spoilers). */
export function answerLeaksInPrompt(prompt: string, acceptedAnswers: string[] | undefined): boolean {
  const p = (prompt || '').trim();
  if (!p || !acceptedAnswers?.length) return false;
  const lower = p.toLowerCase();

  if (/\b(answer\s+is|correct\s+answer\s+is|it'?s)\s+/i.test(p)) {
    for (const a of acceptedAnswers) {
      const ans = String(a || '').trim();
      if (!ans) continue;
      if (new RegExp(`\\b(answer\\s+is|correct\\s+answer\\s+is|it'?s)\\s+${escapeReg(ans)}\\b`, 'i').test(p)) {
        return true;
      }
    }
  }

  // Parenthetical spoil: "... (Paris)" matching an accepted answer
  for (const a of acceptedAnswers) {
    const ans = String(a || '').trim();
    if (!ans || ans.length < 2) continue;
    const paren = new RegExp(`\\(\\s*${escapeReg(ans)}\\s*\\)`, 'i');
    if (paren.test(p)) return true;
    // Whole-word leak for non-numeric longer answers
    if (!/^\d+(\.\d+)?$/.test(ans) && ans.length >= 4) {
      if (new RegExp(`\\b${escapeReg(ans)}\\b`, 'i').test(lower) && !looksLikeMultipleChoicePrompt(p)) {
        // Avoid flagging when answer is a common word inside a longer question about itself
        // Only flag if the answer appears after a cue like "called" / "named" or is quoted
        if (new RegExp(`["'\`]${escapeReg(ans)}["'\`]`, 'i').test(p)) return true;
        if (new RegExp(`\\b(named|called|known as)\\s+${escapeReg(ans)}\\b`, 'i').test(p)) return true;
      }
    }
    // Numeric answer appearing as the only number in a which/who prompt (odd) — skip
    if (/^\d+$/.test(ans) && new RegExp(`\\b${escapeReg(ans)}\\b`).test(p) && !looksLikeNumericPrompt(p)) {
      // e.g. "Which planet has 92 moons?" spoils the number
      if (/\bwhich\b|\bwho\b|\bname\b/i.test(p)) return true;
    }
  }
  return false;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @deprecated Connections type removed — always false. */
export function connectionsMissingClues(_q: Pick<Question, 'type' | 'connectionClues'>): boolean {
  return false;
}

export function normalizeQuestion(q: Question): Question {
  const next: Question = { ...q };
  if (next.choices) {
    next.choices = normalizeChoices(next.choices);
  }

  if (numericPromptMismatch(next.type, next.prompt)) {
    next.type = 'open';
  }

  // Coerce which-of-these / NOT-a prompts into MC when typed as connections/open
  if (
    (next.type === 'connections' || next.type === 'open')
    && looksLikeMultipleChoicePrompt(next.prompt)
  ) {
    const fromNotes = extractChoicesFromNotes(next.notes);
    const choices = next.choices?.length ? next.choices : fromNotes;
    if (choices && choices.length >= 2) {
      next.type = 'multiple_choice';
      next.choices = choices;
      delete next.connectionClues;
    }
  }

  // Legacy connections → open; fold clues into notes (+ prompt if not already inline)
  if (next.type === 'connections') {
    next.type = 'open';
    const clues = (next.connectionClues ?? []).map((c) => String(c ?? '').trim()).filter(Boolean);
    if (clues.length) {
      const clueLine = `clues: ${clues.join(' | ')}`;
      const notes = (next.notes ?? '').trim();
      if (!/clues\s*[:=]/i.test(notes)) {
        next.notes = notes ? `${notes}\n${clueLine}` : clueLine;
      }
      const promptLower = (next.prompt || '').toLowerCase();
      const alreadyInline = clues.every((c) => promptLower.includes(c.toLowerCase()));
      if (!alreadyInline) {
        next.prompt = `${next.prompt} (${clues.join(', ')})`;
      }
    }
    delete next.connectionClues;
  }

  if (next.type === 'multiple_choice' && next.choices) {
    next.choices = normalizeChoices(next.choices);
  }

  // Drop leftover empty connectionClues on any type
  if (next.connectionClues && (!next.connectionClues.length || next.connectionClues.every((c) => !String(c).trim()))) {
    delete next.connectionClues;
  }

  return next;
}

export function normalizeQuizQuestions(quiz: Quiz): Quiz {
  return {
    ...quiz,
    rounds: quiz.rounds.map((r) => ({
      ...r,
      questions: r.questions.map((q) => normalizeQuestion(q)),
    })),
  };
}

/**
 * Stronger dedupe: same answer entity, near-paraphrase prompts (Jaccard),
 * or high token overlap with shared answer.
 */
export function isDuplicateQuestion(
  candidate: { prompt: string; correctAnswer?: string; acceptedAnswers?: string[] },
  existing: Array<{ prompt: string; acceptedAnswers?: string[]; correctAnswer?: string }>,
): boolean {
  const cPrompt = normalizePrompt(candidate.prompt);
  const cAns = normalizeAns(candidate.correctAnswer || candidate.acceptedAnswers?.[0] || '');
  if (!cPrompt) return false;
  for (const ex of existing) {
    const ePrompt = normalizePrompt(ex.prompt);
    const eAns = normalizeAns(ex.correctAnswer || ex.acceptedAnswers?.[0] || '');
    if (!ePrompt) continue;
    if (cPrompt === ePrompt) return true;
    // Same answer entity (non-trivial) = duplicate even with different phrasing
    if (cAns && eAns && cAns === eAns && cAns.length >= 2) return true;
    const { jaccard, shared } = tokenJaccard(cPrompt, ePrompt);
    if (jaccard >= 0.52) return true;
    if (jaccard >= 0.4 && shared >= 4) return true;
    const overlap = tokenOverlap(cPrompt, ePrompt);
    if (overlap >= 0.72 && cAns && eAns && cAns === eAns) return true;
    if (overlap >= 0.88) return true;
  }
  return false;
}

function normalizePrompt(p: string): string {
  return (p || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAns(a: string): string {
  return (a || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter((t) => t.length > 2));
  const tb = new Set(b.split(' ').filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}

function tokenJaccard(a: string, b: string): { jaccard: number; shared: number } {
  const ta = new Set(a.split(' ').filter((t) => t.length > 2));
  const tb = new Set(b.split(' ').filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return { jaccard: 0, shared: 0 };
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const union = ta.size + tb.size - shared;
  return { jaccard: union ? shared / union : 0, shared };
}
