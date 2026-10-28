import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Eye, Hash, KeyRound, Layers, Lock, Smartphone, Timer, Trophy, Tv, Users } from 'lucide-react';
import { socket } from '../socket';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { useGameStore } from '../store/gameStore';
import JoinQr from '../components/shared/JoinQr';
import Countdown from '../components/shared/Countdown';
import QuestionMedia from '../components/shared/QuestionMedia';
import ChoiceList from '../components/shared/ChoiceList';
import { useJoinNetwork } from '../hooks/useJoinNetwork';
import { useRoomTheme } from '../hooks/useRoomTheme';
import { useAdminThemeId } from '../hooks/useAdminTheme';
import TeamAvatar from '../components/shared/TeamAvatar';

export default function TvView() {
  const { roomCode = '' } = useParams();
  const code = roomCode.toUpperCase();
  const gameState = useGameStore((s) => s.gameState);
  const { info: netInfo, joinUrl } = useJoinNetwork(code);
  const adminTheme = useAdminThemeId();
  useRoomTheme(gameState?.themeId ?? adminTheme);

  useEffect(() => {
    socket.emit(SOCKET_EVENTS.GET_STATE, { roomCode: code });
    const id = setInterval(() => socket.emit(SOCKET_EVENTS.GET_STATE, { roomCode: code }), 5000);
    return () => clearInterval(id);
  }, [code]);

  if (!gameState) {
    return (
      <div className="stage min-h-screen tv-safe flex items-center justify-center">
        <p className="display text-6xl text-[var(--muted)]">Connecting to {code}…</p>
      </div>
    );
  }

  const phase = gameState.phase;
  const q = gameState.currentQuestion;

  return (
    <div className="stage min-h-screen tv-safe overflow-hidden relative">
      <div className="stage-glow absolute inset-0 pointer-events-none" />

      <header className="relative z-10 flex justify-between items-start">
        <div>
          <p className="inline-flex items-center gap-2 text-sm uppercase tracking-[0.35em] text-[var(--muted)]"><Tv size={16} /> Trivia Night</p>
          <p className="text-[var(--muted)]">{gameState.quizName}</p>
        </div>
        <div className="text-right">
          <p className="inline-flex items-center justify-end gap-2 font-mono text-2xl text-[var(--gold)]"><Hash size={18} /> {gameState.roomCode}</p>
          {phase === 'lobby' && <p className="inline-flex items-center justify-end gap-2 text-sm text-[var(--muted)]"><KeyRound size={14} /> PIN {gameState.pin}</p>}
        </div>
      </header>

      <div className="relative z-10 flex min-h-[75vh] items-center justify-center">
        {phase === 'lobby' && (
          <div className="text-center anim-rise w-full">
            <h1 className="display text-[clamp(4rem,12vw,9rem)] leading-none">Trivia Night</h1>
            <p className="mt-4 inline-flex items-center gap-2 text-2xl text-[var(--muted)]"><Smartphone size={22} /> Join on your phone</p>
            <p className="mt-2 font-mono text-4xl text-[var(--gold)]">{gameState.roomCode} · PIN {gameState.pin}</p>
            {netInfo?.qrEnabled && netInfo.showQrOnTv && joinUrl && (
              <div className="mt-8 flex justify-center">
                <JoinQr url={joinUrl} size={200} label={joinUrl} />
              </div>
            )}
            <ul className="mt-10 flex flex-wrap justify-center gap-5">
              {gameState.teams.map((t) => (
                <li
                  key={t.id}
                  className="panel px-6 py-5 text-2xl anim-pop flex flex-col items-center gap-3 min-w-[8rem]"
                  style={{ borderColor: t.color, borderWidth: 2 }}
                >
                  <TeamAvatar name={t.name} color={t.color} avatarUrl={t.avatarUrl} size={88} />
                  <span className="font-semibold text-center" style={{ color: t.color }}>{t.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {phase === 'round_intro' && (
          <div className="text-center anim-rise w-full">
            <p className="uppercase tracking-[0.4em] text-[var(--muted)]">Round {gameState.roundIndex + 1}</p>
            <h1 className="display mt-4 text-[clamp(3rem,10vw,8rem)] leading-none">{gameState.roundTitle}</h1>
            <p className="mt-6 text-2xl text-[var(--muted)]">{gameState.questionsInRound} questions</p>
            {gameState.teams.length > 0 && (
              <ul className="mt-10 flex flex-wrap justify-center gap-4">
                {gameState.teams.map((t) => (
                  <li key={t.id} className="flex flex-col items-center gap-2 anim-pop">
                    <TeamAvatar name={t.name} color={t.color} avatarUrl={t.avatarUrl} size={64} />
                    <span className="text-sm font-semibold" style={{ color: t.color }}>{t.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {phase === 'questioning' && q && (
          <div className="w-full max-w-6xl anim-rise">
            <div className="flex justify-between text-[var(--muted)] mb-4 text-xl">
              <span>Q{q.index + 1} / {gameState.questionsInRound}</span>
              <span className="capitalize">{q.type.replace('_', ' ')}</span>
              <span>{q.points} pt</span>
            </div>
            <div className="panel p-10 md:p-14 anim-glow">
              <h2 className="display text-[clamp(2.5rem,6vw,5.5rem)] leading-[1.05]">{q.prompt}</h2>
              {q.type === 'multiple_choice' && q.choices && (
                <div className="mt-8 max-w-3xl mx-auto">
                  <ChoiceList choices={q.choices} size="lg" />
                </div>
              )}
              {q.type === 'numeric' && (
                <p className="mt-8 text-2xl text-[var(--muted)]">Enter a number on your team sheet</p>
              )}
              <QuestionMedia
                className="mt-8"
                media={q.media}
                revealMeta={false}
                logoPanel={q.type === 'brand_logo'}
              />
              {!q.media?.previewUrl && !q.media?.deezerTrackId && !q.media?.spotifyTrackId && !q.media?.url && !q.media?.youtubeId && (q.type === 'music' || q.type === 'image' || q.type === 'brand_logo') && (
                <p className="mt-8 text-xl text-[var(--muted)]">Media cue — host playback</p>
              )}
            </div>
            <div className="mt-6 inline-flex items-center gap-3">
              <Timer size={28} />
              <Countdown endsAt={gameState.timerEndsAt} />
            </div>
          </div>
        )}

        {phase === 'locked' && (
          <div className="text-center anim-rise">
            <h1 className="display inline-flex items-center gap-4 text-[clamp(3rem,9vw,7rem)]"><Lock size={64} /> Pencils down</h1>
            <p className="mt-4 text-2xl text-[var(--muted)]">Answer sheets locked — reveal coming up</p>
          </div>
        )}

        {phase === 'reveal' && q && (
          <div className="w-full max-w-5xl text-center anim-pop">
            <p className="inline-flex items-center gap-2 uppercase tracking-[0.3em] text-[var(--muted)]"><Eye size={16} /> Answer {q.index + 1}</p>
            <h2 className="display mt-4 text-[clamp(2rem,5vw,4rem)] text-[var(--muted)]">{q.prompt}</h2>
            <p className="display mt-8 text-[clamp(3rem,8vw,6.5rem)] text-[var(--gold)]">{q.revealedAnswer}</p>
            <QuestionMedia className="mt-8" media={q.media} revealMeta logoPanel={q.type === 'brand_logo'} />
            {(gameState.revealTeamResults?.length ?? 0) > 0 && (
              <ul className="mt-10 mx-auto max-w-3xl space-y-3 text-left">
                {gameState.revealTeamResults.map((r) => (
                  <li
                    key={r.teamId}
                    className="flex items-center gap-4 rounded-2xl bg-white/5 px-5 py-3 text-xl"
                    style={{ borderLeft: `4px solid ${r.color}` }}
                  >
                    <TeamAvatar name={r.name} color={r.color} avatarUrl={r.avatarUrl} size={48} />
                    <span className="flex-1 font-semibold truncate" style={{ color: r.color }}>{r.name}</span>
                    <span className="text-[var(--muted)] truncate max-w-[30%]">{r.answer || '—'}</span>
                    <span className="tabular-nums whitespace-nowrap">
                      <span className={r.pointsAwarded > 0 ? 'text-[var(--gold)]' : 'text-[var(--muted)]'}>
                        +{r.pointsAwarded}
                      </span>
                      <span className="text-[var(--muted)] text-base"> · r{r.roundPointsSoFar}</span>
                      <span className="ml-3 font-semibold">{r.score}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(phase === 'scoring') && (
          <div className="text-center anim-rise">
            <h1 className="display text-7xl">Scoring</h1>
            <p className="mt-4 text-2xl text-[var(--muted)]">Host is validating answers</p>
          </div>
        )}

        {(phase === 'leaderboard' || phase === 'finished') && gameState.showLeaderboard && (
          <div className="w-full max-w-4xl anim-rise">
            <h1 className="display text-center text-6xl mb-8">
              {phase === 'finished' ? 'Final podium' : 'Leaderboard'}
            </h1>
            {phase === 'finished' && gameState.leaderboard[0] && (
              <p className="display text-center mb-8 text-5xl text-[var(--gold)]">
                <Trophy className="inline mr-3" size={42} /> Winner — {gameState.leaderboard[0].name}!
              </p>
            )}
            <ol className="space-y-3">
              {gameState.leaderboard.map((e, i) => (
                <li
                  key={e.teamId}
                  className={`panel flex items-center gap-4 px-6 py-4 ${i === 0 ? 'anim-glow' : 'anim-pop'}`}
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <span className="display text-4xl w-14 text-[var(--gold)]">#{e.rank}</span>
                  <TeamAvatar name={e.name} color={e.color} avatarUrl={e.avatarUrl} size={56} />
                  <span className="flex-1 text-3xl font-semibold" style={{ color: e.color }}>{e.name}</span>
                  {phase !== 'finished' && <span className="text-[var(--muted)]">+{e.roundPoints}</span>}
                  <span className="display text-4xl tabular-nums">{e.score}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <footer className="relative z-10 flex justify-between text-sm text-[var(--muted)]">
        <span className="inline-flex items-center gap-1.5"><Layers size={14} /> Round {gameState.roundIndex + 1}/{gameState.totalRounds}</span>
        <span className="inline-flex items-center gap-1.5"><Users size={14} /> {gameState.teams.length} teams</span>
      </footer>
    </div>
  );
}
