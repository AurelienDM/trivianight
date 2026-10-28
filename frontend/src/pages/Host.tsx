import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { socket } from '../socket';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { useGameStore } from '../store/gameStore';
import type { GradeVerdict } from '@shared/types';
import JoinQr from '../components/shared/JoinQr';
import { useJoinNetwork } from '../hooks/useJoinNetwork';
import QuestionMedia from '../components/shared/QuestionMedia';
import Countdown from '../components/shared/Countdown';
import ChoiceList from '../components/shared/ChoiceList';
import HostMusicReplace from '../components/host/HostMusicReplace';
import { hostFetch } from '../lib/hostAuth';
import { askConfirm, askText } from '../lib/dialogs';
import { THEME_OPTIONS, useRoomTheme } from '../hooks/useRoomTheme';
import { useAdminThemeId } from '../hooks/useAdminTheme';
import TeamAvatar from '../components/shared/TeamAvatar';
import AdminShell from '../components/admin/AdminShell';
import type { ThemeId } from '@shared/types';
import {
  Eye,
  Hash,
  KeyRound,
  Layers,
  LayoutGrid,
  Lock,
  LockOpen,
  Play,
  Radio,
  Settings,
  SkipBack,
  SkipForward,
  Square,
  Timer,
  Trophy,
  Tv,
  Users,
} from 'lucide-react';

export default function Host() {
  const { quizId, roomCode: roomParam } = useParams();
  const { gameState, hostSecrets, connected } = useGameStore();
  const [error, setError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const roomCode = gameState?.roomCode ?? roomParam?.toUpperCase();
  const { info: netInfo, joinUrl } = useJoinNetwork(roomCode);
  const adminTheme = useAdminThemeId();
  useRoomTheme(gameState?.themeId ?? adminTheme);

  useEffect(() => {
    function onErr(payload: { message: string }) {
      setError(payload.message);
      setTimeout(() => setError(null), 4000);
    }
    socket.on(SOCKET_EVENTS.ERROR, onErr);
    socket.on('error', onErr);

    if (roomParam) {
      socket.emit(SOCKET_EVENTS.HOST_JOIN, { roomCode: roomParam.toUpperCase() });
    } else if (quizId) {
      socket.emit(SOCKET_EVENTS.HOST_CREATE, { quizId });
    }

    return () => {
      socket.off(SOCKET_EVENTS.ERROR, onErr);
      socket.off('error', onErr);
    };
  }, [quizId, roomParam]);

  const emit = (event: string, payload: Record<string, unknown> = {}) => {
    if (!roomCode) return;
    socket.emit(event, { roomCode, ...payload });
  };

  const tvUrl = roomCode ? `/tv/${roomCode}` : '#';

  async function requestAiSuggest(teamId: string, questionIndex: number, given: string) {
    if (!gameState) return;
    setAiNote('Asking Mistral…');
    const res = await hostFetch('/api/grade/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quizId: gameState.quizId,
        roundIndex: gameState.roundIndex,
        questionIndex,
        given,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429 || data.code === 'rate_limited') {
      setAiNote(data.error || 'Mistral rate limited — wait a bit, then try once (no auto-retry).');
      return;
    }
    if (!res.ok) {
      setAiNote(data.error || 'AI suggest failed (check key in Settings)');
      return;
    }
    if (!data.suggestion) {
      setAiNote(`No AI suggest — deterministic: ${data.deterministic?.verdict}`);
      return;
    }
    const s = data.suggestion;
    setAiNote(`AI suggests ${s.verdict} (${Math.round(s.confidence * 100)}%): ${s.reason} — confirm below`);
    if (await askConfirm(`Apply AI suggestion “${s.verdict}” for this answer?\n\n${s.reason}`)) {
      emit(SOCKET_EVENTS.HOST_SET_GRADE, { teamId, questionIndex, verdict: s.verdict });
    }
  }

  if (!gameState || !roomCode) {
    return (
      <AdminShell stage showTabs={false} brandSlot={
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--gold)] font-bold">Live host desk</p>
          <p className="text-sm text-[var(--muted)] mt-1">{connected ? 'Creating room…' : 'Connecting…'}</p>
        </div>
      }>
        <p className="text-[var(--muted)] text-center py-20">
          {connected ? 'Creating room…' : 'Connecting…'}
        </p>
      </AdminShell>
    );
  }

  const phase = gameState.phase;
  const submitted = gameState.teams.filter((t) => t.submitted).length;

  return (
    <AdminShell
      stage
      showTabs={false}
      maxWidthClass="max-w-none"
      contentClassName="space-y-4"
      brandSlot={
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--gold)] font-bold"><Radio size={12} /> Live host desk</p>
            <h1 className="text-2xl font-semibold mt-1">{gameState.quizName}</h1>
            <p className="text-sm text-[var(--muted)] mt-1">
              <span className="font-mono text-[var(--gold)]">{roomCode}</span>
              {' · '}{phase.replace('_', ' ')}
              {' · '}{gameState.teams.length} team{gameState.teams.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="btn btn-ghost text-sm" to="/"><LayoutGrid size={16} /> Quizzes</Link>
            <a className="btn btn-ghost text-sm" href={tvUrl} target="_blank" rel="noreferrer"><Tv size={16} /> Open TV</a>
          </div>
        </div>
      }
    >
    <div className="grid lg:grid-cols-[240px_1fr_300px] gap-4">
      {/* Left rail */}
      <aside className="panel p-4 space-y-5 h-fit lg:sticky lg:top-3">
        <div>
          <h1 className="font-semibold text-lg leading-tight">{gameState.quizName}</h1>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[var(--muted)]"><Hash size={14} /> Room</span>
            <span className="font-mono text-lg text-[var(--gold)] tracking-wider">{roomCode}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[var(--muted)]"><KeyRound size={14} /> PIN</span>
            <span className="font-mono text-lg text-[var(--gold)] tracking-wider">{gameState.pin}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-[var(--muted)]">
            <span className="inline-flex items-center gap-1"><Layers size={14} /> Round</span>
            <span>{gameState.roundIndex + 1}/{gameState.totalRounds}</span>
          </div>
          <div className="pt-1">
            <span className="phase-chip">{phase.replace('_', ' ')}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <a className="btn btn-ghost text-sm" href={tvUrl} target="_blank" rel="noreferrer"><Tv size={16} /> Open TV</a>
          <Link className="btn btn-ghost text-sm" to="/"><LayoutGrid size={16} /> Quizzes</Link>
          <Link className="btn btn-ghost text-sm" to="/settings"><Settings size={16} /> Settings</Link>
        </div>
        <div className="text-xs break-all text-[var(--muted)]">
          Team link: <a className="text-[var(--accent-2)]" href={joinUrl || '#'}>{joinUrl || 'detecting LAN…'}</a>
        </div>
        {netInfo?.qrEnabled && joinUrl && (
          <JoinQr url={joinUrl} size={140} label="Scan to join (PIN still required)" />
        )}
      </aside>

      {/* Main */}
      <main className="space-y-3">
        {error && <div className="panel p-3 text-[var(--danger)]">{error}</div>}

        <section className="panel p-4 md:p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)] mb-3">Phase controls</p>
          <div className="host-phase-bar">
            {phase === 'lobby' && (
              <button className="btn btn-lg" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_START)}><Play size={18} /> Start game</button>
            )}
            {(phase === 'round_intro' || phase === 'lobby') && phase !== 'lobby' && (
              <button className="btn btn-lg" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_SHOW_QUESTION, { questionIndex: 0 })}>
                Show Q1
              </button>
            )}
            {phase === 'round_intro' && (
              <button className="btn btn-lg" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_SHOW_QUESTION, { questionIndex: 0 })}>
                Begin questions
              </button>
            )}
            {phase === 'questioning' && (
              <>
                <button className="btn btn-ghost" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_PREV_QUESTION)}><SkipBack size={16} /> Prev</button>
                <button className="btn btn-lg" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_NEXT_QUESTION)}><SkipForward size={16} /> Next question</button>
                <button className="btn btn-warn" type="button" onClick={async () => {
                  if (await askConfirm('Lock all team answer sheets for this round?')) emit(SOCKET_EVENTS.HOST_LOCK);
                }}><Lock size={16} /> Lock round</button>
              </>
            )}
            {phase === 'locked' && (
              <>
                <button className="btn btn-lg" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_BEGIN_REVEAL)}><Eye size={16} /> Begin reveal</button>
                <button className="btn btn-ghost" type="button" onClick={async () => {
                  if (await askConfirm('Unlock and let teams edit again?')) emit(SOCKET_EVENTS.HOST_UNLOCK);
                }}><LockOpen size={16} /> Unlock</button>
              </>
            )}
            {phase === 'reveal' && (
              <button className="btn btn-lg" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_REVEAL_NEXT)}>
                <Eye size={16} />{' '}
                Reveal next ({gameState.revealIndex + 1}/{gameState.questionsInRound})
              </button>
            )}
            {(phase === 'scoring' || phase === 'reveal') && (
              <button className="btn btn-success btn-lg" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_OPEN_SCORING)}><Trophy size={16} /> Scoring desk</button>
            )}
            {(phase === 'scoring' || phase === 'leaderboard') && (
              <button className="btn" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_SHOW_LEADERBOARD)}><Trophy size={16} /> Show leaderboard</button>
            )}
            {phase === 'leaderboard' && (
              <button className="btn btn-lg" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_NEXT_ROUND)}>
                {gameState.roundIndex >= gameState.totalRounds - 1 ? 'Final results' : 'Next round'}
              </button>
            )}
            {phase !== 'finished' && phase !== 'lobby' && (
              <button className="btn btn-danger" type="button" onClick={async () => {
                if (await askConfirm('End the game and show the final podium?')) emit(SOCKET_EVENTS.HOST_END_GAME);
              }}><Square size={16} /> End game</button>
            )}
          </div>

          <div className="mt-5">
            <h2 className="display text-4xl md:text-5xl">{gameState.roundTitle}</h2>
            {gameState.currentQuestion && (
              <div className="mt-3 panel p-4 bg-[var(--bg-elevated)]">
                <p className="text-xs uppercase text-[var(--muted)]">
                  Q{gameState.currentQuestion.index + 1} · {gameState.currentQuestion.type} · {gameState.currentQuestion.points} pt
                </p>
                <p className="mt-2 text-xl">{gameState.currentQuestion.prompt}</p>
                {gameState.currentQuestion.type === 'multiple_choice' && gameState.currentQuestion.choices && (
                  <div className="mt-3">
                    <ChoiceList choices={gameState.currentQuestion.choices} />
                  </div>
                )}
                {gameState.currentQuestion.type === 'numeric' && (
                  <p className="mt-2 text-sm text-[var(--muted)]">Numeric — teams enter a number</p>
                )}
                <QuestionMedia
                  className="mt-4"
                  media={gameState.currentQuestion.media}
                  revealMeta={!!gameState.currentQuestion.revealedAnswer}
                  logoPanel={gameState.currentQuestion.type === 'brand_logo'}
                />
                {(phase === 'questioning' || phase === 'reveal')
                  && gameState.currentQuestion.type === 'music'
                  && hostSecrets?.questions[gameState.currentQuestion.index] && (
                  <HostMusicReplace
                    roomCode={roomCode}
                    questionIndex={gameState.currentQuestion.index}
                    prompt={gameState.currentQuestion.prompt}
                    acceptedAnswers={hostSecrets.questions[gameState.currentQuestion.index]!.acceptedAnswers}
                    currentMedia={hostSecrets.questions[gameState.currentQuestion.index]!.media}
                  />
                )}
                {gameState.currentQuestion.revealedAnswer && (
                  <p className="mt-3 text-[var(--success)]">Answer: {gameState.currentQuestion.revealedAnswer}</p>
                )}
                {phase === 'reveal' && (gameState.revealTeamResults?.length ?? 0) > 0 && (
                  <ul className="mt-4 space-y-2 text-sm">
                    {gameState.revealTeamResults.map((r) => (
                      <li
                        key={r.teamId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2"
                        style={{ borderLeft: `3px solid ${r.color}` }}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <TeamAvatar name={r.name} color={r.color} avatarUrl={r.avatarUrl} size={28} />
                          <span className="font-medium truncate">{r.name}</span>
                        </span>
                        <span className="text-[var(--muted)] truncate max-w-[40%]">{r.answer || '—'}</span>
                        <span className="tabular-nums">
                          <span className={r.pointsAwarded > 0 ? 'text-[var(--success)]' : 'text-[var(--muted)]'}>
                            +{r.pointsAwarded}
                          </span>
                          <span className="text-[var(--muted)]"> / r{r.roundPointsSoFar}</span>
                          <span className="ml-2 font-semibold">{r.score}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 inline-flex items-center gap-2 text-[var(--accent-2)]">
                  <Timer size={22} />
                  <Countdown
                    endsAt={gameState.timerEndsAt}
                    className="text-left display text-3xl"
                  />
                </div>
              </div>
            )}
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-[var(--muted)]">
              <Users size={14} /> Submissions: {submitted}/{gameState.teams.length}
            </p>
            {aiNote && <p className="mt-2 text-xs text-[var(--accent-2)]">{aiNote}</p>}
          </div>
        </section>

        {phase === 'finished' && (
          <section className="panel p-6 anim-rise">
            <h2 className="display text-5xl text-[var(--gold)]">Final podium</h2>
            {gameState.leaderboard[0] && (
              <p className="mt-3 text-xl">
                Winner — <span style={{ color: gameState.leaderboard[0].color }}>{gameState.leaderboard[0].name}</span>
                {' '}({gameState.leaderboard[0].score} pts)
              </p>
            )}
            <ol className="mt-6 space-y-2">
              {gameState.leaderboard.map((e) => (
                <li key={e.teamId} className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3">
                  <span className="display text-2xl text-[var(--gold)] w-10">#{e.rank}</span>
                  <TeamAvatar name={e.name} color={e.color} avatarUrl={e.avatarUrl} size={36} />
                  <span className="flex-1 font-semibold" style={{ color: e.color }}>{e.name}</span>
                  <span className="tabular-nums text-xl">{e.score}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {phase === 'locked' && hostSecrets?.questions[gameState.questionIndex]?.type === 'music' && (
          <section className="panel p-4">
            <p className="text-xs uppercase text-[var(--muted)]">Q{gameState.questionIndex + 1} · music</p>
            <p className="mt-1 text-lg">{hostSecrets.questions[gameState.questionIndex]!.prompt}</p>
            <HostMusicReplace
              roomCode={roomCode}
              questionIndex={gameState.questionIndex}
              prompt={hostSecrets.questions[gameState.questionIndex]!.prompt || ''}
              acceptedAnswers={hostSecrets.questions[gameState.questionIndex]!.acceptedAnswers}
              currentMedia={hostSecrets.questions[gameState.questionIndex]!.media}
            />
          </section>
        )}

        {/* Scoring / review */}
        {hostSecrets && (phase === 'locked' || phase === 'reveal' || phase === 'scoring' || phase === 'leaderboard') && (
          <section className="panel p-4 overflow-x-auto">
            <h3 className="font-semibold mb-3">Answer review</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted)]">
                  <th className="p-2">Team</th>
                  {hostSecrets.questions.map((q, i) => (
                    <th key={q.id} className="p-2 whitespace-nowrap">Q{i + 1}</th>
                  ))}
                  <th className="p-2">Round</th>
                </tr>
              </thead>
              <tbody>
                {hostSecrets.teams.map((t) => (
                  <tr key={t.teamId} className="border-t border-white/5 align-top">
                    <td className="p-2 font-medium" style={{ color: t.color }}>{t.name}</td>
                    {hostSecrets.questions.map((q, i) => {
                      const g = t.grades[i];
                      const verdict = g?.verdict ?? 'incorrect';
                      const label = (v: GradeVerdict) =>
                        v === 'correct' ? 'Correct' : v === 'review' ? 'Review' : 'Wrong';
                      const activeClass = (v: GradeVerdict) => {
                        if (verdict !== v) return '';
                        if (v === 'correct') return 'grade-btn--active-correct';
                        if (v === 'incorrect') return 'grade-btn--active-wrong';
                        return 'grade-btn--active-review';
                      };
                      return (
                        <td key={q.id} className="p-2 min-w-[168px]">
                          <div className="text-xs mb-2 break-words">{t.answers[i] || '—'}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {(['correct', 'incorrect', 'review'] as GradeVerdict[]).map((v) => (
                              <button
                                key={v}
                                type="button"
                                className={`grade-btn ${activeClass(v)}`}
                                onClick={() => emit(SOCKET_EVENTS.HOST_SET_GRADE, {
                                  teamId: t.teamId,
                                  questionIndex: i,
                                  verdict: v,
                                  pointsAwarded: v === 'correct' ? (q.points ?? 1) : 0,
                                })}
                              >
                                {label(v)}
                              </button>
                            ))}
                          </div>
                          <div className={`text-[10px] mt-1 ${g?.pointsAwarded ? 'text-[var(--success)]' : 'text-[var(--muted)]'}`}>
                            +{g?.pointsAwarded ?? 0} pt
                          </div>
                          <div className="text-[10px] text-[var(--muted)] mt-0.5">
                            key: {q.acceptedAnswers[0]}
                          </div>
                          {(verdict === 'review' || (g?.confidence != null && g.confidence < 0.9)) && t.answers[i] && (
                            <button
                              type="button"
                              className="mt-1 text-[10px] text-[var(--accent-2)] underline"
                              onClick={() => requestAiSuggest(t.teamId, i, t.answers[i])}
                            >
                              Ask Mistral
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-2 font-semibold">{t.roundPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>

      {/* Right rail */}
      <aside className="panel p-4 space-y-4 h-fit lg:sticky lg:top-3">
        <div>
          <h3 className="font-semibold">Teams</h3>
          <ul className="mt-2 space-y-2">
            {gameState.teams.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <TeamAvatar name={t.name} color={t.color} avatarUrl={t.avatarUrl} size={28} />
                <span className="flex-1 truncate font-medium" style={{ color: t.color }}>{t.name}</span>
                <span className="tabular-nums">{t.score}</span>
                <span className="text-[10px] text-[var(--muted)]">
                  {t.submitted ? 'in' : '…'}{t.connected ? '' : ' · offline'}
                </span>
                <button
                  type="button"
                  className="text-[10px] text-[var(--danger)]"
                  onClick={async () => {
                    if (await askConfirm(`Remove ${t.name}?`)) emit(SOCKET_EVENTS.HOST_REMOVE_TEAM, { teamId: t.id });
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            className="btn btn-ghost text-sm mt-3 w-full"
            type="button"
            onClick={async () => {
              const name = await askText('Team name (paper entry)');
              if (name) emit(SOCKET_EVENTS.HOST_ADD_TEAM, { name });
            }}
          >
            Add team
          </button>
        </div>

        <div>
          <h3 className="font-semibold">Manual score</h3>
          {gameState.teams.map((t) => (
            <div key={t.id} className="flex gap-1 mt-2">
              <button className="btn btn-ghost text-xs px-2" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_ADJUST_SCORE, { teamId: t.id, delta: -1 })}>-1</button>
              <span className="flex-1 text-sm truncate" style={{ color: t.color }}>{t.name}</span>
              <button className="btn btn-ghost text-xs px-2" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_ADJUST_SCORE, { teamId: t.id, delta: 1 })}>+1</button>
            </div>
          ))}
        </div>

        <div>
          <h3 className="font-semibold">Timer</h3>
          <p className="text-xs text-[var(--muted)] mt-1">
            {gameState.timerDurationSec
              ? `${gameState.timerDurationSec}s per question (resets each Q)`
              : 'Arm a length — countdown resets on each question'}
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {[30, 60, 90].map((s) => (
              <button
                key={s}
                className={`btn btn-ghost text-xs ${gameState.timerDurationSec === s ? 'ring-1 ring-[var(--accent)]' : ''}`}
                type="button"
                onClick={() => emit(SOCKET_EVENTS.HOST_SET_TIMER, { seconds: s })}
              >
                {s}s
              </button>
            ))}
            <button className="btn btn-ghost text-xs" type="button" onClick={() => emit(SOCKET_EVENTS.HOST_SET_TIMER, { seconds: null })}>Clear</button>
          </div>
        </div>

        <div>
          <h3 className="font-semibold">Skin</h3>
          <select
            className="input mt-2 text-sm"
            value={gameState.themeId}
            onChange={(e) => emit(SOCKET_EVENTS.HOST_SET_THEME, { themeId: e.target.value as ThemeId })}
          >
            {THEME_OPTIONS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <p className="text-xs text-[var(--muted)] mt-1">Live for Host, phones, and TV</p>
        </div>

        <button
          className="btn btn-danger w-full text-sm"
          type="button"
          onClick={async () => {
            if (await askConfirm('Close room for everyone?')) emit(SOCKET_EVENTS.HOST_CLOSE_ROOM);
          }}
        >
          Close room
        </button>
      </aside>
    </div>
    </AdminShell>
  );
}
