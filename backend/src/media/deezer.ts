/**
 * Deezer public API — search + ~30s preview URLs.
 * No secret required for search/preview; optional Application ID for attribution.
 */

import { getSettings } from '../storage/settingsStorage.js';

const API = 'https://api.deezer.com';

/** Minimum combined title+artist score to auto-attach (title≤1 + artist≤1). */
export const DEEZER_MATCH_MIN_SCORE = 1.2;
/** Stricter floor when both title and artist are provided (AI answer-first attach). */
export const DEEZER_HIGH_CONFIDENCE_MIN = 1.5;
/** Album+artist auto-attach floor (album≤1 + artist≤1). */
export const DEEZER_ALBUM_MIN_SCORE = 1.5;

export interface DeezerTrackHit {
  id: string;
  name: string;
  artists: string;
  album?: string;
  artworkUrl?: string;
  previewUrl: string | null;
  durationMs?: number;
}

export interface DeezerAlbumHit {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  trackCount?: number;
}

export interface ParsedMusicSearchTerm {
  title: string;
  artist: string;
  raw: string;
}

export interface MusicAttachTarget {
  title?: string;
  artist?: string;
  album?: string;
  query: string;
  /** Hint for which path to try first */
  modeHint?: 'album' | 'track' | 'artist';
}

export type DeezerAttachMode = 'album' | 'track' | 'artist';

export interface DeezerMatchAttachResult {
  matched: boolean;
  mode?: DeezerAttachMode;
  score?: number;
  hit?: DeezerTrackHit;
  media?: NonNullable<ReturnType<typeof trackToMediaRef>>;
  label?: string;
  error?: string;
  top?: { id: string; name: string; artists: string; hasPreview: boolean } | null;
}

function normalizeMusicToken(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normalizeMusicToken(s).split(/\s+/).filter((t) => t.length > 1));
}

/** Overlap of query tokens covered by candidate (0–1). */
function coverageScore(query: string, candidate: string): number {
  const q = tokenSet(query);
  const c = tokenSet(candidate);
  if (!q.size) return 0;
  let hit = 0;
  for (const t of q) if (c.has(t)) hit++;
  return hit / q.size;
}

/** Extract album title from prompt quotes / “album …” phrasing. */
export function parseAlbumFromPrompt(prompt: string): string | null {
  const p = (prompt ?? '').trim();
  if (!p) return null;

  const albumWord = /\balbum\b/i.test(p);

  // album '…' / album "…" / album titled …
  const labeled = p.match(
    /\balbum\b(?:\s+(?:titled|called|named))?\s*['\u2018\u2019"\u201C\u201D]([^'\u2018\u2019"\u201C\u201D]{2,80})['\u2018\u2019"\u201C\u201D]/i,
  );
  if (labeled?.[1]) return labeled[1].trim();

  // the album The Dark Side… (unquoted after album)
  const afterAlbum = p.match(/\balbum\b\s+([A-Z][^?.!]{2,80}?)(?:\s+in\s+\d{4}|\s*\?|$)/);
  if (afterAlbum?.[1] && !/^(titled|called|named)\b/i.test(afterAlbum[1])) {
    const cand = afterAlbum[1].replace(/\s+/g, ' ').trim();
    if (cand.split(/\s+/).length >= 2) return cand;
  }

  if (!albumWord) return null;

  // Nearby quotes when “album” is present
  const quotes = [...p.matchAll(/['\u2018\u2019"\u201C\u201D]([^'\u2018\u2019"\u201C\u201D]{2,80})['\u2018\u2019"\u201C\u201D]/g)];
  if (quotes.length === 1 && quotes[0]?.[1]) return quotes[0][1].trim();
  if (quotes.length > 1) {
    // Prefer the quote closest after “album”
    const albumIdx = p.toLowerCase().indexOf('album');
    let best: { text: string; dist: number } | null = null;
    for (const m of quotes) {
      const text = m[1]?.trim();
      if (!text || m.index == null) continue;
      const dist = Math.abs(m.index - albumIdx);
      if (!best || dist < best.dist) best = { text, dist };
    }
    if (best) return best.text;
  }
  return null;
}

/** Prompt asks which band/artist released/recorded an album (answer is the artist). */
export function promptImpliesArtistAnswer(prompt: string): boolean {
  const p = (prompt ?? '').trim().toLowerCase();
  if (!p) return false;
  if (/\bwhich\s+(band|artist|group|singer|duo|act)\b/.test(p)) return true;
  if (/\bwho\s+(released|recorded|made|created|produced)\b/.test(p)) return true;
  if (/\b(released|recorded)\s+the\s+album\b/.test(p) && /\b(which|who|what\s+band)\b/.test(p)) {
    return true;
  }
  if (/\bwhat\s+(band|artist|group)\b/.test(p) && /\balbum\b/.test(p)) return true;
  return false;
}

/** Parse "Title - Artist", "Title — Artist", "Title by Artist", or bare title. */
export function parseMusicSearchTerm(term: string): ParsedMusicSearchTerm {
  const raw = (term ?? '').trim();
  if (!raw) return { title: '', artist: '', raw: '' };
  const by = raw.match(/^(.*?)\s+by\s+(.+)$/i);
  if (by) {
    return { title: by[1]!.trim(), artist: by[2]!.trim(), raw };
  }
  const dash = raw.split(/\s+[—–-]\s+/);
  if (dash.length >= 2) {
    return {
      title: dash[0]!.trim(),
      artist: dash.slice(1).join(' - ').trim(),
      raw,
    };
  }
  return { title: raw, artist: '', raw };
}

/**
 * Resolve attach target from prompt + answers.
 * Album prompts with band answers do NOT treat the answer as a track title.
 */
export function resolveMusicAttachTarget(input: {
  prompt?: string;
  answers?: string[];
  title?: string;
  artist?: string;
  album?: string;
  query?: string;
}): MusicAttachTarget {
  const prompt = String(input.prompt ?? '').trim();
  const answers = (input.answers ?? []).map((a) => String(a ?? '').trim()).filter(Boolean);
  const primary = answers[0] || '';

  let album = String(input.album ?? '').trim() || parseAlbumFromPrompt(prompt) || '';
  let title = String(input.title ?? '').trim();
  let artist = String(input.artist ?? '').trim();

  if (album && promptImpliesArtistAnswer(prompt) && primary) {
    // Answer is the band/artist — never set title=answer
    artist = artist || primary;
    title = '';
    const query = [album, artist].filter(Boolean).join(' ');
    return { album, artist, title: undefined, query, modeHint: 'album' };
  }

  if (!title && !artist && primary) {
    const parsed = parseMusicSearchTerm(primary);
    if (parsed.artist) {
      title = parsed.title;
      artist = parsed.artist;
    } else if (answers.length >= 2) {
      // "Song", "Artist" as separate accepted answers
      const second = answers[1]!;
      if (second.length >= 2 && second.length <= 48 && !/^\d{4}$/.test(second)) {
        title = primary;
        artist = second;
      } else {
        title = primary;
      }
    } else if (!album) {
      title = primary;
    } else {
      // Have album from prompt but answer isn't clearly artist — still use as artist if album Q
      artist = primary;
    }
  }

  if (album && artist && !title) {
    return {
      album,
      artist,
      query: String(input.query ?? '').trim() || `${album} ${artist}`,
      modeHint: 'album',
    };
  }

  const query = String(input.query ?? '').trim()
    || [title, artist].filter(Boolean).join(' ')
    || [album, artist].filter(Boolean).join(' ')
    || primary
    || prompt.slice(0, 80);

  return {
    title: title || undefined,
    artist: artist || undefined,
    album: album || undefined,
    query,
    modeHint: title && artist ? 'track' : album && artist ? 'album' : artist ? 'artist' : 'track',
  };
}

/**
 * Rank a Deezer hit against a search term and/or explicit title+artist.
 * Title coverage contributes up to 1.0; artist up to 1.0 (total ≤ 2.0).
 */
export function scoreDeezerHit(
  hit: DeezerTrackHit,
  term: string,
  parts?: { title?: string; artist?: string },
): number {
  const parsed = parseMusicSearchTerm(term);
  const titleQ = (parts?.title || parsed.title || parsed.raw).trim();
  const artistQ = (parts?.artist || parsed.artist).trim();

  let titleScore = coverageScore(titleQ, hit.name);
  if (normalizeMusicToken(titleQ) && normalizeMusicToken(titleQ) === normalizeMusicToken(hit.name)) {
    titleScore = 1;
  } else if (titleScore >= 0.8) {
    titleScore = Math.min(1, titleScore + 0.1);
  }

  let artistScore = 0;
  if (artistQ) {
    artistScore = coverageScore(artistQ, hit.artists);
    if (normalizeMusicToken(artistQ) === normalizeMusicToken(hit.artists)) {
      artistScore = 1;
    } else if (artistScore >= 0.8) {
      artistScore = Math.min(1, artistScore + 0.1);
    }
  } else {
    artistScore = titleScore >= 0.95 ? 0.35 : 0;
  }

  return Math.round((titleScore + artistScore) * 100) / 100;
}

/** Album title + artist scoring (total ≤ 2.0). */
export function scoreDeezerAlbum(
  album: DeezerAlbumHit,
  albumQ: string,
  artistQ?: string,
): number {
  let albumScore = coverageScore(albumQ, album.title);
  if (normalizeMusicToken(albumQ) === normalizeMusicToken(album.title)) {
    albumScore = 1;
  } else if (albumScore >= 0.8) {
    albumScore = Math.min(1, albumScore + 0.1);
  }

  let artistScore = 0;
  if (artistQ) {
    artistScore = coverageScore(artistQ, album.artist);
    if (normalizeMusicToken(artistQ) === normalizeMusicToken(album.artist)) {
      artistScore = 1;
    } else if (artistScore >= 0.8) {
      artistScore = Math.min(1, artistScore + 0.1);
    }
  }

  return Math.round((albumScore + artistScore) * 100) / 100;
}

export function pickBestDeezerTrack(
  hits: DeezerTrackHit[],
  term: string,
  minScore = DEEZER_MATCH_MIN_SCORE,
  parts?: { title?: string; artist?: string },
): { hit: DeezerTrackHit; score: number } | null {
  let best: { hit: DeezerTrackHit; score: number } | null = null;
  for (const hit of hits) {
    if (!hit.previewUrl) continue;
    const score = scoreDeezerHit(hit, term, parts);
    if (!best || score > best.score) best = { hit, score };
  }
  if (!best || best.score < minScore) return null;
  return best;
}

export function pickBestDeezerAlbum(
  albums: DeezerAlbumHit[],
  albumQ: string,
  artistQ?: string,
  minScore = DEEZER_ALBUM_MIN_SCORE,
): { album: DeezerAlbumHit; score: number } | null {
  let best: { album: DeezerAlbumHit; score: number } | null = null;
  for (const album of albums) {
    const score = scoreDeezerAlbum(album, albumQ, artistQ);
    if (!best || score > best.score) best = { album, score };
  }
  if (!best || best.score < minScore) return null;
  return best;
}

/** Prefer a substantial preview track (skip short intros when possible). */
function pickAlbumPreviewTrack(tracks: DeezerTrackHit[]): DeezerTrackHit | null {
  const withPreview = tracks.filter((t) => t.previewUrl);
  if (!withPreview.length) return null;
  const substantial = withPreview.filter((t) => (t.durationMs ?? 0) >= 90_000);
  if (substantial.length) {
    // Prefer longest among substantial — often the hit single (e.g. Money)
    return substantial.reduce((a, b) => ((b.durationMs ?? 0) > (a.durationMs ?? 0) ? b : a));
  }
  return withPreview[0] ?? null;
}

export function formatDeezerAttachLabel(hit: DeezerTrackHit): string {
  const base = `${hit.name} — ${hit.artists || 'Unknown'}`;
  return hit.album ? `${base} (${hit.album})` : base;
}

export async function isDeezerConfigured(): Promise<boolean> {
  return true;
}

export async function getDeezerAppId(): Promise<string> {
  const s = await getSettings();
  return s.deezerAppId?.trim() ?? '';
}

function mapTrack(t: {
  id: number | string;
  title?: string;
  title_short?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string; cover_small?: string };
  preview?: string | null;
  duration?: number;
}): DeezerTrackHit {
  return {
    id: String(t.id),
    name: t.title || t.title_short || 'Track',
    artists: t.artist?.name ?? '',
    album: t.album?.title,
    artworkUrl: t.album?.cover_medium || t.album?.cover_small,
    previewUrl: t.preview || null,
    durationMs: typeof t.duration === 'number' ? t.duration * 1000 : undefined,
  };
}

function mapAlbum(a: {
  id: number | string;
  title?: string;
  artist?: { name?: string };
  cover_medium?: string;
  cover_small?: string;
  nb_tracks?: number;
}): DeezerAlbumHit {
  return {
    id: String(a.id),
    title: a.title || 'Album',
    artist: a.artist?.name ?? '',
    artworkUrl: a.cover_medium || a.cover_small,
    trackCount: a.nb_tracks,
  };
}

export async function searchDeezerTracks(query: string, limit = 12): Promise<DeezerTrackHit[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${API}/search?q=${encodeURIComponent(q)}&limit=${Math.min(25, Math.max(1, limit))}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Deezer search failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: unknown[]; error?: { message?: string } };
  if (data.error?.message) throw new Error(data.error.message);
  const items = (data.data ?? []) as Array<Parameters<typeof mapTrack>[0]>;
  return items.map(mapTrack);
}

export async function searchDeezerAlbums(query: string, limit = 8): Promise<DeezerAlbumHit[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${API}/search/album?q=${encodeURIComponent(q)}&limit=${Math.min(25, Math.max(1, limit))}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Deezer album search failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: unknown[]; error?: { message?: string } };
  if (data.error?.message) throw new Error(data.error.message);
  const items = (data.data ?? []) as Array<Parameters<typeof mapAlbum>[0]>;
  return items.map(mapAlbum);
}

export async function fetchDeezerAlbumTracks(albumId: string): Promise<DeezerTrackHit[]> {
  const id = albumId.trim();
  if (!id) return [];
  const res = await fetch(`${API}/album/${encodeURIComponent(id)}/tracks?limit=50`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Deezer album tracks failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    data?: Array<Parameters<typeof mapTrack>[0] & { artist?: { name?: string } }>;
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(data.error.message);
  // Album endpoint omits nested album title — caller should stamp it
  return (data.data ?? []).map(mapTrack);
}

export async function getDeezerTrack(trackId: string): Promise<DeezerTrackHit | null> {
  const id = trackId.trim();
  if (!id) return null;
  const res = await fetch(`${API}/track/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Deezer track failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json() as Parameters<typeof mapTrack>[0] & { error?: { message?: string } };
  if ((data as { error?: { message?: string } }).error) return null;
  return mapTrack(data);
}

export function trackToMediaRef(track: DeezerTrackHit) {
  if (!track.previewUrl) return null;
  return {
    kind: 'deezer' as const,
    deezerTrackId: track.id,
    previewUrl: track.previewUrl,
    title: track.name,
    artist: track.artists,
    album: track.album,
    durationMs: 30_000,
  };
}

async function tryAlbumAttach(
  albumQ: string,
  artistQ: string,
): Promise<{ hit: DeezerTrackHit; score: number } | null> {
  const albums = await searchDeezerAlbums(`${albumQ} ${artistQ}`, 8);
  const bestAlbum = pickBestDeezerAlbum(albums, albumQ, artistQ);
  if (!bestAlbum) return null;

  let tracks = await fetchDeezerAlbumTracks(bestAlbum.album.id);
  tracks = tracks.map((t) => ({
    ...t,
    album: t.album || bestAlbum.album.title,
    artists: t.artists || bestAlbum.album.artist,
    artworkUrl: t.artworkUrl || bestAlbum.album.artworkUrl,
  }));

  // Prefer a track that Deezer ranks for album+artist search (often the hit single)
  const searched = await searchDeezerTracks(`"${albumQ}" ${artistQ}`, 15);
  const albumIds = new Set(tracks.map((t) => t.id));
  const fromSearch = searched.find(
    (t) =>
      !!t.previewUrl
      && coverageScore(artistQ, t.artists) >= 0.75
      && (
        albumIds.has(t.id)
        || (t.album != null && coverageScore(albumQ, t.album) >= 0.7)
      ),
  );

  let picked = fromSearch
    ? {
        ...fromSearch,
        album: fromSearch.album || bestAlbum.album.title,
        artists: fromSearch.artists || bestAlbum.album.artist,
      }
    : pickAlbumPreviewTrack(tracks);

  if (!picked?.previewUrl) return null;
  if (!picked.album) picked = { ...picked, album: bestAlbum.album.title };
  return { hit: picked, score: bestAlbum.score };
}

/**
 * Orchestrate attach: album → title+artist → artist fallback.
 * Auto-attaches when enough info — no clarify gate.
 */
export async function matchAttachDeezerTrack(input: {
  prompt?: string;
  answers?: string[];
  title?: string;
  artist?: string;
  album?: string;
  query?: string;
}): Promise<DeezerMatchAttachResult> {
  const target = resolveMusicAttachTarget(input);
  if (!target.query && !target.album && !target.title && !target.artist) {
    return { matched: false, error: 'query or title/artist/album required' };
  }

  // 1) Album path
  if (target.album && target.artist) {
    try {
      const albumHit = await tryAlbumAttach(target.album, target.artist);
      if (albumHit) {
        const media = trackToMediaRef(albumHit.hit);
        if (media) {
          return {
            matched: true,
            mode: 'album',
            score: albumHit.score,
            hit: albumHit.hit,
            media,
            label: formatDeezerAttachLabel(albumHit.hit),
          };
        }
      }
    } catch {
      /* fall through to track path */
    }
  }

  // 2) Title + artist track path
  if (target.title && target.artist) {
    const scoreTerm = `${target.title} — ${target.artist}`;
    const tracks = await searchDeezerTracks(target.query || `${target.title} ${target.artist}`, 15);
    const best = pickBestDeezerTrack(tracks, scoreTerm, DEEZER_HIGH_CONFIDENCE_MIN, {
      title: target.title,
      artist: target.artist,
    });
    if (best) {
      const media = trackToMediaRef(best.hit);
      if (media) {
        return {
          matched: true,
          mode: 'track',
          score: best.score,
          hit: best.hit,
          media,
          label: formatDeezerAttachLabel(best.hit),
        };
      }
    }
    const top = tracks[0];
    return {
      matched: false,
      mode: 'track',
      error: 'No strong title+artist Deezer match — attach manually in the editor',
      score: top ? scoreDeezerHit(top, scoreTerm, { title: target.title, artist: target.artist }) : 0,
      top: top
        ? { id: top.id, name: top.name, artists: top.artists, hasPreview: !!top.previewUrl }
        : null,
    };
  }

  // 3) Artist / bare query fallback (looser)
  const tracks = await searchDeezerTracks(target.query, 15);
  const parts = target.title || target.artist
    ? { title: target.title, artist: target.artist }
    : undefined;
  const best = pickBestDeezerTrack(
    tracks,
    target.query,
    target.artist && !target.title ? DEEZER_MATCH_MIN_SCORE : DEEZER_HIGH_CONFIDENCE_MIN,
    parts,
  );
  if (best) {
    const media = trackToMediaRef(best.hit);
    if (media) {
      return {
        matched: true,
        mode: target.artist && !target.title ? 'artist' : 'track',
        score: best.score,
        hit: best.hit,
        media,
        label: formatDeezerAttachLabel(best.hit),
      };
    }
  }

  const top = tracks[0];
  return {
    matched: false,
    error: 'No strong Deezer match — attach manually in the editor',
    score: top ? scoreDeezerHit(top, target.query, parts) : 0,
    top: top
      ? { id: top.id, name: top.name, artists: top.artists, hasPreview: !!top.previewUrl }
      : null,
  };
}
