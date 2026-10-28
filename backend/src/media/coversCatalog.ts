import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { MediaProvider, TrackSearchResult } from './providers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CoverClip {
  id: string;
  originalTitle: string;
  originalArtist: string;
  coverLabel: string;
  youtubeId: string;
  query: string;
  tags?: string[];
}

let catalog: CoverClip[] | null = null;

export async function loadCoversCatalog(): Promise<CoverClip[]> {
  if (catalog) return catalog;
  const fixture = path.resolve(__dirname, '../../fixtures/covers-catalog.json');
  const raw = await fs.readFile(fixture, 'utf-8');
  catalog = JSON.parse(raw) as CoverClip[];
  return catalog;
}

export function youtubeEmbedUrl(youtubeId: string, opts?: { autoplay?: boolean; startSec?: number }): string {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    controls: '1',
  });
  if (opts?.autoplay) params.set('autoplay', '1');
  if (opts?.startSec != null) params.set('start', String(Math.floor(opts.startSec)));
  return `https://www.youtube.com/embed/${youtubeId}?${params.toString()}`;
}

export function parseYoutubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).slice(0, 11) || null;
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/\/embed\/([\w-]{11})/);
    if (m) return m[1];
  } catch {
    /* not a url */
  }
  return null;
}

export async function searchCovers(query: string): Promise<TrackSearchResult[]> {
  const q = query.trim().toLowerCase();
  const clips = await loadCoversCatalog();
  const scored = clips
    .map((c) => {
      const hay = `${c.originalTitle} ${c.originalArtist} ${c.query} ${(c.tags ?? []).join(' ')}`.toLowerCase();
      const hit = !q || hay.includes(q) || q.split(/\s+/).every((t) => hay.includes(t));
      return { c, hit };
    })
    .filter((x) => x.hit)
    .map(({ c }) => ({
      id: c.id,
      title: c.originalTitle,
      artist: c.originalArtist,
      album: c.coverLabel,
      previewUrl: youtubeEmbedUrl(c.youtubeId),
      artworkUrl: `https://i.ytimg.com/vi/${c.youtubeId}/hqdefault.jpg`,
      youtubeId: c.youtubeId,
      provider: 'covers' as const,
    }));
  return scored;
}

export const coversMediaProvider: MediaProvider = {
  id: 'covers',
  label: 'Cover clips (YouTube)',
  async search(query: string) {
    return searchCovers(query);
  },
  async resolvePlayback(catalogId: string) {
    const clips = await loadCoversCatalog();
    const clip = clips.find((c) => c.id === catalogId || c.youtubeId === catalogId);
    if (!clip) return null;
    return { kind: 'youtube', url: youtubeEmbedUrl(clip.youtubeId, { autoplay: true }) };
  },
};
