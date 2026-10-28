import { useEffect, useState } from 'react';
import { Music, Search, Wand2 } from 'lucide-react';
import { hostFetch } from '../../lib/hostAuth';
import { socket } from '../../socket';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import type { MediaRef } from '@shared/types';

interface DeezerHit {
  id: string;
  name: string;
  artists: string;
  album?: string;
  artworkUrl?: string;
  hasPreview: boolean;
}

export default function HostMusicReplace({
  roomCode,
  questionIndex,
  prompt,
  acceptedAnswers,
  currentMedia,
}: {
  roomCode: string;
  questionIndex: number;
  prompt: string;
  acceptedAnswers: string[];
  currentMedia?: MediaRef;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DeezerHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const prefill = [
      acceptedAnswers[0],
      prompt.slice(0, 60),
    ].filter(Boolean).join(' — ');
    setQ((prev) => prev || prefill);
  }, [open, prompt, acceptedAnswers]);

  function emitMedia(media: MediaRef) {
    socket.emit(SOCKET_EVENTS.HOST_UPDATE_QUESTION_MEDIA, {
      roomCode,
      questionIndex,
      media,
      persist: true,
    });
  }

  async function autoMatch() {
    setBusy(true);
    setError(null);
    setStatus('Matching from prompt + answer…');
    try {
      const res = await hostFetch('/api/deezer/match-attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          answers: acceptedAnswers,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.matched || !data.media) {
        setError(data.error || 'No strong match');
        setStatus(null);
        return;
      }
      emitMedia(data.media);
      setStatus(`Attached: ${data.track?.label || data.media.title}`);
      setHits([]);
    } catch {
      setError('Auto-match failed');
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const res = await hostFetch(`/api/deezer/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Search failed');
        setHits([]);
        return;
      }
      setHits(data.tracks ?? []);
      if (!(data.tracks ?? []).length) setError('No tracks found');
    } catch {
      setError('Search failed');
    } finally {
      setBusy(false);
    }
  }

  async function attach(trackId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await hostFetch('/api/deezer/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId }),
      });
      const data = await res.json();
      if (!res.ok || !data.media) {
        setError(data.error || 'Attach failed');
        return;
      }
      emitMedia(data.media);
      const label = `${data.media.title || '?'} — ${data.media.artist || '?'}`
        + (data.media.album ? ` (${data.media.album})` : '');
      setStatus(`Attached: ${label}`);
      setHits([]);
    } catch {
      setError('Attach failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.14em] text-[var(--accent-2)]"><Music size={14} /> Music</p>
          <button
            type="button"
            className="btn btn-ghost text-sm mt-1"
            onClick={() => setOpen((o) => !o)}
          >
            <Music size={14} /> {open ? 'Hide replace' : 'Replace track'}
          </button>
        </div>
        {currentMedia?.title && (
          <span className="text-xs text-[var(--muted)] truncate max-w-[60%]">
            Now: {currentMedia.title}
            {currentMedia.artist ? ` — ${currentMedia.artist}` : ''}
            {currentMedia.album ? ` (${currentMedia.album})` : ''}
          </span>
        )}
      </div>

      {open && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--muted)]">
            Updates the live preview for TV/teams without spoiling title/artist until reveal. Persists to the quiz file.
          </p>
          <button
            type="button"
            className="btn text-sm"
            disabled={busy}
            onClick={() => void autoMatch()}
          >
            <Wand2 size={14} /> Auto-match from prompt + answer
          </button>
          <div className="flex gap-2">
            <input
              className="input flex-1 text-sm"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search Deezer…"
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void search())}
            />
            <button className="btn btn-ghost text-sm" type="button" disabled={busy || !q.trim()} onClick={() => void search()}>
              <Search size={14} /> Search
            </button>
          </div>
          <div className="grid gap-1 max-h-40 overflow-y-auto">
            {hits.map((h) => (
              <button
                key={h.id}
                type="button"
                disabled={!h.hasPreview || busy}
                className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-left text-sm hover:bg-white/10 disabled:opacity-40"
                onClick={() => void attach(h.id)}
              >
                {h.artworkUrl && <img src={h.artworkUrl} alt="" className="h-8 w-8 rounded object-cover" />}
                <span>
                  {h.name} — {h.artists}
                  {h.album ? ` (${h.album})` : ''}
                </span>
              </button>
            ))}
          </div>
          {status && <p className="text-xs text-[var(--success)]">{status}</p>}
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        </div>
      )}
    </div>
  );
}
