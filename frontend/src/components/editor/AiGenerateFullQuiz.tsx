import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import CardDealer, { type DealtCard } from './CardDealer';
import { askChoice, askConfirm } from '../../lib/dialogs';
import type { Question, QuestionType, Quiz } from '@shared/types';
import {
  AI_DRAFT_TYPES,
  attachCatalogMedia,
  authorRoundWithRetry,
  type AuthoredSuggestion,
  categoryFromRound,
  type Difficulty,
  draftsToDedupe,
  isPlaceholderQuestion,
  type PublishMode,
  mergeFillQuestions,
  questionsToDedupe,
  roundLooksEmpty,
  toQuestions,
} from './aiDraftUtils';

type RoundDrafts = {
  roundIndex: number;
  title: string;
  drafts: AuthoredSuggestion[];
  selected: Record<string, boolean>;
  open: boolean;
};

export default function AiGenerateFullQuiz({
  quiz,
  onPublish,
  autoFill = false,
}: {
  quiz: Quiz;
  /** Apply published questions per round (mode per round). */
  onPublish: (updates: Array<{ roundIndex: number; questions: Question[]; mode: PublishMode }>) => void;
  /** After setup, draft only the still-empty slots with the bulk model. */
  autoFill?: boolean;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [questionType, setQuestionType] = useState<QuestionType | 'any'>('any');
  const [count, setCount] = useState(() => Math.min(16, Math.max(1, quiz.settings?.questionsPerRound ?? 8)));
  const autoStarted = useRef(false);
  const fillMode = useRef(false);
  const [era, setEra] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rounds, setRounds] = useState<RoundDrafts[]>([]);
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

  function patchDraft(roundIndex: number, id: string, patch: Partial<AuthoredSuggestion>) {
    setRounds((prev) => prev.map((r) => {
      if (r.roundIndex !== roundIndex) return r;
      return {
        ...r,
        drafts: r.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      };
    }));
  }

  async function generateAll(fillGaps = false) {
    if (!quiz.rounds.length) {
      setError('Quiz has no rounds');
      return;
    }
    fillMode.current = fillGaps;
    setBusy(true);
    setError(null);
    setNote(null);
    setRounds([]);
    const dedupePool = questionsToDedupe(quiz.rounds.flatMap((r) => r.questions));
    const collected: RoundDrafts[] = [];

    try {
      for (let i = 0; i < quiz.rounds.length; i++) {
        const round = quiz.rounds[i]!;
        const gaps = round.questions.filter(isPlaceholderQuestion).length
          || (round.questions.length === 0 ? count : 0);
        const n = fillGaps ? gaps : count;
        if (n < 1) continue;
        const theme = round.title || `Round ${i + 1}`;
        const category = categoryFromRound(round);
        setDealt([]);
        setProgress(`Dealing round ${i + 1} of ${quiz.rounds.length}: ${theme}…`);

        const { suggestions, disclaimer } = await authorRoundWithRetry(
          {
            theme,
            category,
            difficulty,
            questionType,
            count: n,
            era: era || undefined,
            extraInstructions: extra || undefined,
            roundMode: true,
            job: 'bulk',
            existingQuestions: dedupePool,
          },
          {
            onRetry: (waitMs, attempt) => {
              setProgress(
                `Rate limited on round ${i + 1} — waiting ${Math.ceil(waitMs / 1000)}s (retry ${attempt})…`,
              );
            },
          },
        );

        setDealt(suggestions.map((s) => ({ id: s.id, prompt: s.prompt, type: s.type })));
        const selected: Record<string, boolean> = {};
        for (const s of suggestions) selected[s.id] = true;
        collected.push({
          roundIndex: i,
          title: theme,
          drafts: suggestions,
          selected,
          open: i === 0,
        });
        setRounds([...collected]);
        dedupePool.push(...draftsToDedupe(suggestions));
        if (disclaimer) setNote(disclaimer);
      }
      setProgress(collected.length
        ? `Drafted ${collected.length} round(s) — review below, then publish selected.`
        : null);
      if (!collected.length && fillGaps) {
        setNote('Bank questions already fill every slot. Nothing left for a Haiku draft.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed');
      if (collected.length) {
        setRounds(collected);
        setProgress(`Stopped after ${collected.length} round(s) — review partial drafts or retry.`);
      } else {
        setProgress(null);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoFill || configured !== true || autoStarted.current) return;
    autoStarted.current = true;
    void generateAll(true);
    // Kick off once when the setup sheet asked for AI gaps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFill, configured]);

  async function publishSelected() {
    const updates: Array<{ roundIndex: number; questions: Question[]; mode: PublishMode; drafts: AuthoredSuggestion[] }> = [];
    for (const r of rounds) {
      const picked = r.drafts.filter((d) => r.selected[d.id]);
      if (!picked.length) continue;
      updates.push({
        roundIndex: r.roundIndex,
        questions: [],
        mode: 'replace',
        drafts: picked,
      });
    }
    if (!updates.length) {
      setError('Select at least one draft to publish');
      return;
    }

    const total = updates.reduce((n, u) => n + u.drafts.length, 0);
    if (!(await askConfirm(
      `Publish ${total} selected draft(s) across ${updates.length} round(s)?\n\nFact-check flagged items first. Nothing is published until you confirm.`,
    ))) {
      return;
    }

    // One mode choice if any target round has content
    let sharedMode: PublishMode | null = null;
    const anyContent = updates.some((u) => {
      const existing = quiz.rounds[u.roundIndex]?.questions ?? [];
      return !roundLooksEmpty(existing);
    });
    if (anyContent && fillMode.current) {
      sharedMode = 'fill';
    } else if (anyContent) {
      const choice = await askChoice(
        'Some rounds already have content. How should published drafts be applied?',
        [
          { id: 'replace', label: 'Replace entire round(s)', primary: true },
          { id: 'fill', label: 'Fill empty slots only' },
        ],
      );
      if (!choice) return;
      sharedMode = choice as PublishMode;
    }

    setBusy(true);
    setProgress('Attaching Deezer previews…');
    try {
      const publishPayload: Array<{ roundIndex: number; questions: Question[]; mode: PublishMode }> = [];
      const notes: string[] = [];
      for (const u of updates) {
        const existing = quiz.rounds[u.roundIndex]?.questions ?? [];
        const mode = sharedMode ?? (roundLooksEmpty(existing) ? 'replace' : 'replace');
        const base = toQuestions(u.drafts);
        const { questions, note } = await attachCatalogMedia(base, u.drafts);
        if (note) notes.push(`R${u.roundIndex + 1}: ${note}`);
        publishPayload.push({
          roundIndex: u.roundIndex,
          questions: mode === 'fill'
            ? mergeFillQuestions(existing, questions, 16)
            : questions.slice(0, 16),
          mode,
        });
      }
      onPublish(publishPayload);
      setRounds([]);
      setProgress(null);
      setNote(notes.length ? notes.join('\n') : 'Published selected drafts.');
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
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--gold)]">AI · Full quiz</p>
        <h3 className="font-semibold">Generate all {quiz.rounds.length || 0} rounds</h3>
        <p className="text-sm text-[var(--muted)]">
          No Mistral or Anthropic API key configured for the selected provider. Add one in Settings to draft all rounds at once.
        </p>
        <Link className="btn btn-ghost text-sm inline-flex" to="/settings">Open Settings</Link>
      </div>
    );
  }

  const roundCount = quiz.rounds.length;
  const selectedCount = rounds.reduce(
    (n, r) => n + r.drafts.filter((d) => r.selected[d.id]).length,
    0,
  );

  return (
    <div className="panel p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--gold)]">AI · Full quiz</p>
        <h3 className="font-semibold text-lg mt-1">Generate all {roundCount} rounds</h3>
        <p className="text-xs text-[var(--muted)] mt-1">
          Drafts every round sequentially using each round’s title/theme ({roundCount} × up to {count} Qs).
          Dedupes across the whole quiz. Review by round, then Publish — nothing goes live until you confirm.
          {activeModel ? <> Bulk model (Haiku): <span className="font-mono text-[var(--gold)]">{activeModel}</span>.</> : null}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="text-[var(--muted)]">Difficulty</span>
          <select className="input mt-1" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-[var(--muted)]">Question type mix</span>
          <select className="input mt-1" value={questionType} onChange={(e) => setQuestionType(e.target.value as QuestionType | 'any')}>
            {AI_DRAFT_TYPES.map((t) => (
              <option key={t} value={t}>{t === 'any' ? 'Any / mixed' : t}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-[var(--muted)]">Qs per round (1–16)</span>
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
          placeholder="e.g. UK-friendly, avoid sports"
        />
      </label>

      <CardDealer
        slots={count}
        revealed={dealt}
        model="Haiku"
        busy={busy}
        detail={progress}
      />

      <button className="btn" type="button" disabled={busy || !roundCount} onClick={() => void generateAll(false)}>
        <Sparkles size={16} />
        {busy ? 'Generating…' : `Generate all ${roundCount} rounds`}
      </button>

      {progress && <p className="text-sm text-[var(--accent-2)]">{progress}</p>}
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      {note && <p className="text-xs text-[var(--gold)] whitespace-pre-wrap">{note}</p>}

      {rounds.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <p className="text-sm font-medium">
              Review by round ({selectedCount} selected across {rounds.length} round{rounds.length === 1 ? '' : 's'})
            </p>
            <button className="btn btn-success text-sm" type="button" disabled={busy || !selectedCount} onClick={() => void publishSelected()}>
              Publish selected
            </button>
          </div>

          {rounds.map((r) => (
            <div key={r.roundIndex} className="rounded-xl border border-white/10">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white/5"
                onClick={() => setRounds((prev) => prev.map((x) => (
                  x.roundIndex === r.roundIndex ? { ...x, open: !x.open } : x
                )))}
              >
                <span className="font-medium text-sm">
                  Round {r.roundIndex + 1}: {r.title}
                  <span className="text-[var(--muted)] font-normal ml-2">
                    {r.drafts.filter((d) => r.selected[d.id]).length}/{r.drafts.length}
                  </span>
                </span>
                <span className="text-xs text-[var(--muted)]">{r.open ? 'Collapse' : 'Expand'}</span>
              </button>

              {r.open && (
                <div className="border-t border-white/10 p-3 space-y-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      onClick={() => setRounds((prev) => prev.map((x) => {
                        if (x.roundIndex !== r.roundIndex) return x;
                        const selected: Record<string, boolean> = {};
                        for (const d of x.drafts) selected[d.id] = true;
                        return { ...x, selected };
                      }))}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      onClick={() => setRounds((prev) => prev.map((x) => (
                        x.roundIndex === r.roundIndex ? { ...x, selected: {} } : x
                      )))}
                    >
                      Deselect
                    </button>
                  </div>

                  {r.drafts.map((d, idx) => (
                    <div key={d.id} className="rounded-lg bg-white/5 p-3 space-y-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        <input
                          type="checkbox"
                          checked={!!r.selected[d.id]}
                          onChange={(e) => setRounds((prev) => prev.map((x) => (
                            x.roundIndex === r.roundIndex
                              ? { ...x, selected: { ...x.selected, [d.id]: e.target.checked } }
                              : x
                          )))}
                        />
                        <span className="text-xs text-[var(--muted)]">Draft {idx + 1}</span>
                        <select
                          className="input w-auto text-sm"
                          value={d.type}
                          onChange={(e) => patchDraft(r.roundIndex, d.id, { type: e.target.value as QuestionType })}
                        >
                          {AI_DRAFT_TYPES.filter((t) => t !== 'any').map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        {d.needsFactCheck && (
                          <span className="text-[10px] uppercase tracking-wide text-[var(--warning)]">fact-check</span>
                        )}
                      </div>
                      <textarea
                        className="input min-h-[3.5rem]"
                        value={d.prompt}
                        onChange={(e) => patchDraft(r.roundIndex, d.id, { prompt: e.target.value })}
                      />
                      <input
                        className="input"
                        value={d.correctAnswer}
                        onChange={(e) => {
                          const correctAnswer = e.target.value;
                          const variants = d.acceptedVariants.filter((v) => v !== d.correctAnswer);
                          if (correctAnswer && !variants.includes(correctAnswer)) variants.unshift(correctAnswer);
                          patchDraft(r.roundIndex, d.id, {
                            correctAnswer,
                            acceptedVariants: variants.length ? variants : [correctAnswer],
                          });
                        }}
                        placeholder="Correct answer"
                      />
                      {d.hostNotes && <p className="text-xs text-[var(--muted)]">{d.hostNotes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
