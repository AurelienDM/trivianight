import { Router } from 'express';
import { requireHostPasscode } from '../middleware/requireHostPasscode.js';
import {
  clearSpotifyTokenCache,
  getSpotifyTrack,
  isSpotifyConfigured,
  searchSpotifyTracks,
  trackToMediaRef,
} from '../media/spotify.js';

const router = Router();

router.get('/status', async (_req, res) => {
  res.json({ configured: await isSpotifyConfigured() });
});

router.get('/search', requireHostPasscode, async (req, res) => {
  try {
    if (!(await isSpotifyConfigured())) {
      res.status(400).json({ error: 'Spotify not configured', tracks: [] });
      return;
    }
    const q = String(req.query.q ?? '');
    const tracks = await searchSpotifyTracks(q);
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

/** Attach a track — requires a non-null preview_url for Host/TV playback. */
router.post('/attach', requireHostPasscode, async (req, res) => {
  try {
    if (!(await isSpotifyConfigured())) {
      res.status(400).json({ error: 'Spotify not configured' });
      return;
    }
    const trackId = String((req.body as { trackId?: string })?.trackId ?? '').trim();
    if (!trackId) {
      res.status(400).json({ error: 'trackId required' });
      return;
    }
    const track = await getSpotifyTrack(trackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    const media = trackToMediaRef(track);
    if (!media) {
      res.status(422).json({
        error: 'No 30s preview available for this track — pick another',
        track: { id: track.id, name: track.name, artists: track.artists },
      });
      return;
    }
    res.json({ media });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Attach failed' });
  }
});

/** Resolve / refresh preview URL for a stored spotifyTrackId (e.g. sample quizzes). */
router.get('/preview/:trackId', async (req, res) => {
  try {
    if (!(await isSpotifyConfigured())) {
      res.status(400).json({ error: 'Spotify not configured', previewUrl: null });
      return;
    }
    const track = await getSpotifyTrack(req.params.trackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found', previewUrl: null });
      return;
    }
    res.json({
      previewUrl: track.previewUrl,
      title: track.name,
      artist: track.artists,
      spotifyTrackId: track.id,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Preview resolve failed', previewUrl: null });
  }
});

export { clearSpotifyTokenCache };
export default router;
