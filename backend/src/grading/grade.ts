import type { GradeResult, NumericConfig, Question, QuestionType } from '../shared/types.js';
import { connectionsGradeInput } from './connectionsAnswer.js';
import { damerauLevenshtein, jaroWinkler, maxEditsForLength } from './distance.js';
import { normalizeAnswer, tokenize } from './normalize.js';
import { DEFAULT_GRADING_CONFIG, slackThresholds, type GradingConfig } from './config.js';

function emptyResult(_points: number): GradeResult {
  return { verdict: 'incorrect', confidence: 1, pointsAwarded: 0, reason: 'blank' };
}

/** 3–4 digit year-like token (standalone). */
function isYearLikeToken(s: string): boolean {
  return /^\d{3,4}$/.test(s.trim());
}

/** Expand aliases: strip parentheticals so "1969 (Apollo 11)" → also "1969". */
export function expandAcceptedAnswers(accepted: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of accepted) {
    const base = String(raw ?? '').trim();
    if (!base) continue;
    const variants = [base];
    const stripped = base.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (stripped && stripped !== base) variants.push(stripped);
    // Pull bare year if present
    const year = base.match(/\b(\d{3,4})\b/);
    if (year?.[1]) variants.push(year[1]);
    for (const v of variants) {
      const key = normalizeAnswer(v);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

function acceptedLooksYearLike(accepted: string[]): boolean {
  return expandAcceptedAnswers(accepted).some((a) => isYearLikeToken(normalizeAnswer(a)));
}

function exactOrAlias(given: string, accepted: string[], points: number): GradeResult | null {
  const g = normalizeAnswer(given);
  if (!g) return null;
  for (const raw of expandAcceptedAnswers(accepted)) {
    const a = normalizeAnswer(raw);
    if (g === a) {
      return { verdict: 'correct', confidence: 1, matchedAnswer: raw, pointsAwarded: points, reason: 'exact' };
    }
  }
  return null;
}

/**
 * Last-name / incomplete match when acceptIncompleteNames is on.
 * "Jackson" vs "Michael Jackson", "Beatles" vs "The Beatles" (article already stripped by normalize).
 * Never used against year-like accepted keys.
 */
function incompleteNameMatch(given: string, accepted: string): boolean {
  if (isYearLikeToken(normalizeAnswer(accepted)) || isYearLikeToken(normalizeAnswer(given))) {
    return false;
  }
  const gTok = tokenize(normalizeAnswer(given));
  const aTok = tokenize(normalizeAnswer(accepted));
  if (!gTok.length || !aTok.length) return false;
  if (gTok.length >= aTok.length) return false;
  // All given tokens appear in accepted (order-flexible for short answers)
  if (gTok.length === 1) {
    const token = gTok[0];
    // Prefer last-name style: match final token, or any token length >= 4
    if (aTok[aTok.length - 1] === token) return token.length >= 3;
    return aTok.some((t) => t === token && t.length >= 4);
  }
  return gTok.every((t) => aTok.includes(t));
}

function isDangerousSubstring(given: string, accepted: string): boolean {
  const g = normalizeAnswer(given);
  const a = normalizeAnswer(accepted);
  if (!g || !a || g === a) return false;
  const gTokens = tokenize(g);
  const aTokens = tokenize(a);
  if (gTokens.length === 1 && aTokens.length > 1 && a.includes(g) && g.length < a.length * 0.7) {
    return true;
  }
  if (g.length <= 4 && a.length <= 6 && g !== a && (a.startsWith(g) || g.startsWith(a))) {
    if (Math.abs(g.length - a.length) >= 1 && !a.includes(' ')) return true;
  }
  return false;
}

function fuzzyMatch(given: string, acceptedList: string[], cfg: GradingConfig, points: number): GradeResult | null {
  const g = normalizeAnswer(given);
  if (!g) return null;
  // Years / 3–4 digit numerics: exact only (1961 ≠ 1969)
  if (isYearLikeToken(g) || acceptedLooksYearLike(acceptedList)) {
    return null;
  }
  const thr = hangThresholds(cfg);
  const expanded = expandAcceptedAnswers(acceptedList);

  let best: { answer: string; confidence: number; edits: number } | null = null;

  for (const raw of expanded) {
    const a = normalizeAnswer(raw);
    if (!a) continue;
    if (isYearLikeToken(a)) continue;

    if (cfg.acceptIncompleteNames && incompleteNameMatch(given, raw)) {
      // Short codes still blocked
      if (!(g.length <= 3 && a.length <= 6 && g !== a)) {
        const confidence = 0.88;
        if (!best || confidence > best.confidence) {
          best = { answer: raw, confidence, edits: 0 };
        }
        continue;
      }
    }

    if (isDangerousSubstring(g, a) && !cfg.acceptIncompleteNames) continue;
    if (isDangerousSubstring(g, a) && g.length <= 4) continue;

    const edits = damerauLevenshtein(g, a);
    const maxEdits = maxEditsForLength(Math.min(g.length, a.length)) + thr.editBonus;
    const jw = jaroWinkler(g, a);

    const gTok = tokenize(g);
    const aTok = tokenize(a);
    let tokenOk = false;
    if (gTok.length > 1 && aTok.length > 1 && gTok.length === aTok.length) {
      tokenOk = gTok.every((t, i) => {
        const target = aTok[i];
        return t === target || damerauLevenshtein(t, target) <= maxEditsForLength(target.length) + thr.editBonus;
      });
    }

    const withinEdit = edits <= maxEdits;
    const highJw = jw >= thr.jwCorrect && Math.abs(g.length - a.length) <= 2 + thr.editBonus;

    if (tokenOk || withinEdit || highJw) {
      const confidence = tokenOk ? 0.95 : withinEdit ? 0.9 - edits * 0.05 : jw;
      if (!best || confidence > best.confidence) {
        best = { answer: raw, confidence, edits };
      }
    } else if (jw >= thr.jwReview && edits <= maxEdits + 1) {
      const confidence = Math.min(jw * 0.85, 0.79);
      if (!best || confidence > best.confidence) {
        best = { answer: raw, confidence, edits };
      }
    }
  }

  if (!best) return null;
  if (best.confidence >= 0.85) {
    return {
      verdict: 'correct',
      confidence: best.confidence,
      matchedAnswer: best.answer,
      pointsAwarded: points,
      reason: `fuzzy edits=${best.edits}`,
    };
  }
  if (best.confidence >= 0.65) {
    return {
      verdict: 'review',
      confidence: best.confidence,
      matchedAnswer: best.answer,
      pointsAwarded: 0,
      reason: 'needs host review',
    };
  }
  return null;
}

function hangThresholds(cfg: GradingConfig) {
  return slackThresholds(cfg.spellingSlack);
}

function gradeNumeric(given: string, cfg: NumericConfig | undefined, points: number): GradeResult {
  const n = Number(String(given).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) {
    return { verdict: 'incorrect', confidence: 1, pointsAwarded: 0, reason: 'not a number' };
  }
  if (!cfg) {
    return { verdict: 'review', confidence: 0.5, pointsAwarded: 0, reason: 'no numeric config' };
  }
  if (cfg.exact != null) {
    if (n === cfg.exact) {
      return { verdict: 'correct', confidence: 1, matchedAnswer: String(cfg.exact), pointsAwarded: points, reason: 'exact number' };
    }
    if (cfg.tolerance != null && Math.abs(n - cfg.exact) <= cfg.tolerance) {
      return { verdict: 'correct', confidence: 0.95, matchedAnswer: String(cfg.exact), pointsAwarded: points, reason: 'within tolerance' };
    }
    if (cfg.tolerancePercent != null) {
      const tol = Math.abs(cfg.exact) * (cfg.tolerancePercent / 100);
      if (Math.abs(n - cfg.exact) <= tol) {
        return { verdict: 'correct', confidence: 0.95, matchedAnswer: String(cfg.exact), pointsAwarded: points, reason: 'within % tolerance' };
      }
    }
    return { verdict: 'incorrect', confidence: 1, pointsAwarded: 0, reason: 'wrong number', matchedAnswer: String(cfg.exact) };
  }
  if (cfg.min != null && cfg.max != null && n >= cfg.min && n <= cfg.max) {
    return { verdict: 'correct', confidence: 1, pointsAwarded: points, reason: 'in range' };
  }
  return { verdict: 'incorrect', confidence: 1, pointsAwarded: 0, reason: 'out of range' };
}

function gradeOrdering(given: string, orderItems: string[] | undefined, points: number): GradeResult {
  if (!orderItems?.length) {
    return { verdict: 'review', confidence: 0.5, pointsAwarded: 0, reason: 'no order key' };
  }
  let parts: string[] = [];
  try {
    const parsed = JSON.parse(given);
    if (Array.isArray(parsed)) parts = parsed.map(String);
  } catch {
    parts = given.split(/\s*(?:,|>|;|\n)\s*/).map((s) => s.trim()).filter(Boolean);
  }
  if (parts.length !== orderItems.length) {
    return { verdict: 'incorrect', confidence: 0.9, pointsAwarded: 0, reason: 'wrong length' };
  }
  const ok = parts.every((p, i) => normalizeAnswer(p) === normalizeAnswer(orderItems[i]));
  return ok
    ? { verdict: 'correct', confidence: 1, pointsAwarded: points, reason: 'order match' }
    : { verdict: 'incorrect', confidence: 1, pointsAwarded: 0, reason: 'wrong order' };
}

export function gradeAnswer(
  given: string,
  question: Pick<Question, 'acceptedAnswers' | 'points' | 'type' | 'numeric' | 'orderItems'>,
  gradingCfg: GradingConfig = DEFAULT_GRADING_CONFIG,
): GradeResult {
  const points = question.points ?? 1;
  let trimmed = (given ?? '').trim();
  if (!trimmed) return emptyResult(points);

  // Connections store JSON { idents, connection } — grade connection only
  if (question.type === 'connections') {
    trimmed = connectionsGradeInput(trimmed);
    if (!trimmed) return emptyResult(points);
  }

  if (question.type === 'numeric') {
    return gradeNumeric(trimmed, question.numeric, points);
  }
  if (question.type === 'ordering') {
    return gradeOrdering(trimmed, question.orderItems, points);
  }

  // multiple_choice / open / music / connections — correct always awards question.points
  const exact = exactOrAlias(trimmed, question.acceptedAnswers, points);
  if (exact) return exact;

  // Year-like open answers: exact only (no fuzzy / incomplete-name)
  if (isYearLikeToken(normalizeAnswer(trimmed)) || acceptedLooksYearLike(question.acceptedAnswers)) {
    return {
      verdict: 'incorrect',
      confidence: 1,
      pointsAwarded: 0,
      reason: 'year exact only',
      matchedAnswer: question.acceptedAnswers[0],
    };
  }

  const fuzzy = fuzzyMatch(trimmed, question.acceptedAnswers, gradingCfg, points);
  if (fuzzy) return fuzzy;

  return {
    verdict: 'incorrect',
    confidence: 0.9,
    pointsAwarded: 0,
    reason: 'no match',
    matchedAnswer: question.acceptedAnswers[0],
  };
}

export function gradeSheet(
  answers: string[],
  questions: Array<Pick<Question, 'acceptedAnswers' | 'points' | 'type' | 'numeric' | 'orderItems'>>,
  gradingCfg: GradingConfig = DEFAULT_GRADING_CONFIG,
): GradeResult[] {
  return questions.map((q, i) => gradeAnswer(answers[i] ?? '', q, gradingCfg));
}

export function supportsType(type: QuestionType): boolean {
  return [
    'open',
    'music',
    'video',
    'image',
    'brand_logo',
    'numeric',
    'ordering',
    'connections',
    'multiple_choice',
  ].includes(type);
}
