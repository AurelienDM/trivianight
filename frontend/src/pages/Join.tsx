import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Camera, Hash, KeyRound, LogIn, Palette, Users } from 'lucide-react';
import { socket } from '../socket';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { TEAM_COLORS } from '@shared/limits';
import { useGameStore } from '../store/gameStore';
import { useRoomTheme } from '../hooks/useRoomTheme';
import { useAdminThemeId } from '../hooks/useAdminTheme';
import {
  canUseLiveCamera,
  compressImageFile,
  openSelfieStream,
  stopStream,
  videoToAvatarDataUrl,
} from '../lib/selfie';

type Mode = 'join' | 'rejoin';
/** idle → live preview (secure only) → captured still */
type SelfiePhase = 'idle' | 'camera' | 'captured';

function savedCreds(roomCode: string): { teamId: string; token: string } | null {
  try {
    const raw = localStorage.getItem(`trivia-night:team:${roomCode}`);
    if (!raw) return null;
    const { teamId, token } = JSON.parse(raw);
    if (teamId && token) return { teamId, token };
  } catch { /* ignore */ }
  return null;
}

export default function Join() {
  const { roomCode: paramCode } = useParams();
  const navigate = useNavigate();
  const setGameState = useGameStore((s) => s.setGameState);
  const [mode, setMode] = useState<Mode>('join');
  const [roomCode, setRoomCode] = useState(paramCode?.toUpperCase() ?? '');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(TEAM_COLORS[0]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [selfiePhase, setSelfiePhase] = useState<SelfiePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ teamId: string; token: string } | null>(null);
  const [liveAvailable] = useState(() => canUseLiveCamera());
  const gameState = useGameStore((s) => s.gameState);
  const adminTheme = useAdminThemeId();
  useRoomTheme(gameState?.themeId ?? adminTheme);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selfieBusy = useRef(false);

  useEffect(() => {
    const code = roomCode.trim().toUpperCase();
    setSaved(code ? savedCreds(code) : null);
  }, [roomCode]);

  useEffect(() => {
    const code = roomCode.trim().toUpperCase();
    if (!code || code.length < 4) return;
    socket.emit(SOCKET_EVENTS.GET_STATE, { roomCode: code });
  }, [roomCode]);

  useEffect(() => () => { stopStream(streamRef.current); streamRef.current = null; }, []);

  function goTeam(code: string) {
    navigate(`/team/${code}`);
  }

  function openNativePicker() {
    setError(null);
    // Reset so picking the same file again still fires change
    if (fileInputRef.current) fileInputRef.current.value = '';
    fileInputRef.current?.click();
  }

  async function onFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (selfieBusy.current) return;
    selfieBusy.current = true;
    setError(null);
    try {
      stopStream(streamRef.current);
      streamRef.current = null;
      const dataUrl = await compressImageFile(file);
      setAvatarUrl(dataUrl);
      setSelfiePhase('captured');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that photo');
    } finally {
      selfieBusy.current = false;
    }
  }

  async function openLiveCamera() {
    if (selfieBusy.current) return;
    if (!canUseLiveCamera()) {
      openNativePicker();
      return;
    }
    selfieBusy.current = true;
    setError(null);
    try {
      stopStream(streamRef.current);
      const stream = await openSelfieStream();
      streamRef.current = stream;
      setSelfiePhase('camera');
      setAvatarUrl(null);
      requestAnimationFrame(() => {
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          void v.play().catch(() => { /* ignore autoplay */ });
        }
      });
    } catch {
      // Live failed even on secure context → fall back to native picker
      setSelfiePhase('idle');
      openNativePicker();
    } finally {
      selfieBusy.current = false;
    }
  }

  function captureFrame() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      setError('Camera not ready — try again');
      return;
    }
    try {
      const dataUrl = videoToAvatarDataUrl(v);
      setAvatarUrl(dataUrl);
      stopStream(streamRef.current);
      streamRef.current = null;
      setSelfiePhase('captured');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Capture failed');
    }
  }

  /** Primary control: native file+capture on LAN HTTP; Capture while in live preview. */
  function onSelfiePrimary() {
    if (selfiePhase === 'camera') {
      captureFrame();
      return;
    }
    openNativePicker();
  }

  function clearSelfie() {
    stopStream(streamRef.current);
    streamRef.current = null;
    setAvatarUrl(null);
    setSelfiePhase('idle');
  }

  const selfiePrimaryLabel =
    selfiePhase === 'camera' ? 'Capture'
      : selfiePhase === 'captured' ? 'Retake'
        : 'Take a picture';

  function continueSaved() {
    const code = roomCode.trim().toUpperCase();
    const creds = saved || savedCreds(code);
    if (!code || !creds) {
      setError('No saved team session for this room');
      return;
    }
    setBusy(true);
    setError(null);
    socket.emit(
      SOCKET_EVENTS.TEAM_REJOIN,
      { roomCode: code, teamId: creds.teamId, token: creds.token },
      (res: { ok: boolean; error?: string }) => {
        setBusy(false);
        if (!res?.ok) {
          setError(res?.error ?? 'Rejoin failed — try room + PIN + team name');
          setMode('rejoin');
          return;
        }
        goTeam(code);
      },
    );
    socket.once(SOCKET_EVENTS.GAME_STATE, (state) => setGameState(state));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const code = roomCode.trim().toUpperCase();

    if (mode === 'rejoin') {
      socket.emit(
        SOCKET_EVENTS.TEAM_REJOIN_BY_NAME,
        { roomCode: code, name, pin: pin || undefined },
        (res: { ok: boolean; error?: string }) => {
          setBusy(false);
          if (!res?.ok) {
            setError(res?.error ?? 'Rejoin failed');
            return;
          }
          goTeam(code);
        },
      );
      socket.once(SOCKET_EVENTS.GAME_STATE, (state) => setGameState(state));
      return;
    }

    socket.emit(
      SOCKET_EVENTS.TEAM_JOIN,
      {
        roomCode: code,
        name,
        color,
        pin: pin || undefined,
        avatarUrl: avatarUrl || undefined,
      },
      (res: { ok: boolean; error?: string }) => {
        setBusy(false);
        if (!res?.ok) {
          const err = res?.error ?? 'Join failed';
          setError(err);
          if (/already taken/i.test(err)) {
            setMode('rejoin');
            setError(`${err}. Switch to Rejoin and use the same team name + PIN.`);
          }
          return;
        }
        goTeam(code);
      },
    );
    socket.once(SOCKET_EVENTS.GAME_STATE, (state) => setGameState(state));
  }

  return (
    <div className="stage min-h-screen flex items-center justify-center px-4 py-12">
      <form onSubmit={onSubmit} className="panel w-full max-w-md p-7 md:p-8 anim-rise space-y-1">
        <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[var(--muted)]"><Users size={14} /> Team check-in</p>
        <h1 className="display mt-2 text-5xl">Join the quiz</h1>
        <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed">
          One phone per team. Enter the room code and PIN from the host or TV.
        </p>

        <div className="mode-toggle mt-6">
          <button
            type="button"
            className={`mode-toggle__btn ${mode === 'join' ? 'mode-toggle__btn--active' : ''}`}
            onClick={() => { setMode('join'); setError(null); }}
          >
            New team
          </button>
          <button
            type="button"
            className={`mode-toggle__btn ${mode === 'rejoin' ? 'mode-toggle__btn--active' : ''}`}
            onClick={() => { setMode('rejoin'); setError(null); }}
          >
            Rejoin
          </button>
        </div>

        <label className="mt-7 flex items-center gap-1.5 text-sm text-[var(--muted)]"><Hash size={14} /> Room code</label>
        <input
          className="input input-lg mt-2 uppercase tracking-widest"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          required
          maxLength={8}
        />

        <label className="mt-5 flex items-center gap-1.5 text-sm text-[var(--muted)]"><KeyRound size={14} /> PIN</label>
        <input
          className="input input-lg mt-2 tracking-widest"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          inputMode="numeric"
          maxLength={4}
          placeholder="····"
        />

        <label className="mt-5 flex items-center gap-1.5 text-sm text-[var(--muted)]"><Users size={14} /> Team name</label>
        <input
          className="input input-lg mt-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={32}
          placeholder={mode === 'rejoin' ? 'Exact team name' : 'The Know-It-Alls'}
        />

        {mode === 'join' && (
          <>
            <p className="mt-6 inline-flex items-center gap-1.5 text-sm text-[var(--muted)]"><Camera size={14} /> Team selfie (optional)</p>
            <div className="mt-2 space-y-3">
              {/* Native camera / photo picker — works on LAN HTTP (not a secure context). */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={(e) => void onFilePicked(e)}
              />
              <div
                className="relative w-full aspect-square max-h-56 rounded-2xl overflow-hidden border-2"
                style={{ borderColor: color, background: color }}
              >
                {selfiePhase === 'camera' ? (
                  <video
                    ref={videoRef}
                    className="absolute inset-0 h-full w-full object-cover scale-x-[-1]"
                    playsInline
                    muted
                    autoPlay
                  />
                ) : avatarUrl ? (
                  <img src={avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white/90">
                    No photo yet
                  </span>
                )}
              </div>
              <button className="btn w-full" type="button" onClick={onSelfiePrimary}>
                {selfiePrimaryLabel}
              </button>
              {liveAvailable && selfiePhase !== 'camera' && (
                <button
                  type="button"
                  className="block w-full text-center text-xs text-[var(--muted)] underline"
                  onClick={() => void openLiveCamera()}
                >
                  Use live camera instead
                </button>
              )}
              {(selfiePhase === 'camera' || selfiePhase === 'captured') && (
                <button
                  type="button"
                  className="block w-full text-center text-xs text-[var(--muted)] underline"
                  onClick={clearSelfie}
                >
                  {selfiePhase === 'camera' ? 'Cancel' : 'Remove'}
                </button>
              )}
            </div>

            <label className="mt-6 flex items-center gap-1.5 text-sm text-[var(--muted)]"><Palette size={14} /> Color</label>
            <div className="mt-3 flex flex-wrap gap-3">
              {TEAM_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch ${color === c ? 'color-swatch--active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Pick ${c}`}
                />
              ))}
            </div>
          </>
        )}

        {mode === 'rejoin' && (
          <p className="mt-4 text-xs text-[var(--muted)]">
            Rejoins your existing team — same name and PIN. Does not create a duplicate.
          </p>
        )}

        {error && <p className="mt-5 text-sm text-[var(--danger)]">{error}</p>}

        <button className="btn btn-lg mt-7 w-full" type="submit" disabled={busy}>
          <LogIn size={18} />
          {busy ? (mode === 'rejoin' ? 'Rejoining…' : 'Joining…') : mode === 'rejoin' ? 'Rejoin team' : 'Join room'}
        </button>

        {saved && (
          <button
            className="btn btn-ghost continue-saved mt-4 w-full"
            type="button"
            disabled={busy}
            onClick={() => continueSaved()}
          >
            Continue saved session
          </button>
        )}

        <Link to="/" className="mt-5 block text-center text-sm text-[var(--muted)]">Back to host dashboard</Link>
      </form>
    </div>
  );
}
