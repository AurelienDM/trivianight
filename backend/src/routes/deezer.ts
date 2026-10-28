import { Router } from 'express';
import { requireHostPasscode } from '../middleware/requireHostPasscode.js';
import {
  formatDeezerAttachLabel,
  getDeezerAppId,
  getDeezerTrack,
  isDeezerConfigured,
  matchAttachDeezerTrack,
  searchDeezerTracks,
  trackToMediaRef,
} from '../media/deezer.js';

const router = Router();

router.get('/status', async (_req, res) => {
  const appId = await getDeezerAppId();
  res.json({
    configured: await isDeezerConfigured(),
    appIdConfigured: !!appId,
  });
});

router.get('/search', requireHostPasscode, async (req, res) => {
  try {
    const q = String(req.query.q ?? '');
    const tracks = await searchDeezerTracks(q);
    res.json({
      tracks: tracks.map((t) => ({
        id: t.id,
        name: t.name,
        artists: t.artists,
        album: t.album,
        artworkUrl: t.artworkUrl,
        hasPreview: !!t.previewUrl,
        previewUrl: t.previewUrl,
      })),
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Search failed', tracks: [] });
  }
});

router.post('/attach', requireHostPasscode, async (req, res) => {
  try {
    const trackId = String((req.body as { trackId?: string })?.trackId ?? '').trim();
    if (!trackId) {
      res.status(400).json({ error: 'trackId required' });
      return;
    }
    const track = await getDeezerTrack(trackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    const media = trackToMediaRef(track);
    if (!media) {
      res.status(422).json({
        error: 'No preview available for this track — pick another',
        track: { id: track.id, name: track.name, artists: track.artists },
      });
      return;
    }
    res.json({ media });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Attach failed' });
  }
});

/**
 * Auto-attach from prompt+answers (album/title/artist).
 * No clarify gate when enough info is present.
 */
router.post('/match-attach', requireHostPasscode, async (req, res) => {
  try {
    const body = req.body as {
      query?: string;
      title?: string;
      artist?: string;
      album?: string;
      prompt?: string;
      answers?: string[];
    };
    const answers = Array.isArray(body.answers)
      ? body.answers.map((a) => String(a ?? '').trim()).filter(Boolean)
      : undefined;

    const result = await matchAttachDeezerTrack({
      query: body.query,
      title: body.title,
      artist: body.artist,
      album: body.album,
      prompt: body.prompt,
      answers,
    });

    if (!result.matched || !result.media || !result.hit) {
      res.status(422).json({
        matched: false,
        error: result.error || 'No strong Deezer match — attach manually in the editor',
        score: result.score ?? 0,
        top: result.top ?? null,
      });
      return;
    }

    const label = result.label || formatDeezerAttachLabel(result.hit);
    res.json({
      matched: true,
      mode: result.mode,
      score: result.score,
      media: result.media,
      track: {
        id: result.hit.id,
        name: result.hit.name,
        artists: result.hit.artists,
        album: result.hit.album,
        label,
        hasPreview: !!result.hit.previewUrl,
      },
    });
  } catch (err) {
    res.status(502).json({
      matched: false,
      error: err instanceof Error ? err.message : 'Match-attach failed',
    });
  }
});

router.get('/preview/:trackId', async (req, res) => {
  try {
    const track = await getDeezerTrack(req.params.trackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found', previewUrl: null });
      return;
    }
    res.json({
      previewUrl: track.previewUrl,
      title: track.name,
      artist: track.artists,
      album: track.album,
      deezerTrackId: track.id,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Preview resolve failed', previewUrl: null });
  }
});

export default router;
