import { useEffect, useRef, useState } from 'react';
import { hostFetch } from '../../lib/hostAuth';
import type { MediaRef, QuestionType } from '@shared/types';

interface DeezerHit {
  id: string;
  name: string;
  artists: string;
  album?: string;
  artworkUrl?: string;
  hasPreview: boolean;
  previewUrl?: string | null;
}

function formatAttached(value: MediaRef): string {
  const base = `${value.title || 'Track'}${value.artist ? ` — ${value.artist}` : ''}`;
  return value.album ? `${base} (${value.album})` : base;
}

function ImageUrlPicker({
  value,
  onChange,
}: {
  value?: MediaRef;
  onChange: (media: MediaRef | undefined) => void;
}) {
  const [url, setUrl] = useState(value?.url || '');
  return (
    <div className="space-y-3 rounded-xl border border-white/10 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Image URL</p>
        {value && (
          <button type="button" className="text-xs text-[var(--danger)]" onClick={() => onChange(undefined)}>
            Clear
          </button>
        )}
      </div>
      {value?.url && (
        <img src={value.url} alt="" className="max-h-32 mx-auto object-contain rounded-lg bg-white/5 p-2" />
      )}
      <div className="flex gap-2">
        <input
          className="input flex-1 font-mono text-sm"
          placeholder="https://… image URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="btn btn-ghost text-sm"
          type="button"
          disabled={!url.trim()}
          onClick={() => onChange({ kind: 'image', url: url.trim(), title: value?.title })}
        >
          Attach
        </button>
      </div>
    </div>
  );
}

function BrandLogoPicker({
  value,
  onChange,
  brandHint,
}: {
  value?: MediaRef;
  onChange: (media: MediaRef | undefined) => void;
  brandHint?: string;
}) {
  const [brand, setBrand] = useState(brandHint?.trim() || value?.title || '');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const autoTried = useRef(false);

  useEffect(() => {
    if (brandHint?.trim() && !brand) setBrand(brandHint.trim());
  }, [brandHint]);

  useEffect(() => {
    if (autoTried.current) return;
    if (value?.url) return;
    const b = (brandHint || brand).trim();
    if (!b) return;
    autoTried.current = true;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const res = await hostFetch('/api/logos/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand: b }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.matched && data.media) {
          onChange(data.media);
          setNote(`Auto-fetched (${data.source || 'logo'}): ${data.media.title || b}`);
          setError(null);
        } else {
          setError(data.error || 'Auto-fetch failed — paste a URL');
        }
      } catch {
        if (!cancelled) setError('Auto-fetch failed — paste a URL');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [brandHint, brand, value?.url]);

  async function autoFetch() {
    const b = brand.trim();
    if (!b) {
      setError('Enter a brand name first');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await hostFetch('/api/logos/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: b }),
      });
      const data = await res.json();
      if (res.ok && data.matched && data.media) {
        onChange(data.media);
        setNote(`Fetched (${data.source || 'logo'}): ${data.media.title || b}`);
        if (data.needsHostReview) {
          setNote((n) => `${n} — host should confirm logo`);
        }
      } else {
        setError(data.error || 'No logo found');
      }
    } catch {
      setError('Resolve failed');
    } finally {
      setBusy(false);
    }
  }

  async function attachUrl() {
    const u = url.trim();
    const b = brand.trim() || value?.title || 'Brand';
    if (!u) {
      setError('Paste an image URL');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await hostFetch('/api/logos/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: b, url: u }),
      });
      const data = await res.json();
      if (res.ok && data.matched && data.media) {
        onChange(data.media);
        setNote(`Attached URL for ${b}`);
        setUrl('');
      } else {
        setError(data.error || 'Could not use that URL');
      }
    } catch {
      setError('Attach failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Brand logo</p>
        {value && (
          <button type="button" className="text-xs text-[var(--danger)]" onClick={() => onChange(undefined)}>
            Clear
          </button>
        )}
      </div>
      {value?.url && (
        <div className="rounded-2xl bg-white p-6 flex items-center justify-center">
          <img src={value.url} alt="" className="max-h-28 max-w-full object-contain" />
        </div>
      )}
      {value && (
        <p className="text-xs text-[var(--muted)]">
          Attached: <span className="text-[var(--text)] font-medium">{value.title || 'logo'}</span>
          {value.domain ? ` · ${value.domain}` : ''}
          {' '}(brand name hidden on TV until reveal)
        </p>
      )}
      {note && <p className="text-xs text-[var(--accent-2)]">{note}</p>}
      <label className="block text-sm">
        <span className="text-[var(--muted)]">Brand name</span>
        <input
          className="input mt-1"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="e.g. Nike"
        />
      </label>
      <button className="btn btn-ghost text-sm" type="button" disabled={busy || !brand.trim()} onClick={() => void autoFetch()}>
        {busy ? 'Fetching…' : 'Auto-fetch logo'}
      </button>
      <div className="flex gap-2">
        <input
          className="input flex-1 font-mono text-sm"
          placeholder="Or paste logo image URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void attachUrl())}
        />
        <button className="btn btn-ghost text-sm" type="button" disabled={busy || !url.trim()} onClick={() => void attachUrl()}>
          Attach URL
        </button>
      </div>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <p className="text-[10px] text-[var(--muted)]">
        Auto-fetch uses Wikidata → Wikimedia Commons, then Clearbit / favicon fallbacks.
      </p>
    </div>
  );
}

export default function MediaPicker({
  value,
  onChange,
  questionType,
  suggestQuery,
  acceptedAnswers,
}: {
  value?: MediaRef;
  onChange: (media: MediaRef | undefined) => void;
  questionType?: QuestionType;
  suggestQuery?: string;
  acceptedAnswers?: string[];
}) {
  const [q, setQ] = useState(suggestQuery?.trim() || '');
  const [hits, setHits] = useState<DeezerHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const autoTried = useRef(false);

  useEffect(() => {
    fetch('/api/deezer/status')
      .then((r) => r.json())
      .then((d) => setReady(!!d.configured))
      .catch(() => setReady(false));
  }, []);

  useEffect(() => {
    if (suggestQuery?.trim() && !q) setQ(suggestQuery.trim());
  }, [suggestQuery]);

  // Auto-attach on mount when music + prompt + answers and no media yet
  useEffect(() => {
    if (autoTried.current) return;
    if (questionType !== 'music') return;
    if (value?.deezerTrackId || value?.previewUrl) return;
    const prompt = suggestQuery?.trim();
    const answers = (acceptedAnswers ?? []).map((a) => String(a ?? '').trim()).filter(Boolean);
    if (!prompt || !answers.length || ready === false) return;
    autoTried.current = true;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const res = await hostFetch('/api/deezer/match-attach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, answers }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.matched && data.media) {
          onChange(data.media);
          setAutoNote(`Auto-attached: ${data.track?.label || formatAttached(data.media)}`);
          setError(null);
        }
      } catch {
        /* leave manual */
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [questionType, suggestQuery, acceptedAnswers, value?.deezerTrackId, value?.previewUrl, ready]);

  if (questionType === 'video') {
    return (
      <div className="rounded-xl border border-white/10 p-3 space-y-2">
        <p className="text-sm font-medium">Video clips removed</p>
        <p className="text-xs text-[var(--muted)]">
          Product music uses Deezer ~30s previews. Change this question to <strong>music</strong> or <strong>open</strong>.
        </p>
        {value && (
          <button type="button" className="text-xs text-[var(--danger)]" onClick={() => onChange(undefined)}>
            Clear attached media
          </button>
        )}
      </div>
    );
  }

  if (questionType === 'brand_logo') {
    return (
      <BrandLogoPicker
        value={value}
        onChange={onChange}
        brandHint={(acceptedAnswers ?? []).find((a) => a.trim()) || suggestQuery}
      />
    );
  }

  if (questionType === 'image') {
    return (
      <ImageUrlPicker value={value} onChange={onChange} />
    );
  }

  if (questionType !== 'music' && questionType !== undefined) {
    return null;
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
      if (!res.ok) {
        setError(data.error || 'Attach failed');
        return;
      }
      onChange(data.media);
      setAutoNote(null);
    } catch {
      setError('Attach failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Deezer preview (~30s)</p>
        {value && (
          <button type="button" className="text-xs text-[var(--danger)]" onClick={() => onChange(undefined)}>
            Clear
          </button>
        )}
      </div>
      {ready === false && (
        <p className="text-xs text-[var(--danger)]">Deezer search unavailable — check network.</p>
      )}
      {value && (
        <p className="text-xs text-[var(--muted)]">
          Attached:{' '}
          <span className="text-[var(--text)] font-medium">{formatAttached(value)}</span>
          {value.previewUrl ? ' · preview ready' : ''}
          {' '}(title/artist hidden on TV until reveal)
        </p>
      )}
      {autoNote && !value && (
        <p className="text-xs text-[var(--muted)]">{autoNote}</p>
      )}
      {autoNote && value && (
        <p className="text-xs text-[var(--accent-2)]">{autoNote}</p>
      )}
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Search Deezer tracks…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), search())}
        />
        <button className="btn btn-ghost text-sm" type="button" disabled={busy || !q.trim()} onClick={() => void search()}>
          Search
        </button>
      </div>
      <div className="grid gap-2 max-h-48 overflow-y-auto">
        {hits.map((h) => (
          <button
            key={h.id}
            type="button"
            disabled={!h.hasPreview || busy}
            className="flex items-center gap-3 rounded-lg bg-white/5 px-2 py-2 text-left hover:bg-white/10 disabled:opacity-40"
            onClick={() => void attach(h.id)}
          >
            {h.artworkUrl && <img src={h.artworkUrl} alt="" className="h-10 w-10 rounded object-cover" />}
            <span className="text-sm">
              <span className="font-medium">
                {h.name} — {h.artists}
                {h.album ? ` (${h.album})` : ''}
              </span>
              <span className="block text-xs text-[var(--muted)]">
                {h.hasPreview ? 'preview' : 'no preview'}
              </span>
            </span>
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <p className="text-[10px] text-[var(--muted)]">
        Only tracks with a Deezer preview URL can be attached. Playback is the preview only.
      </p>
    </div>
  );
}
