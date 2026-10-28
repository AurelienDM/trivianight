import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Download, Library, Play, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { hostFetch } from '../lib/hostAuth';
import { askConfirm } from '../lib/dialogs';
import type { Question, QuestionType, Quiz, Round } from '@shared/types';
import {
  answerLeaksInPrompt,
  looksLikeMultipleChoicePrompt,
  numericPromptMismatch,
} from '@shared/questionNormalize';
import MediaPicker from '../components/editor/MediaPicker';
import AiGeneratePanel, { mergeFillQuestions } from '../components/editor/AiGeneratePanel';
import AiGenerateFullQuiz from '../components/editor/AiGenerateFullQuiz';
import {
  attachCatalogMedia,
  type AuthoredSuggestion,
  questionsToDedupe,
  toQuestions,
} from '../components/editor/aiDraftUtils';
import QuestionBankPanel from '../components/editor/QuestionBankPanel';
import RegenerateQuestion from '../components/editor/RegenerateQuestion';
import { THEME_OPTIONS } from '../hooks/useRoomTheme';
import AdminShell from '../components/admin/AdminShell';
import type { ThemeId } from '@shared/types';

async function pushQuestionsToBank(questions: Question[], source: string, roundTitle?: string) {
  try {
    await hostFetch('/api/bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roundTitle,
        items: questions.map((q) => ({
          prompt: q.prompt,
          type: q.type,
          acceptedAnswers: q.acceptedAnswers,
          points: q.points,
          choices: q.choices,
          notes: q.notes,
          media: q.media,
          source,
          roundTitle,
        })),
      }),
    });
  } catch {
    /* non-blocking */
  }
}

const TYPES: QuestionType[] = [
  'open', 'music', 'image', 'brand_logo', 'numeric', 'ordering', 'multiple_choice',
];

function blankQuestion(i: number): Question {
  return {
    id: crypto.randomUUID(),
    type: 'open',
    prompt: `Question ${i + 1}`,
    points: 1,
    acceptedAnswers: [''],
  };
}

export default function Editor() {
  const { quizId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [roundIndex, setRoundIndex] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forceBankOpen, setForceBankOpen] = useState(false);
  const [autoFill, setAutoFill] = useState(false);
  const [draftingOne, setDraftingOne] = useState(false);
  const aiSectionRef = useRef<HTMLDivElement | null>(null);
  const bankSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`/api/quizzes/${quizId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Quiz not found'))))
      .then(setQuiz)
      .catch((e) => setError(e.message));
  }, [quizId]);

  useEffect(() => {
    const start = searchParams.get('start');
    if (!start || !quiz) return;
    if (start === 'ai') {
      if (searchParams.get('fill') === '1') setAutoFill(true);
      aiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (start === 'bank') {
      setForceBankOpen(true);
      requestAnimationFrame(() => {
        bankSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    const next = new URLSearchParams(searchParams);
    next.delete('start');
    next.delete('fill');
    setSearchParams(next, { replace: true });
  }, [quiz, searchParams, setSearchParams]);

  async function save(next: Quiz) {
    setQuiz(next);
    setStatus('Saving…');
    const res = await hostFetch(`/api/quizzes/${quizId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    setStatus(res.ok ? 'Saved' : 'Save failed');
    setTimeout(() => setStatus(null), 1500);
  }

  function updateRound(mutator: (r: Round) => Round) {
    if (!quiz) return;
    const rounds = quiz.rounds.map((r, i) => (i === roundIndex ? mutator(r) : r));
    save({ ...quiz, rounds });
  }

  function updateQuestion(qi: number, patch: Partial<Question>) {
    updateRound((r) => ({
      ...r,
      questions: r.questions.map((q, i) => (i === qi ? { ...q, ...patch } : q)),
    }));
  }

  function exportJson() {
    if (!quiz) return;
    const blob = new Blob([JSON.stringify(quiz, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${quiz.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File) {
    const text = await file.text();
    const data = JSON.parse(text);
    const res = await hostFetch('/api/quizzes/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, id: undefined }),
    });
    if (res.ok) {
      const created = await res.json();
      window.location.href = `/editor/${created.id}`;
    } else {
      setError('Import failed');
    }
  }

  async function deleteQuiz(force = false) {
    if (!quiz) return;
    if (!force) {
      const ok = await askConfirm(`Delete “${quiz.name}”? This cannot be undone.`);
      if (!ok) return;
    }
    const res = await hostFetch(`/api/quizzes/${quiz.id}${force ? '?force=1' : ''}`, { method: 'DELETE' });
    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      const rooms = Array.isArray(data.rooms) ? data.rooms.join(', ') : 'active rooms';
      const forceOk = await askConfirm(
        `Quiz is in use by room(s): ${rooms}.\n\nForce delete closes those rooms and removes the quiz?`,
      );
      if (forceOk) return deleteQuiz(true);
      return;
    }
    if (!res.ok) {
      setError('Delete failed');
      return;
    }
    navigate('/');
  }

  if (error) {
    return (
      <AdminShell contextLabel="Editor">
        <p className="text-[var(--danger)]">{error}</p>
      </AdminShell>
    );
  }
  if (!quiz) {
    return (
      <AdminShell contextLabel="Editor">
        <p className="text-[var(--muted)]">Loading editor…</p>
      </AdminShell>
    );
  }

  const round = quiz.rounds[roundIndex];
  const currentQuiz = quiz;

  async function draftOne() {
    if (!round) return;
    setDraftingOne(true);
    setError(null);
    try {
      const res = await hostFetch('/api/ai/author', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: round.title || 'this round',
          category: round.title || 'general knowledge',
          difficulty: 'medium',
          questionType: 'any',
          count: 1,
          job: 'single',
          roundMode: true,
          existingQuestions: questionsToDedupe(currentQuiz.rounds.flatMap((r) => r.questions)),
          extraInstructions: 'Write one new question for this round. Do not repeat existing prompts or answers.',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.hint || data.error || 'Could not draft a question');
        return;
      }
      const suggestion = (data.suggestions as AuthoredSuggestion[] | undefined)?.[0];
      if (!suggestion) {
        setStatus('AI returned no draft');
        return;
      }
      const ok = await askConfirm(
        `Sonnet drafted:\n\n${suggestion.prompt}\n\nAnswer: ${suggestion.correctAnswer}\n\nAdd it to this round?`,
      );
      if (!ok) return;
      const [base] = toQuestions([suggestion]);
      if (!base) return;
      const { questions } = await attachCatalogMedia([base], [suggestion]);
      const nextQ = questions[0];
      if (!nextQ) return;
      updateRound((r) => ({
        ...r,
        questions: mergeFillQuestions(r.questions, [nextQ], 16),
      }));
      setStatus('Added one Sonnet draft');
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not draft a question');
    } finally {
      setDraftingOne(false);
    }
  }

  return (
    <AdminShell contextLabel="Editor">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <input
          className="input text-2xl font-semibold flex-1 min-w-[12rem]"
          value={quiz.name}
          onChange={(e) => setQuiz({ ...quiz, name: e.target.value })}
          onBlur={() => save(quiz)}
        />
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="input w-auto"
            value={quiz.settings?.themeId ?? 'modern'}
            onChange={(e) => save({
              ...quiz,
              settings: {
                ...quiz.settings,
                themeId: e.target.value as ThemeId,
              },
            })}
          >
            {THEME_OPTIONS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <button className="btn btn-ghost" type="button" onClick={exportJson}>
            <Download size={16} /> Export
          </button>
          <label className="btn btn-ghost cursor-pointer">
            <Upload size={16} /> Import
            <input type="file" accept="application/json" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
            }} />
          </label>
          <button className="btn btn-ghost text-[var(--danger)]" type="button" onClick={() => void deleteQuiz()}>
            <Trash2 size={16} /> Delete
          </button>
          <Link className="btn" to={`/host/${quiz.id}`}>
            <Play size={16} /> Host
          </Link>
        </div>
      </div>
      {status && <p className="text-sm text-[var(--muted)]">{status}</p>}

      <section className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          className="panel p-4 text-left hover:bg-white/5 transition-colors"
          onClick={() => aiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)] font-bold">Build</p>
          <h3 className="mt-1 font-semibold inline-flex items-center gap-2"><Sparkles size={16} /> Generate via AI</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">Jump to full-quiz / round AI drafts.</p>
        </button>
        <button
          type="button"
          className="panel p-4 text-left hover:bg-white/5 transition-colors"
          onClick={() => {
            setForceBankOpen(true);
            requestAnimationFrame(() => {
              bankSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
          }}
        >
          <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)] font-bold">Build</p>
          <h3 className="mt-1 font-semibold inline-flex items-center gap-2"><Library size={16} /> Pick from question bank</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">Open bank browse for this round.</p>
        </button>
      </section>

      <div ref={aiSectionRef} className="space-y-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">AI generate</p>
          <p className="text-xs text-[var(--muted)] mt-1">
            All rounds · 1 round (below) · Regenerate on each question card.
          </p>
        </div>
        <AiGenerateFullQuiz
          quiz={quiz}
          autoFill={autoFill}
          onPublish={(updates) => {
            const rounds = quiz.rounds.map((r, i) => {
              const u = updates.find((x) => x.roundIndex === i);
              if (!u) return r;
              return { ...r, questions: u.questions };
            });
            for (const u of updates) {
              const title = quiz.rounds[u.roundIndex]?.title;
              void pushQuestionsToBank(u.questions, 'editor-publish-full', title);
            }
            void save({ ...quiz, rounds });
          }}
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {quiz.rounds.map((r, i) => (
          <button
            key={r.id}
            type="button"
            className={`btn text-sm whitespace-nowrap ${i === roundIndex ? '' : 'btn-ghost'}`}
            onClick={() => setRoundIndex(i)}
          >
            {r.title}
          </button>
        ))}
      </div>

      {round && (
        <section className="mt-4 space-y-4">
          <input
            className="input text-xl"
            value={round.title}
            onChange={(e) => updateRound((r) => ({ ...r, title: e.target.value }))}
          />
          <AiGeneratePanel
            roundTitle={round.title}
            slotCount={Math.max(8, round.questions.length || 0)}
            existingQuestions={round.questions}
            allQuizQuestions={quiz.rounds.flatMap((r) => r.questions)}
            onPublish={(newQs, mode) => {
              updateRound((r) => {
                if (mode === 'replace') {
                  return { ...r, questions: newQs.slice(0, 16) };
                }
                return { ...r, questions: mergeFillQuestions(r.questions, newQs, 16) };
              });
              void pushQuestionsToBank(newQs, 'editor-publish', round.title);
              setStatus(
                mode === 'replace'
                  ? `Published ${newQs.length} AI question(s) (replaced round)`
                  : `Published ${newQs.length} AI question(s) (filled empty slots)`,
              );
              setTimeout(() => setStatus(null), 2500);
            }}
          />
          <div ref={bankSectionRef}>
            <QuestionBankPanel
              forceOpen={forceBankOpen}
              onAddToRound={(qs) => {
                updateRound((r) => ({
                  ...r,
                  questions: mergeFillQuestions(r.questions, qs, 16),
                }));
                setStatus(`Added ${qs.length} from bank`);
                setTimeout(() => setStatus(null), 2000);
              }}
            />
          </div>
          {round.questions.map((q, qi) => (
            <div key={q.id} className="panel p-4 space-y-3">
              <div className="flex flex-wrap gap-2 items-start justify-between">
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-sm text-[var(--muted)]">Q{qi + 1}</span>
                  <select
                    className="input w-auto"
                    value={q.type}
                    onChange={(e) => {
                      const type = e.target.value as QuestionType;
                      const patch: Partial<Question> = { type };
                      if (type === 'brand_logo' && (!q.prompt.trim() || /^Question\s+\d+$/i.test(q.prompt))) {
                        patch.prompt = 'Which brand does this logo belong to?';
                      }
                      updateQuestion(qi, patch);
                    }}
                  >
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    className="input w-24"
                    type="number"
                    min={0}
                    value={q.points}
                    onChange={(e) => updateQuestion(qi, { points: Number(e.target.value) })}
                  />
                </div>
                <RegenerateQuestion
                  question={q}
                  roundTitle={round.title}
                  allQuizQuestions={quiz.rounds.flatMap((r) => r.questions)}
                  onReplace={(next) => {
                    updateRound((r) => ({
                      ...r,
                      questions: r.questions.map((qq, i) => (i === qi ? next : qq)),
                    }));
                    setStatus('Replaced question from AI regenerate');
                    setTimeout(() => setStatus(null), 2000);
                  }}
                />
              </div>
              <textarea
                className="input min-h-[72px]"
                value={q.prompt}
                onChange={(e) => updateQuestion(qi, { prompt: e.target.value })}
                placeholder="Question prompt"
              />
              {numericPromptMismatch(q.type, q.prompt) && (
                <p className="text-xs text-[var(--danger)]">
                  This prompt reads like a name/which question — use type <strong>open</strong>, or rephrase as “How many…” / “What year…”.
                </p>
              )}
              {answerLeaksInPrompt(q.prompt, q.acceptedAnswers) && (
                <p className="text-xs text-[var(--danger)]">
                  The accepted answer appears to be revealed in the prompt — rewrite so teams can’t read it off the question.
                </p>
              )}
              {looksLikeMultipleChoicePrompt(q.prompt) && q.type !== 'multiple_choice' && (
                <p className="text-xs text-[var(--danger)]">
                  This reads like a pick-list — use type <strong>multiple_choice</strong> with 4 choices.
                </p>
              )}
              <input
                className="input"
                value={q.acceptedAnswers.join(' | ')}
                onChange={(e) => updateQuestion(qi, {
                  acceptedAnswers: e.target.value.split('|').map((s) => s.trim()).filter(Boolean),
                })}
                placeholder="Accepted answers (separate aliases with |)"
              />
              {q.type === 'multiple_choice' && (
                <input
                  className="input"
                  value={(q.choices ?? []).join(' | ')}
                  onChange={(e) => updateQuestion(qi, {
                    choices: e.target.value.split('|').map((s) => s.trim()).filter(Boolean),
                  })}
                  placeholder="Choices ( | separated, 4 clean options — not A|Vienna|B|…)"
                />
              )}
              {q.type === 'multiple_choice' && (q.choices?.length ?? 0) < 2 && (
                <p className="text-xs text-[var(--danger)]">Multiple choice needs at least 2 choices (prefer 4).</p>
              )}
              {q.type === 'numeric' && (
                <input
                  className="input"
                  type="number"
                  value={q.numeric?.exact ?? ''}
                  onChange={(e) => updateQuestion(qi, {
                    numeric: { ...q.numeric, exact: Number(e.target.value) },
                    acceptedAnswers: [e.target.value],
                  })}
                  placeholder="Exact number"
                />
              )}
              {q.type === 'ordering' && (
                <input
                  className="input"
                  value={(q.orderItems ?? []).join(' > ')}
                  onChange={(e) => {
                    const orderItems = e.target.value.split('>').map((s) => s.trim()).filter(Boolean);
                    updateQuestion(qi, { orderItems, acceptedAnswers: orderItems });
                  }}
                  placeholder="Correct order (A > B > C)"
                />
              )}
              {(q.type === 'music' || q.type === 'video' || q.type === 'image' || q.type === 'brand_logo') && (
                <MediaPicker
                  value={q.media}
                  questionType={q.type}
                  suggestQuery={q.type === 'brand_logo' ? (q.acceptedAnswers?.[0] || '') : q.prompt}
                  acceptedAnswers={q.acceptedAnswers}
                  onChange={(media) => updateQuestion(qi, { media })}
                />
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {round.questions.length < 16 && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => updateRound((r) => ({
                  ...r,
                  questions: [...r.questions, blankQuestion(r.questions.length)],
                }))}
              >
                <Plus size={16} /> Add question
              </button>
            )}
            <button
              className="btn btn-ghost"
              type="button"
              disabled={draftingOne}
              onClick={() => void draftOne()}
            >
              <Sparkles size={16} /> {draftingOne ? 'Drafting…' : 'Draft one'}
            </button>
          </div>
        </section>
      )}

      <p className="mt-8 text-sm text-[var(--muted)]">
        Bulk drafts use Haiku. Regenerating or drafting one question uses Sonnet. Nothing is added until you accept it. Music uses Deezer search.
      </p>
    </AdminShell>
  );
}
