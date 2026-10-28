import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Layers, Lock, LockOpen, Send, SkipBack, SkipForward, Trophy } from 'lucide-react';
import { socket } from '../socket';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { useGameStore, type TeamSheetQuestion } from '../store/gameStore';
import ChoiceList from '../components/shared/ChoiceList';
import { askConfirm } from '../lib/dialogs';
import { useRoomTheme } from '../hooks/useRoomTheme';
import { useAdminThemeId } from '../hooks/useAdminTheme';
import TeamAvatar from '../components/shared/TeamAvatar';

function blankSheet(n: number): string[] {
  return Array.from({ length: n }, () => '');
}

function TeamLogo({ url }: { url: string }) {
  const preferred = url.startsWith('/api/logos/img') || url.startsWith('/media/')
    ? url
    : /^https?:\/\//i.test(url)
      ? `/api/logos/img?u=${encodeURIComponent(url)}`
      : url;
  const [src, setSrc] = useState(preferred);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setSrc(preferred);
    setTried(false);
  }, [preferred]);
  return (
    <div className="rounded-2xl bg-white px-6 py-8 flex items-center justify-center">
      <img
        src={src}
        alt=""
        className="max-h-36 max-w-full object-contain"
        onError={() => {
          if (!tried && !url.startsWith('/api/logos/img') && /^https?:\/\//i.test(url)) {
            setTried(true);
            setSrc(`/api/logos/img?u=${encodeURIComponent(url)}`);
          }
        }}
      />
    </div>
  );
}

export default function TeamSheet() {
  const { roomCode = '' } = useParams();
  const [searchParams] = useSearchParams();
  const code = roomCode.toUpperCase();
  const { gameState, myTeam, teamToken, teamSheet } = useGameStore();
  const [answers, setAnswers] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);
  const [optimisticSubmitted, setOptimisticSubmitted] = useState(false);
  /** Browse shown questions without host auto-follow jumping the view. */
  const [reviewMode, setReviewMode] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const answersRef = useRef<string[]>([]);
  const dirtyRef = useRef<Set<number>>(new Set());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countRef = useRef(8);
  const lockedRef = useRef(false);
  const submittedRef = useRef(false);
  const authRef = useRef<{ roomCode: string; teamId?: string; token?: string }>({ roomCode: code });

  const adminTheme = useAdminThemeId();
  useRoomTheme(gameState?.themeId ?? adminTheme);

  const locked = teamSheet?.locked || ['locked', 'reveal', 'scoring', 'leaderboard', 'finished'].includes(gameState?.phase ?? '');
  const count = teamSheet?.questionsInRound ?? gameState?.questionsInRound ?? 8;
  const phase = gameState?.phase ?? 'lobby';
  const questions = teamSheet?.questions ?? [];
  const shownIndexes =
    teamSheet?.shownQuestionIndexes ??
    gameState?.shownQuestionIndexes ??
    questions.map((q) => q.index);
  const shownSet = new Set(shownIndexes);
  const shownCount = shownIndexes.length;
  const submitted = optimisticSubmitted || !!teamSheet?.submitted;
  const lastQuestionIndex = count - 1;
  const lastQuestionShown = lastQuestionIndex >= 0 && shownSet.has(lastQuestionIndex);

  countRef.current = count;
  lockedRef.current = locked;
  submittedRef.current = submitted;
  authRef.current = {
    roomCode: code,
    teamId: myTeam?.id,
    token: teamToken ?? undefined,
  };

  function setAnswersBoth(next: string[]) {
    answersRef.current = next;
    setAnswers(next);
  }

  function markDirty(i: number) {
    dirtyRef.current.add(i);
  }

  function clearDirty(indexes?: number[]) {
    if (!indexes) {
      dirtyRef.current.clear();
      return;
    }
    for (const i of indexes) dirtyRef.current.delete(i);
  }

  /** Merge server sheet into local — never overwrite dirty local indexes. */
  function mergeServerAnswers(server: string[]) {
    const n = Math.max(countRef.current, server.length, answersRef.current.length);
    const next = blankSheet(n);
    for (let i = 0; i < n; i++) {
      if (dirtyRef.current.has(i)) {
        next[i] = answersRef.current[i] ?? '';
      } else {
        next[i] = server[i] ?? answersRef.current[i] ?? '';
      }
    }
    setAnswersBoth(next);
  }

  function persistCredentials(teamId: string, token: string) {
    try {
      localStorage.setItem(`trivia-night:team:${code}`, JSON.stringify({ teamId, token }));
    } catch { /* ignore */ }
  }

  function rejoinFromStorage() {
    try {
      const qTeam = searchParams.get('teamId');
      const qToken = searchParams.get('token');
      if (qTeam && qToken) {
        persistCredentials(qTeam, qToken);
        socket.emit(SOCKET_EVENTS.TEAM_REJOIN, { roomCode: code, teamId: qTeam, token: qToken });
        return;
      }
      const raw = localStorage.getItem(`trivia-night:team:${code}`);
      if (raw) {
        const { teamId, token } = JSON.parse(raw);
        if (teamId && token) {
          socket.emit(SOCKET_EVENTS.TEAM_REJOIN, { roomCode: code, teamId, token });
        }
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    rejoinFromStorage();
    socket.emit(SOCKET_EVENTS.GET_STATE, { roomCode: code });
  }, [code, searchParams]);

  // Rebind + flush after reconnect (socketTeams mapping is lost server-side)
  useEffect(() => {
    function onConnect() {
      rejoinFromStorage();
      if (myTeam?.id && teamToken) {
        socket.emit(SOCKET_EVENTS.TEAM_REJOIN, {
          roomCode: code,
          teamId: myTeam.id,
          token: teamToken,
        });
      }
      // Flush any dirty locals once rebound
      window.setTimeout(() => {
        if (!lockedRef.current && !submittedRef.current && dirtyRef.current.size > 0) {
          void flush(answersRef.current);
        }
      }, 200);
    }
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [code, myTeam?.id, teamToken]);

  useEffect(() => {
    if (teamSheet?.answers) mergeServerAnswers(teamSheet.answers);
    if (teamSheet?.submitted) {
      setOptimisticSubmitted(true);
      clearDirty();
    }
  }, [teamSheet]);

  // Follow live TV question when unlocked — flush current before jumping.
  // Review mode freezes follow so teams can browse earlier answers.
  useEffect(() => {
    if (reviewMode) return;
    if (gameState?.phase === 'questioning' && gameState.currentQuestion != null) {
      const live = gameState.currentQuestion.index;
      if (shownSet.has(live) && live !== viewIndex) {
        void flush(answersRef.current);
        setViewIndex(live);
      }
    }
  }, [gameState?.phase, gameState?.currentQuestion?.index, shownIndexes.join(','), reviewMode]);

  // New round / lock clears review mode
  useEffect(() => {
    setReviewMode(false);
  }, [gameState?.roundIndex, locked]);

  // Keep viewIndex on a shown question
  useEffect(() => {
    if (shownCount === 0) return;
    if (!shownSet.has(viewIndex)) {
      const live = gameState?.currentQuestion?.index;
      if (live != null && shownSet.has(live)) setViewIndex(live);
      else setViewIndex(shownIndexes[shownIndexes.length - 1]!);
    }
  }, [shownIndexes.join(','), viewIndex, gameState?.currentQuestion?.index]);

  // Flush on pagehide / visibility hidden
  useEffect(() => {
    function onHide() {
      if (!lockedRef.current && !submittedRef.current && dirtyRef.current.size > 0) {
        void flush(answersRef.current);
      }
    }
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
    });
    return () => {
      window.removeEventListener('pagehide', onHide);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const safeIndex = shownCount === 0
    ? 0
    : (shownSet.has(viewIndex) ? viewIndex : shownIndexes[shownIndexes.length - 1]!);
  const answeredCount = shownIndexes.filter((i) => (answers[i] ?? '').trim()).length;

  function flush(payload?: string[]): Promise<{ ok: boolean; error?: string }> {
    if (lockedRef.current || submittedRef.current) {
      return Promise.resolve({ ok: false, error: 'Answers are locked' });
    }
    const n = countRef.current;
    const full = blankSheet(n).map((_, i) => (payload ?? answersRef.current)[i] ?? '');
    setSaving(true);
    return new Promise((resolve) => {
      socket.timeout(8000).emit(
        SOCKET_EVENTS.TEAM_UPDATE_ANSWERS,
        { answers: full, ...authRef.current },
        (err: Error | null, res?: { ok: boolean; error?: string }) => {
          setSaving(false);
          if (err) {
            setStatus('Save failed');
            resolve({ ok: false, error: 'Save failed' });
            return;
          }
          if (res?.ok) {
            clearDirty();
            setStatus('Saved');
            setTimeout(() => setStatus((s) => (s === 'Saved' ? null : s)), 1200);
          } else {
            setStatus(res?.error ?? 'Save failed');
          }
          resolve(res ?? { ok: false, error: 'Save failed' });
        },
      );
    });
  }

  function scheduleFlush() {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      void flush(answersRef.current);
    }, 350);
  }

  function updateAnswer(i: number, value: string, autosave = false) {
    if (!shownSet.has(i) || lockedRef.current || submittedRef.current) return;
    const n = countRef.current;
    const next = blankSheet(n).map((_, idx) => answersRef.current[idx] ?? '');
    next[i] = value;
    markDirty(i);
    setAnswersBoth(next);
    if (autosave) {
      void flush(next);
    } else {
      scheduleFlush();
    }
  }

  async function submit() {
    if (!(await askConfirm(
      'Submit this round’s answers?\n\nYou won’t be able to edit until the host unlocks.',
    ))) {
      return;
    }
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    const n = countRef.current;
    const full = blankSheet(n).map((_, i) => answersRef.current[i] ?? '');
    setAnswersBoth(full);
    setOptimisticSubmitted(true);
    setStatus('Submitted — waiting for host');
    setReviewMode(false);
    socket.timeout(10000).emit(
      SOCKET_EVENTS.TEAM_SUBMIT,
      { answers: full, ...authRef.current },
      (err: Error | null, res?: { ok: boolean; error?: string }) => {
        if (err) {
          setOptimisticSubmitted(false);
          setStatus('Submit failed');
          return;
        }
        if (res?.ok) {
          clearDirty();
          setOptimisticSubmitted(true);
          setStatus('Submitted — waiting for host');
        } else {
          setOptimisticSubmitted(false);
          setStatus(res?.error ?? 'Submit failed');
        }
      },
    );
  }

  function goTo(nextIndex: number) {
    if (nextIndex === safeIndex) return;
    void flush(answersRef.current);
    setViewIndex(nextIndex);
  }

  function go(delta: number) {
    if (shownCount === 0) return;
    const order = [...shownIndexes].sort((a, b) => a - b);
    const pos = order.indexOf(safeIndex);
    const nextPos = Math.min(order.length - 1, Math.max(0, (pos < 0 ? 0 : pos) + delta));
    goTo(order[nextPos]!);
  }

  function metaFor(i: number): TeamSheetQuestion | undefined {
    return questions.find((q) => q.index === i);
  }

  if (!gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="panel p-6 text-center">
          <p>Connecting to room {code}…</p>
          <Link className="btn btn-ghost mt-4 inline-flex" to={`/join/${code}`}>Rejoin</Link>
        </div>
      </div>
    );
  }

  const myPlace = gameState.leaderboard.find((e) => e.teamId === myTeam?.id);
  const meta = metaFor(safeIndex);
  const type = meta?.type ?? 'open';
  const disabled = locked || submitted;
  const inPlay = phase === 'questioning' || phase === 'locked' || phase === 'reveal' || phase === 'scoring' || phase === 'leaderboard' || locked;
  const waitingForHostQuestion = phase === 'questioning' && shownCount === 0;
  const orderedShown = [...shownIndexes].sort((a, b) => a - b);
  const onLastQuestion = lastQuestionShown && (viewIndex === lastQuestionIndex || reviewMode);
  const canSubmitRound = lastQuestionShown && !submitted && !locked;
  const statusLabel = locked ? 'Locked' : submitted ? 'Submitted' : saving ? 'Saving' : reviewMode ? 'Review' : 'Editing';
  const statusClass = locked
    ? 'status-pill--locked'
    : submitted
      ? 'status-pill--submitted'
      : saving
        ? 'status-pill--saving'
        : 'status-pill--editing';

  return (
    <div className="stage min-h-screen px-3 py-4 pb-32 max-w-lg mx-auto">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {myTeam && (
            <TeamAvatar
              name={myTeam.name}
              color={myTeam.color}
              avatarUrl={myTeam.avatarUrl}
              size={48}
            />
          )}
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{gameState.quizName}</p>
            <h1 className="display text-4xl" style={{ color: myTeam?.color }}>{myTeam?.name ?? 'Team'}</h1>
            <p className="inline-flex items-center gap-1 text-sm text-[var(--muted)]">
              <Layers size={14} /> Round {gameState.roundIndex + 1}: {gameState.roundTitle} · {phase.replace('_', ' ')}
            </p>
          </div>
        </div>
        <div className="text-right text-sm space-y-1.5">
          <div className="inline-flex items-center gap-1 font-semibold"><Trophy size={14} /> {myTeam?.score ?? 0} pts</div>
          <span className={`status-pill ${statusClass}`}>{locked ? <Lock size={12} /> : <LockOpen size={12} />} {statusLabel}</span>
        </div>
      </header>

      {phase === 'lobby' && (
        <div className="panel mt-6 p-4 text-center anim-rise">
          <p className="text-lg">Waiting for the host to start…</p>
        </div>
      )}

      {phase === 'round_intro' && (
        <div className="panel mt-6 p-6 text-center anim-rise">
          <p className="text-xs uppercase tracking-widest text-[var(--muted)]">Up next</p>
          <h2 className="display text-5xl mt-2">{gameState.roundTitle}</h2>
          <p className="mt-2 text-[var(--muted)]">{count} questions — unlock as the host presents them</p>
        </div>
      )}

      {waitingForHostQuestion && (
        <div className="panel mt-6 p-6 text-center anim-rise">
          <p className="text-lg">Waiting for the host to show the first question…</p>
          <p className="mt-2 text-sm text-[var(--muted)]">Your sheet only unlocks questions once they appear on the TV.</p>
        </div>
      )}

      {phase === 'reveal' && teamSheet?.ownReveal && (
        <div className="panel mt-5 p-4 anim-rise space-y-2">
          <p className="text-xs uppercase tracking-widest text-[var(--muted)]">
            Reveal Q{teamSheet.ownReveal.index + 1}
          </p>
          <p className="text-lg">
            Answer: <span className="text-[var(--gold)] font-semibold">{teamSheet.ownReveal.revealedAnswer}</span>
          </p>
          <p className="text-sm">
            You scored{' '}
            <span className={teamSheet.ownReveal.pointsAwarded > 0 ? 'text-[var(--success)] font-semibold' : 'text-[var(--muted)]'}>
              +{teamSheet.ownReveal.pointsAwarded}
            </span>
            {' '}· round so far {teamSheet.ownReveal.roundPointsSoFar}
          </p>
        </div>
      )}

      {inPlay && phase !== 'finished' && !waitingForHostQuestion && shownCount > 0 && (
        <div
          className="mt-5 space-y-3"
          onTouchStart={(e) => { touchStartX.current = e.changedTouches[0]?.clientX ?? null; }}
          onTouchEnd={(e) => {
            const start = touchStartX.current;
            const end = e.changedTouches[0]?.clientX;
            touchStartX.current = null;
            if (start == null || end == null) return;
            const dx = end - start;
            if (Math.abs(dx) < 50) return;
            if (dx < 0) go(1);
            else go(-1);
          }}
        >
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">
              Question {safeIndex + 1} / {count}
            </span>
            <span className="text-[var(--muted)] text-right">
              Shown {shownCount}/{count} · answered {answeredCount}/{shownCount}
            </span>
          </div>

          <div className="flex justify-center gap-2 py-1.5">
            {Array.from({ length: count }, (_, i) => {
              const unlocked = shownSet.has(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={unlocked ? `Go to question ${i + 1}` : `Question ${i + 1} not shown yet`}
                  disabled={!unlocked}
                  className={`q-dot ${
                    !unlocked
                      ? 'bg-white/10 opacity-40 cursor-not-allowed'
                      : i === safeIndex
                        ? 'bg-[var(--gold)]'
                        : (answers[i] ?? '').trim()
                          ? 'bg-[var(--accent)]'
                          : 'bg-white/20'
                  }`}
                  onClick={() => unlocked && goTo(i)}
                />
              );
            })}
          </div>

          <div className="panel p-4 space-y-3 anim-rise" key={safeIndex}>
            <div className="flex justify-between text-xs text-[var(--muted)]">
              <span>
                Q{safeIndex + 1}
                {gameState.currentQuestion?.index === safeIndex && phase === 'questioning' ? ' · live on TV' : ''}
                {meta ? ` · ${type.replace('_', ' ')}` : ''}
              </span>
              {phase === 'reveal' && gameState.revealIndex === safeIndex && (
                <span className="text-[var(--gold)]">Revealing on TV</span>
              )}
            </div>
            {meta?.prompt && <p className="text-lg font-medium leading-snug">{meta.prompt}</p>}
            {meta?.mediaUrl && (type === 'brand_logo' || type === 'image') && (
              <TeamLogo url={meta.mediaUrl} />
            )}
            {meta?.hasMedia && !meta.mediaUrl && (
              <p className="text-xs text-[var(--accent-2)]">
                {type === 'music' || meta.mediaKind === 'deezer' || meta.mediaKind === 'spotify' || meta.mediaKind === 'audio'
                  ? '♪ Clip plays on the TV — answer here'
                  : 'Media cue on the TV — answer here'}
              </p>
            )}
            {meta?.hasMedia && meta.mediaUrl && type === 'brand_logo' && (
              <p className="text-xs text-[var(--muted)]">Name the brand — logo shown above</p>
            )}
            {type === 'multiple_choice' && meta?.choices?.length ? (
              <ChoiceList
                choices={meta.choices}
                selected={answers[safeIndex] ?? ''}
                disabled={disabled}
                onSelect={(choice) => updateAnswer(safeIndex, choice, true)}
              />
            ) : (
              <input
                className="input input-lg"
                type="text"
                value={answers[safeIndex] ?? ''}
                disabled={disabled}
                onChange={(e) => updateAnswer(safeIndex, e.target.value)}
                onBlur={() => {
                  if (!lockedRef.current && !submittedRef.current) void flush(answersRef.current);
                }}
                placeholder={
                  type === 'numeric'
                    ? 'Number…'
                    : type === 'ordering'
                      ? 'A > B > C'
                      : 'Your answer'
                }
                inputMode={type === 'numeric' ? 'decimal' : 'text'}
                autoComplete="off"
              />
            )}
          </div>

          <div className="flex gap-2">
            <button
              className="btn btn-ghost flex-1"
              type="button"
              disabled={orderedShown[0] === safeIndex}
              onClick={() => go(-1)}
            >
              <SkipBack size={16} /> Prev
            </button>
            <button
              className="btn btn-ghost flex-1"
              type="button"
              disabled={orderedShown[shownCount - 1] === safeIndex}
              onClick={() => go(1)}
            >
              Next <SkipForward size={16} />
            </button>
          </div>
        </div>
      )}

      {phase === 'finished' && (
        <div className="panel mt-6 p-6 text-center anim-pop space-y-4">
          <h2 className="display inline-flex items-center gap-2 text-5xl text-[var(--gold)]"><Trophy size={32} /> Final podium</h2>
          {myPlace && (
            <p className="text-xl">
              You finished <span className="text-[var(--gold)] font-semibold">#{myPlace.rank}</span>
              {' '}with {myPlace.score} pts
            </p>
          )}
          {!myPlace && <p className="mt-2">Final score: {myTeam?.score ?? 0}</p>}
          <ol className="text-left space-y-2 mt-4">
            {gameState.leaderboard.slice(0, 5).map((e) => (
              <li
                key={e.teamId}
                className="flex justify-between rounded-lg bg-white/5 px-3 py-2 text-sm"
                style={{ borderLeft: `3px solid ${e.color}` }}
              >
                <span>#{e.rank} {e.name}</span>
                <span className="tabular-nums font-semibold">{e.score}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!locked && phase !== 'lobby' && phase !== 'finished' && shownCount > 0 && !submitted && (
        <div className="phone-dock">
          {canSubmitRound && onLastQuestion ? (
            <div className="max-w-lg mx-auto space-y-2">
              <p className="text-center text-xs uppercase tracking-[0.18em] text-[var(--gold)]">End of round</p>
              <div className="phone-dock__inner">
                <button
                  className="btn btn-ghost flex-1"
                  type="button"
                  onClick={() => {
                    setReviewMode(true);
                    setStatus('Review mode — browse shown questions, then Submit');
                  }}
                >
                  Review questions
                </button>
                <button
                  className="btn btn-lg flex-1"
                  type="button"
                  onClick={() => void submit()}
                >
                  <Send size={16} /> Submit answers
                </button>
              </div>
              <button
                className="btn btn-ghost w-full"
                type="button"
                disabled={saving}
                onClick={() => void flush(answersRef.current)}
              >
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              {status && <p className="text-center text-xs text-[var(--muted)]">{status}</p>}
            </div>
          ) : (
            <div className="max-w-lg mx-auto space-y-1.5">
              <div className="phone-dock__inner">
                <button
                  className="btn btn-lg flex-1"
                  type="button"
                  disabled={saving}
                  onClick={() => void flush(answersRef.current)}
                >
                  {saving ? 'Saving…' : 'Save answer'}
                </button>
              </div>
              <p className="text-center text-xs text-[var(--muted)]">
                {lastQuestionShown
                  ? 'Go to the last question to review and submit.'
                  : 'Submit unlocks after the host shows the last question.'}
              </p>
              {status && <p className="text-center text-xs text-[var(--muted)]">{status}</p>}
            </div>
          )}
        </div>
      )}
      {submitted && !locked && (
        <div className="phone-dock">
          <p className="text-center text-sm">
            <span className="status-pill status-pill--submitted">Submitted</span>
          </p>
          {status && <p className="text-center text-xs mt-2 text-[var(--muted)]">{status}</p>}
        </div>
      )}
      {status && locked && <p className="mt-4 text-center text-sm text-[var(--muted)]">{status}</p>}
    </div>
  );
}
