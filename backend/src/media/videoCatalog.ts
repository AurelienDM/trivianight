import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { MediaRef } from '../shared/types.js';
import { youtubeEmbedUrl } from './coversCatalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface VideoClip {
  id: string;
  title: string;
  artist?: string;
  youtubeId: string;
  query: string;
  tags?: string[];
}

let catalog: VideoClip[] | null = null;

export async function loadVideoCatalog(): Promise<VideoClip[]> {
  if (catalog) return catalog;
  const fixture = path.resolve(__dirname, '../../fixtures/video-catalog.json');
  const raw = await fs.readFile(fixture, 'utf-8');
  catalog = JSON.parse(raw) as VideoClip[];
  return catalog;
}

export async function searchVideos(query: string): Promise<Array<{
  id: string;
  title: string;
  artist: string;
  youtubeId: string;
  artworkUrl: string;
  album?: string;
  provider: 'video';
}>> {
  const q = query.trim().toLowerCase();
  const clips = await loadVideoCatalog();
  return clips
    .filter((c) => {
      const hay = `${c.title} ${c.artist ?? ''} ${c.query} ${(c.tags ?? []).join(' ')}`.toLowerCase();
      if (!q) return true;
      return hay.includes(q) || q.split(/\s+/).every((t) => hay.includes(t));
    })
    .map((c) => ({
      id: c.id,
      title: c.title,
      artist: c.artist ?? '',
      youtubeId: c.youtubeId,
      artworkUrl: `https://i.ytimg.com/vi/${c.youtubeId}/hqdefault.jpg`,
      album: 'Video clip',
      provider: 'video' as const,
    }));
}

export async function suggestVideo(query: string): Promise<MediaRef | null> {
  const hits = await searchVideos(query);
  const top = hits[0];
  if (!top) return null;
  return {
    kind: 'youtube',
    youtubeId: top.youtubeId,
    url: youtubeEmbedUrl(top.youtubeId),
    title: top.title,
    artist: top.artist || undefined,
  };
}

export async function resolveVideoCatalogId(catalogId: string): Promise<MediaRef | null> {
  const clips = await loadVideoCatalog();
  const clip = clips.find((c) => c.id === catalogId || c.youtubeId === catalogId);
  if (!clip) return null;
  return {
    kind: 'youtube',
    youtubeId: clip.youtubeId,
    url: youtubeEmbedUrl(clip.youtubeId),
    title: clip.title,
    artist: clip.artist,
  };
}
