import { Router } from 'express';
import { requireHostPasscode } from '../middleware/requireHostPasscode.js';
import { mediaFromLogoUrl, resolveBrandLogo } from '../media/logos.js';
import { proxyLogoToResponse } from '../services/logoProxy.js';

const router = Router();

/**
 * Same-origin logo proxy (CORS *) — fixes blank Commons/CDN logos on TV/Host/phone.
 * Public (no host passcode): only allowlisted hosts; bytes cached under data/media/logos/.
 */
router.get('/img', async (req, res) => {
  const u = String(req.query.u ?? '').trim();
  if (!u) {
    res.status(400).json({ error: 'u query required' });
    return;
  }
  try {
    await proxyLogoToResponse(u, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Proxy failed' });
    }
  }
});

/**
 * Resolve a brand → logo image (Wikidata Commons, then domain icons).
 * Host-only. Failures return 422 so the editor can mark review — never silent blank logos.
 */
router.post('/resolve', requireHostPasscode, async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      brand?: string;
      domain?: string;
      url?: string;
      answers?: string[];
    };
    const pastedUrl = typeof body.url === 'string' ? body.url.trim() : '';
    const brand = String(
      body.brand
        ?? body.answers?.[0]
        ?? '',
    ).trim();

    if (pastedUrl) {
      const fromUrl = await mediaFromLogoUrl({ url: pastedUrl, brand: brand || undefined, domain: body.domain });
      if (!fromUrl) {
        res.status(422).json({
          error: 'Could not load image from that URL',
          matched: false,
          needsHostReview: true,
        });
        return;
      }
      res.json({
        matched: true,
        media: fromUrl.media,
        source: fromUrl.source,
        needsHostReview: false,
      });
      return;
    }

    if (!brand) {
      res.status(400).json({ error: 'brand (or answers[0]) required', matched: false });
      return;
    }

    const resolved = await resolveBrandLogo({
      brand,
      domain: typeof body.domain === 'string' ? body.domain : undefined,
    });
    if (!resolved) {
      res.status(422).json({
        error: `No logo found for “${brand}” — paste a URL or try another brand`,
        matched: false,
        needsHostReview: true,
        brand,
      });
      return;
    }

    res.json({
      matched: true,
      media: resolved.media,
      source: resolved.source,
      wikidataId: resolved.wikidataId,
      needsHostReview: resolved.source !== 'wikidata',
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Logo resolve failed',
      matched: false,
      needsHostReview: true,
    });
  }
});

export default router;
