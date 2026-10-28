import { useState } from 'react';
import { RefreshCw, Wand2 } from 'lucide-react';
import CardDealer from './CardDealer';
import { hostFetch } from '../../lib/hostAuth';
import { askConfirm } from '../../lib/dialogs';
import type { Question, QuestionType } from '@shared/types';
import {
  attachCatalogMedia,
  type AuthoredSuggestion,
  type Difficulty,
  questionsToDedupe,
  toQuestions,
} from './aiDraftUtils';

export default function RegenerateQuestion({
  question,
  roundTitle,
  allQuizQuestions,
  onReplace,
}: {
  question: Question;
  roundTitle: string;
  allQuizQuestions: Question[];
  /** Replace this slot; keep the existing question id. */
  onReplace: (next: Question) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AuthoredSuggestion | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function regenerate() {
    if (!(await askConfirm(
      `Regenerate this ${question.type.replace('_', ' ')} question?\n\nYou’ll review a draft before anything replaces the current slot.`,
    ))) {
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    setDraft(null);
    try {
      const dedupe = questionsToDedupe(
        allQuizQuestions.filter((q) => q.id !== question.id),
      );
      const res = await hostFetch('/api/ai/author', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: roundTitle || 'this round',
          category: roundTitle || 'general knowledge',
          difficulty: 'medium' as Difficulty,
          questionType: question.type as QuestionType,
          count: 1,
          job: 'single',
          roundMode: true,
          existingQuestions: dedupe,
          extraInstructions: `Rewrite a single ${question.type} question for this round. Keep the same type. Do not repeat existing prompts or answers.`,
        }),
      });
      const data = await res.json();
      if (res.status === 429 || data.code === 'rate_limited') {
        setError(data.error || data.hint || 'AI rate limited — wait, then try once.');
        return;
      }
      if (!res.ok) {
        setError(data.hint || data.error || 'Regenerate failed');
        return;
      }
      const suggestions: AuthoredSuggestion[] = data.suggestions || [];
      if (!suggestions[0]) {
        setError('AI returned no draft');
        return;
      }
      setDraft(suggestions[0]);
      setNote(data.disclaimer || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Regenerate failed');
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const [base] = toQuestions([draft]);
      if (!base) {
        setError('Could not convert draft');
        return;
      }
      const { questions, note: mediaNote } = await attachCatalogMedia([base], [draft]);
      const next = questions[0];
      if (!next) {
        setError('Media attach failed');
        return;
      }
      // Keep slot id so host/TV references stay stable.
      const replaced: Question = { ...next, id: question.id };
      onReplace(replaced);
      try {
        await hostFetch('/api/bank', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roundTitle,
            items: [{
              prompt: replaced.prompt,
              type: replaced.type,
              acceptedAnswers: replaced.acceptedAnswers,
              points: replaced.points,
              choices: replaced.choices,
              notes: replaced.notes,
              source: 'ai-regenerate',
              roundTitle,
            }],
          }),
        });
      } catch { /* non-blocking */ }
      setDraft(null);
      setNote(mediaNote);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 w-full sm:w-auto sm:min-w-[12rem] sm:max-w-md sm:ml-auto">
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-ghost text-sm"
          disabled={busy}
          onClick={() => void regenerate()}
        >
          {busy && !draft ? <RefreshCw size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {busy && !draft ? 'Rewriting…' : 'Regenerate'}
        </button>
      </div>
      {(busy || draft) && (
        <CardDealer
          slots={1}
          revealed={draft ? [{ id: draft.id, prompt: draft.prompt, type: draft.type }] : []}
          model="Sonnet"
          busy={busy && !draft}
          detail={busy && !draft ? 'Rewriting this one card…' : null}
        />
      )}
      {error && <p className="text-xs text-[var(--danger)] text-right">{error}</p>}
      {note && !draft && <p className="text-xs text-[var(--gold)] whitespace-pre-wrap text-right">{note}</p>}
      {draft && (
        <div className="rounded-xl border border-[var(--accent)]/40 bg-white/5 p-3 space-y-2 w-full">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
            <span className="uppercase tracking-wide text-[var(--gold)]">Draft</span>
            <span>{draft.type}</span>
            {draft.needsFactCheck && (
              <span className="uppercase tracking-wide text-[var(--warning)]">fact-check</span>
            )}
          </div>
          <p className="text-sm font-medium">{draft.prompt}</p>
          <p className="text-sm text-[var(--success)]">
            Answer: {draft.correctAnswer}
            {draft.acceptedVariants.length > 1
              ? ` (${draft.acceptedVariants.slice(1).join(' | ')})`
              : ''}
          </p>
          {draft.hostNotes && <p className="text-xs text-[var(--muted)]">{draft.hostNotes}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="btn text-sm"
              disabled={busy}
              onClick={() => void accept()}
            >
              {busy ? 'Replacing…' : 'Accept & replace'}
            </button>
            <button
              type="button"
              className="btn btn-ghost text-sm"
              disabled={busy}
              onClick={() => { setDraft(null); setError(null); }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
