import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import CardDealer, { type DealtCard } from './CardDealer';
import { hostFetch } from '../../lib/hostAuth';
import { askChoice, askConfirm } from '../../lib/dialogs';
import type { Question, QuestionType } from '@shared/types';
import {
  AI_DRAFT_TYPES,
  attachCatalogMedia,
  type AuthoredSuggestion,
  type Difficulty,
  type PublishMode,
  questionsToDedupe,
  roundLooksEmpty,
  toQuestions,
} from './aiDraftUtils';

export type { PublishMode } from './aiDraftUtils';
export { isPlaceholderQuestion, mergeFillQuestions, roundLooksEmpty } from './aiDraftUtils';

const TYPES = AI_DRAFT_TYPES;

export default function AiGeneratePanel({
  roundTitle,
  slotCount = 8,
  existingQuestions = [],
  allQuizQuestions = [],
  onPublish,
}: {
  roundTitle: string;
  slotCount?: number;
  existingQuestions?: Question[];
  /** Full quiz questions (all rounds) for AI dedupe */
  allQuizQuestions?: Question[];
  onPublish: (questions: Question[], mode: PublishMode) => void;
}) {
  const defaultCount = Math.min(16, Math.max(1, slotCount || 8));
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [theme, setTheme] = useState(roundTitle || '');
  const [category, setCategory] = useState('general knowledge');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [questionType, setQuestionType] = useState<QuestionType | 'any'>('any');
  const [count, setCount] = useState(defaultCount);
  const [era, setEra] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<AuthoredSuggestion[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [dealt, setDealt] = useState<DealtCard[]>([]);

  useEffect(() => {
    fetch('/api/ai/status')
      .then((r) => r.json())
      .then((s) => {
        setConfigured(!!s.authoringAvailable);
        setActiveModel(typeof s.bulkModel === 'string' ? s.bulkModel : (typeof s.model === 'string' ? s.model : null));
      })
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    setTheme((t) => t || roundTitle);
  }, [roundTitle]);

  useEffect(() => {
    setCount(Math.min(16, Math.max(1, slotCount || 8)));
  }, [slotCount]);

  function patchDraft(id: string, patch: Partial<AuthoredSuggestion>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setDisclaimer(null);
    setDealt([]);
    try {
      const dedupeSource = questionsToDedupe(
        allQuizQuestions.length ? allQuizQuestions : existingQuestions,
      );
      const res = await hostFetch('/api/ai/author', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: theme || roundTitle,
          category,
          difficulty,
          questionType,
          count,
          era: era || undefined,
          extraInstructions: extra || undefined,
          roundMode: true,
          job: 'bulk',
          existingQuestions: dedupeSource,
        }),
      });
      const data = await res.json();
      if (res.status === 429 || data.code === 'rate_limited') {
        setError(data.error || data.hint || 'AI rate limited — wait, then try once.');
        setDrafts([]);
        return;
      }
      if (!res.ok) {
        setError(data.hint || data.error || 'Generate failed');
        setDrafts([]);
        return;
      }
      const suggestions: AuthoredSuggestion[] = data.suggestions || [];
      setDrafts(suggestions);
      setDealt(suggestions.map((s) => ({ id: s.id, prompt: s.prompt, type: s.type })));
      setDisclaimer(data.disclaimer || null);
      const sel: Record<string, boolean> = {};
      for (const s of suggestions) sel[s.id] = true;
      setSelected(sel);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setBusy(false);
    }
  }

  async function publishSelected() {
    const picked = drafts.filter((d) => selected[d.id]);
    if (!picked.length) {
      setError('Select at least one draft to publish');
      return;
    }
    if (!(await askConfirm(
      `Publish ${picked.length} selected draft(s) into this round?\n\nFact-check flagged items first. Nothing is published until you confirm.`,
    ))) {
      return;
    }

    let mode: PublishMode = 'replace';
    if (roundLooksEmpty(existingQuestions)) {
      mode = 'replace';
    } else {
      const choice = await askChoice(
        'This round already has content. How should published drafts be applied?',
        [
          { id: 'replace', label: 'Replace entire round', primary: true },
          { id: 'fill', label: 'Fill empty slots only' },
        ],
      );
      if (!choice) return;
      mode = choice as PublishMode;
    }

    setBusy(true);
    try {
      const base = toQuestions(picked);
      const { questions, note } = await attachCatalogMedia(base, picked);
      onPublish(questions, mode);
      setDrafts([]);
      setSelected({});
      setDisclaimer(note);
      setError(null);
    } finally {
      setBusy(false);
    }
  }

  if (configured === null) {
    return <div className="panel p-4 text-sm text-[var(--muted)]">Checking AI…</div>;
  }

  if (!configured) {
    return (
      <div className="panel p-4 space-y-2">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--gold)]">AI · This round</p>
        <h3 className="font-semibold">Generate 1 round</h3>
        <p className="text-sm text-[var(--muted)]">
          No Mistral or Anthropic API key configured for the selected provider. Add one in Settings to draft a full round. The game works without AI.
        </p>
        <Link className="btn btn-ghost text-sm inline-flex" to="/settings">Open Settings</Link>
      </div>
    );
  }

  const selectedCount = drafts.filter((d) => selected[d.id]).length;
  const themeLabel = theme || roundTitle || 'this round';

  return (
    <div className="panel p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--gold)]">AI · This round</p>
        <h3 className="font-semibold text-lg mt-1">Generate 1 round</h3>
        <p className="text-xs text-[var(--muted)] mt-1">
          One call drafts up to {count} questions for <strong>{themeLabel}</strong>.
          Review and edit, then Publish — nothing is added until you confirm.
          {activeModel ? <> Bulk model (Haiku): <span className="font-mono text-[var(--gold)]">{activeModel}</span>.</> : null}
          {' '}Music uses Deezer (~30s previews). Per-card <strong>Regenerate</strong> rewrites a single question.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          <span className="text-[var(--muted)]">Round theme / title</span>
          <input className="input mt-1" value={theme} onChange={(e) => setTheme(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="text-[var(--muted)]">Category</span>
          <input className="input mt-1" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="music, film, geography…" />
        </label>
        <label className="text-sm">
          <span className="text-[var(--muted)]">Difficulty</span>
          <select className="input mt-1" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-[var(--muted)]">Question type</span>
          <select className="input mt-1" value={questionType} onChange={(e) => setQuestionType(e.target.value as QuestionType | 'any')}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t === 'any' ? 'Any / mixed' : t}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-[var(--muted)]">Count (1–16)</span>
          <input
            className="input mt-1"
            type="number"
            min={1}
            max={16}
            value={count}
            onChange={(e) => setCount(Math.min(16, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
        <label className="text-sm">
          <span className="text-[var(--muted)]">Era (optional)</span>
          <input className="input mt-1" value={era} onChange={(e) => setEra(e.target.value)} placeholder="90s / 2000s" />
        </label>
      </div>
      <label className="text-sm block">
        <span className="text-[var(--muted)]">Extra instructions</span>
        <input
          className="input mt-1"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="e.g. mostly UK pop culture, avoid sports"
        />
      </label>

      <CardDealer slots={count} revealed={dealt} model="Haiku" busy={busy} detail={busy ? 'Dealing this round…' : null} />

      <button className="btn" type="button" disabled={busy} onClick={() => void generate()}>
        <Sparkles size={16} />
        {busy ? 'Dealing…' : `Generate 1 round (${count} Qs)`}
      </button>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      {disclaimer && <p className="text-xs text-[var(--gold)]">{disclaimer}</p>}

      {drafts.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <p className="text-sm font-medium">Review drafts ({selectedCount}/{drafts.length} selected)</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => {
                  const sel: Record<string, boolean> = {};
                  for (const d of drafts) sel[d.id] = true;
                  setSelected(sel);
                }}
              >
                Select all
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => setSelected({})}
              >
                Deselect
              </button>
            </div>
          </div>

          {drafts.map((d, idx) => (
            <div key={d.id} className="rounded-xl border border-white/10 p-3 space-y-2">
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="checkbox"
                  checked={!!selected[d.id]}
                  onChange={(e) => setSelected({ ...selected, [d.id]: e.target.checked })}
                />
                <span className="text-xs text-[var(--muted)]">Draft {idx + 1}</span>
                <select
                  className="input w-auto text-sm"
                  value={d.type}
                  onChange={(e) => patchDraft(d.id, { type: e.target.value as QuestionType })}
                >
                  {TYPES.filter((t) => t !== 'any').map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {d.needsFactCheck && (
                  <span className="text-[10px] uppercase tracking-wide text-[var(--warning)]">fact-check</span>
                )}
                <button
                  type="button"
                  className="ml-auto text-xs text-[var(--danger)]"
                  onClick={() => {
                    setDrafts((prev) => prev.filter((x) => x.id !== d.id));
                    setSelected((prev) => {
                      const next = { ...prev };
                      delete next[d.id];
                      return next;
                    });
                  }}
                >
                  Remove
                </button>
              </div>
              <textarea
                className="input min-h-[4rem]"
                value={d.prompt}
                onChange={(e) => patchDraft(d.id, { prompt: e.target.value })}
                placeholder="Question prompt"
              />
              <input
                className="input"
                value={d.correctAnswer}
                onChange={(e) => {
                  const correctAnswer = e.target.value;
                  const variants = d.acceptedVariants.filter((v) => v !== d.correctAnswer);
                  if (correctAnswer && !variants.includes(correctAnswer)) variants.unshift(correctAnswer);
                  patchDraft(d.id, { correctAnswer, acceptedVariants: variants.length ? variants : [correctAnswer] });
                }}
                placeholder="Correct answer"
              />
              <input
                className="input text-sm"
                value={d.acceptedVariants.join(' | ')}
                onChange={(e) => {
                  const acceptedVariants = e.target.value.split('|').map((s) => s.trim()).filter(Boolean);
                  patchDraft(d.id, {
                    acceptedVariants,
                    correctAnswer: acceptedVariants[0] || d.correctAnswer,
                  });
                }}
                placeholder="Accepted variants ( | separated)"
              />
              {d.mediaSearchTerms?.length ? (
                <p className="text-xs text-[var(--accent-2)]">Search: {d.mediaSearchTerms.join('; ')}</p>
              ) : null}
              {d.hostNotes && <p className="text-xs text-[var(--muted)]">{d.hostNotes}</p>}
            </div>
          ))}

          <button className="btn btn-success" type="button" onClick={() => void publishSelected()}>
            Publish selected
          </button>
        </div>
      )}
    </div>
  );
}
