import { hostFetch } from '../../lib/hostAuth';
import type { Question, QuestionType } from '@shared/types';

export type Difficulty = 'easy' | 'medium' | 'hard';
export type PublishMode = 'replace' | 'fill';

export interface AuthoredSuggestion {
  id: string;
  prompt: string;
  type: QuestionType;
  difficulty: Difficulty;
  correctAnswer: string;
  acceptedVariants: string[];
  points: number;
  mediaSearchTerms?: string[];
  choices?: string[];
  hostNotes?: string;
  needsFactCheck: boolean;
}

export const AI_DRAFT_TYPES: Array<QuestionType | 'any'> = [
  'any', 'open', 'music', 'numeric', 'ordering', 'multiple_choice', 'image', 'brand_logo',
];

/** Placeholder like "Question 1" with no real answer */
export function isPlaceholderQuestion(q: Question): boolean {
  const prompt = (q.prompt || '').trim();
  const answers = (q.acceptedAnswers || []).map((a) => a.trim()).filter(Boolean);
  if (!prompt && answers.length === 0) return true;
  if (/^Question\s+\d+$/i.test(prompt) && answers.length === 0) return true;
  return false;
}

export function roundLooksEmpty(questions: Question[]): boolean {
  return questions.length === 0 || questions.every(isPlaceholderQuestion);
}

/** Keep substantial questions; fill placeholder / empty slots from incoming. */
export function mergeFillQuestions(existing: Question[], incoming: Question[], maxSlots = 8): Question[] {
  const result = existing.map((q) => ({ ...q }));
  let next = 0;
  for (let i = 0; i < result.length && next < incoming.length; i++) {
    if (isPlaceholderQuestion(result[i]!)) {
      result[i] = incoming[next++]!;
    }
  }
  while (next < incoming.length && result.length < maxSlots) {
    result.push(incoming[next++]!);
  }
  return result;
}

export function toQuestions(picked: AuthoredSuggestion[]): Question[] {
  return picked.map((d) => {
    const type: QuestionType = d.type === 'video' ? 'open' : d.type;
    const notes = [
      d.hostNotes,
      d.mediaSearchTerms?.length ? `Media search: ${d.mediaSearchTerms.join('; ')}` : null,
      d.needsFactCheck ? 'AI draft — host should fact-check before live use.' : null,
      d.type === 'video' ? 'AI suggested video — converted to open (use music + Deezer for audio).' : null,
    ]
      .filter(Boolean)
      .join('\n');
    const prompt = type === 'brand_logo'
      ? 'Which brand does this logo belong to?'
      : d.prompt;
    const q: Question = {
      id: crypto.randomUUID(),
      type,
      prompt,
      points: d.points || 1,
      acceptedAnswers: d.acceptedVariants.length ? d.acceptedVariants : [d.correctAnswer],
      notes: notes || undefined,
    };
    if (type === 'numeric' && d.correctAnswer) {
      const n = Number(d.correctAnswer);
      if (Number.isFinite(n)) q.numeric = { exact: n };
    }
    if (type === 'ordering' && d.correctAnswer) {
      q.orderItems = d.correctAnswer.split(/\s*>\s*/).map((s) => s.trim()).filter(Boolean);
    }
    if (type === 'multiple_choice') {
      if (d.choices?.length) {
        q.choices = d.choices;
      } else if (d.hostNotes?.includes('choices:')) {
        const m = d.hostNotes.match(/choices:\s*(.+)/i);
        if (m) q.choices = m[1]!.split('|').map((s) => s.trim()).filter(Boolean);
      }
    }
    return q;
  });
}

export function stripClarifyNotes(notes?: string): string | undefined {
  if (!notes?.trim()) return undefined;
  const kept = notes
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/\bclarify\b/i.test(l) && !/ask host to (clarify|confirm)/i.test(l));
  return kept.length ? kept.join('\n') : undefined;
}

/** Infer category from round title / theme. */
export function categoryFromRound(round: { title?: string; theme?: string }): string {
  const t = `${round.theme || ''} ${round.title || ''}`.toLowerCase();
  if (/\b(music|song|album|band|artist|lyrics)\b/.test(t)) return 'music';
  if (/\b(film|movie|cinema|oscar)\b/.test(t)) return 'film';
  if (/\b(sport|football|olympic)\b/.test(t)) return 'sport';
  if (/\b(science|nature|space|biology)\b/.test(t)) return 'science';
  if (/\b(geograph|world|capital|country)\b/.test(t)) return 'geography';
  if (/\b(history|war|year|decade)\b/.test(t)) return 'history';
  if (/\b(tv|television|sitcom)\b/.test(t)) return 'television';
  return (round.theme || '').trim() || 'general knowledge';
}

export type DedupeRef = {
  prompt: string;
  acceptedAnswers?: string[];
  correctAnswer?: string;
  type?: QuestionType;
};

export function questionsToDedupe(questions: Question[]): DedupeRef[] {
  return questions
    .filter((q) => (q.prompt || '').trim() && !/^Question\s+\d+$/i.test(q.prompt || ''))
    .map((q) => ({
      prompt: q.prompt,
      acceptedAnswers: q.acceptedAnswers,
      correctAnswer: q.acceptedAnswers?.[0],
      type: q.type,
    }));
}

export function draftsToDedupe(drafts: AuthoredSuggestion[]): DedupeRef[] {
  return drafts.map((d) => ({
    prompt: d.prompt,
    acceptedAnswers: d.acceptedVariants,
    correctAnswer: d.correctAnswer,
    type: d.type,
  }));
}

/** Call /api/ai/author; on 429 wait retryAfterMs and retry. */
export async function authorRoundWithRetry(
  body: Record<string, unknown>,
  opts?: { maxAttempts?: number; onRetry?: (waitMs: number, attempt: number) => void },
): Promise<{ suggestions: AuthoredSuggestion[]; disclaimer?: string }> {
  const maxAttempts = opts?.maxAttempts ?? 4;
  let lastErr = 'Generate failed';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await hostFetch('/api/ai/author', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, job: body.job === 'single' ? 'single' : 'bulk' }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429 || data.code === 'rate_limited') {
      const wait = Number(data.retryAfterMs) > 0 ? Number(data.retryAfterMs) : 60_000;
      lastErr = data.error || data.hint || 'Mistral rate limited';
      opts?.onRetry?.(wait, attempt);
      if (attempt >= maxAttempts) break;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      throw new Error(data.hint || data.error || 'Generate failed');
    }
    return {
      suggestions: (data.suggestions || []) as AuthoredSuggestion[],
      disclaimer: data.disclaimer || undefined,
    };
  }
  throw new Error(lastErr);
}

/** Deezer match-attach for music + logo resolve for brand_logo drafts. */
export async function attachCatalogMedia(
  questions: Question[],
  drafts: AuthoredSuggestion[],
): Promise<{ questions: Question[]; note: string | null }> {
  const out: Question[] = [];
  const attached: string[] = [];
  const missed: string[] = [];
  const logosAttached: string[] = [];
  const logosMissed: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const draft = drafts[i];

    if (q.type === 'brand_logo') {
      if (q.media?.url) {
        out.push(q);
        continue;
      }
      const brand = String(
        draft?.correctAnswer
          || draft?.mediaSearchTerms?.[0]
          || q.acceptedAnswers?.[0]
          || '',
      ).trim();
      if (!brand) {
        logosMissed.push('(no brand)');
        out.push({
          ...q,
          prompt: q.prompt || 'Which brand does this logo belong to?',
          notes: [stripClarifyNotes(q.notes), 'Logo resolve failed — no brand name; host must attach.']
            .filter(Boolean)
            .join('\n'),
        });
        continue;
      }
      try {
        const res = await hostFetch('/api/logos/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            brand,
            answers: [
              draft?.correctAnswer,
              ...(draft?.acceptedVariants ?? []),
              ...(q.acceptedAnswers ?? []),
            ].filter(Boolean),
          }),
        });
        const data = await res.json();
        if (res.ok && data.matched && data.media?.url) {
          logosAttached.push(brand);
          const review = data.needsHostReview ? ' (confirm logo)' : '';
          const noteLine = `Logo attached (${data.source || 'resolve'}): ${brand}${review}`;
          out.push({
            ...q,
            prompt: 'Which brand does this logo belong to?',
            notes: [stripClarifyNotes(q.notes), noteLine].filter(Boolean).join('\n'),
            media: data.media,
          });
          continue;
        }
        logosMissed.push(brand);
        out.push({
          ...q,
          prompt: 'Which brand does this logo belong to?',
          notes: [
            stripClarifyNotes(q.notes),
            `Logo resolve failed for ${brand} — paste URL in editor.`,
          ].filter(Boolean).join('\n'),
        });
      } catch {
        logosMissed.push(brand);
        out.push({
          ...q,
          prompt: 'Which brand does this logo belong to?',
          notes: [
            stripClarifyNotes(q.notes),
            `Logo resolve failed for ${brand} — paste URL in editor.`,
          ].filter(Boolean).join('\n'),
        });
      }
      continue;
    }

    if (q.media?.deezerTrackId || q.media?.previewUrl || q.type !== 'music') {
      out.push(q);
      continue;
    }
    const answers = [
      draft?.correctAnswer,
      ...(draft?.acceptedVariants ?? []),
      ...(q.acceptedAnswers ?? []),
    ].filter(Boolean).map(String);

    if (!answers.length && !q.prompt.trim()) {
      missed.push(q.prompt.slice(0, 40) || 'music');
      out.push(q);
      continue;
    }
    try {
      const res = await hostFetch('/api/deezer/match-attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: q.prompt,
          answers,
          query: draft?.mediaSearchTerms?.[0] || answers[0] || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.matched && data.media) {
        const label = data.track?.label
          || `${data.media.title || '?'} — ${data.media.artist || '?'}`
            + (data.media.album ? ` (${data.media.album})` : '');
        const noteLine = `Deezer attached: ${label}`;
        let notes = stripClarifyNotes(q.notes);
        notes = notes?.includes('Deezer attached:')
          ? notes
          : [notes, noteLine].filter(Boolean).join('\n');
        attached.push(label);
        out.push({
          ...q,
          notes,
          media: {
            ...data.media,
            title: data.media.title || data.track?.name,
            artist: data.media.artist || data.track?.artists,
            album: data.media.album || data.track?.album,
          },
        });
        continue;
      }
      missed.push((answers[0] || q.prompt).slice(0, 48));
    } catch {
      missed.push((answers[0] || q.prompt).slice(0, 48));
    }
    out.push({ ...q, notes: stripClarifyNotes(q.notes) });
  }
  const parts: string[] = [];
  if (attached.length) {
    parts.push(`Deezer attached: ${attached.join('; ')}`);
  }
  if (missed.length) {
    parts.push(`No strong Deezer match for ${missed.length} music draft(s) — attach manually: ${missed.join('; ')}`);
  }
  if (logosAttached.length) {
    parts.push(`Logos attached: ${logosAttached.join('; ')}`);
  }
  if (logosMissed.length) {
    parts.push(`Logo resolve failed for ${logosMissed.length} — attach manually: ${logosMissed.join('; ')}`);
  }
  return { questions: out, note: parts.length ? parts.join('\n') : null };
}
