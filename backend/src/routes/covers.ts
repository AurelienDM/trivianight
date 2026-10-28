import { Router } from 'express';
import { loadCoversCatalog, parseYoutubeId, searchCovers, youtubeEmbedUrl } from '../media/coversCatalog.js';
import {
  loadVideoCatalog,
  resolveVideoCatalogId,
  searchVideos,
  suggestVideo,
} from '../media/videoCatalog.js';
import { getAvailableProviders } from '../media/providers.js';
import type { MediaRef } from '../shared/types.js';

const router = Router();

router.get('/providers', (_req, res) => {
  res.json(
    getAvailableProviders().map((p) => ({
      id: p.id,
      label: p.label,
      searchable: typeof p.search === 'function',
    })),
  );
});

router.get('/catalog', async (req, res) => {
  const kind = String(req.query.kind ?? 'music');
  if (kind === 'video') {
    const clips = await loadVideoCatalog();
    return res.json(clips.map((c) => ({
      id: c.id,
      title: c.title,
      artist: c.artist ?? '',
      label: 'Video clip',
      youtubeId: c.youtubeId,
      artworkUrl: `https://i.ytimg.com/vi/${c.youtubeId}/hqdefault.jpg`,
      tags: c.tags,
      kind: 'video',
    })));
  }
  const clips = await loadCoversCatalog();
  res.json(clips.map((c) => ({
    id: c.id,
    title: c.originalTitle,
    artist: c.originalArtist,
    label: c.coverLabel,
    youtubeId: c.youtubeId,
    artworkUrl: `https://i.ytimg.com/vi/${c.youtubeId}/hqdefault.jpg`,
    tags: c.tags,
    kind: 'music',
  })));
});

router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '');
  const kind = String(req.query.kind ?? 'music');
  if (kind === 'video') {
    res.json(await searchVideos(q));
    return;
  }
  res.json(await searchCovers(q));
});

/** Best-effort auto-pick from video or music catalog (never invents IDs). */
router.get('/suggest', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const kind = String(req.query.kind ?? 'music') as 'video' | 'music';
  if (!q) return res.json({ media: null, reason: 'empty query' });

  if (kind === 'video') {
    const media = await suggestVideo(q);
    return res.json({ media, source: media ? 'video-catalog' : null });
  }

  const hits = await searchCovers(q);
  const top = hits[0];
  if (!top?.youtubeId) return res.json({ media: null, source: null });
  const media: MediaRef = {
    kind: 'youtube',
    youtubeId: top.youtubeId,
    url: youtubeEmbedUrl(top.youtubeId),
    title: top.title,
    artist: top.artist,
  };
  res.json({ media, source: 'covers-catalog' });
});

/** Build a MediaRef from catalog id or pasted YouTube URL */
router.post('/attach', async (req, res) => {
  const { catalogId, youtubeUrl, title, artist, kind } = req.body as {
    catalogId?: string;
    youtubeUrl?: string;
    title?: string;
    artist?: string;
    kind?: 'video' | 'music';
  };

  if (catalogId) {
    if (kind === 'video' || String(catalogId).startsWith('video-')) {
      const media = await resolveVideoCatalogId(catalogId);
      if (!media) return res.status(404).json({ error: 'Video clip not found' });
      return res.json({ media, clip: { id: catalogId } });
    }
    const clips = await loadCoversCatalog();
    const clip = clips.find((c) => c.id === catalogId);
    if (!clip) {
      // Fall back to video catalog ids
      const media = await resolveVideoCatalogId(catalogId);
      if (media) return res.json({ media, clip: { id: catalogId } });
      return res.status(404).json({ error: 'Clip not found' });
    }
    const media: MediaRef = {
      kind: 'youtube',
      url: youtubeEmbedUrl(clip.youtubeId),
      youtubeId: clip.youtubeId,
      title: clip.originalTitle,
      artist: clip.originalArtist,
    };
    return res.json({ media, clip });
  }

  const id = youtubeUrl ? parseYoutubeId(youtubeUrl) : null;
  if (!id) return res.status(400).json({ error: 'Provide catalogId or a valid YouTube URL / id' });

  const media: MediaRef = {
    kind: 'youtube',
    url: youtubeEmbedUrl(id),
    youtubeId: id,
    title: title || 'YouTube clip',
    artist: artist,
  };
  res.json({ media });
});

export default router;
