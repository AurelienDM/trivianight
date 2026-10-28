import type { MediaRef } from '../shared/types.js';
import { resolveBrandLogo, slugBrand } from '../media/logos.js';
import { matchAttachDeezerTrack } from '../media/deezer.js';
import { cacheLogoLocally } from './logoProxy.js';

export interface BankMediaCandidate {
  type?: string;
  prompt?: string;
  acceptedAnswers?: string[];
  correctAnswer?: string;
  mediaSearchTerms?: string[];
  media?: MediaRef;
  notes?: string;
}

/**
 * Attach logo/Deezer media for a bank (or AI) item before persistence.
 * brand_logo → resolveBrandLogo + cacheLogoLocally; music → Deezer match-attach.
 */
export async function attachMediaForBankItem(
  item: BankMediaCandidate,
): Promise<{ media?: MediaRef; attached: boolean; notes?: string }> {
  const type = String(item.type || '').toLowerCase();
  if (item.media?.url || item.media?.deezerTrackId || item.media?.previewUrl) {
    return { media: item.media, attached: true, notes: item.notes };
  }

  if (type === 'brand_logo' || type === 'image') {
    const brand = String(
      item.correctAnswer
        || item.mediaSearchTerms?.[0]
        || item.acceptedAnswers?.[0]
        || '',
    ).trim();
    if (!brand) {
      return {
        attached: false,
        notes: [item.notes, 'Logo resolve failed — no brand name'].filter(Boolean).join('\n'),
      };
    }
    try {
      const resolved = await resolveBrandLogo({ brand });
      if (!resolved?.media?.url) {
        return {
          attached: false,
          notes: [item.notes, `Logo resolve failed for ${brand}`].filter(Boolean).join('\n'),
        };
      }
      const slug = resolved.media.brandKey || slugBrand(brand);
      const localUrl = await cacheLogoLocally(resolved.media.url, slug);
      const media: MediaRef = {
        ...resolved.media,
        url: localUrl || resolved.media.url,
      };
      return {
        media,
        attached: true,
        notes: [item.notes, `Logo attached (${resolved.source}): ${brand}`].filter(Boolean).join('\n'),
      };
    } catch (err) {
      console.warn('[bank-media] logo attach failed', err instanceof Error ? err.message : err);
      return {
        attached: false,
        notes: [item.notes, `Logo resolve failed for ${brand}`].filter(Boolean).join('\n'),
      };
    }
  }

  if (type === 'music') {
    const answers = [
      item.correctAnswer,
      ...(item.acceptedAnswers ?? []),
    ].filter(Boolean).map(String);
    const query = item.mediaSearchTerms?.[0] || answers[0] || undefined;
    if (!answers.length && !item.prompt?.trim()) {
      return { attached: false, notes: item.notes };
    }
    try {
      const result = await matchAttachDeezerTrack({
        query,
        prompt: item.prompt,
        answers,
      });
      if (!result.matched || !result.media) {
        return {
          attached: false,
          notes: [item.notes, result.error || 'Deezer match failed'].filter(Boolean).join('\n'),
        };
      }
      const label = `${result.media.title || '?'} — ${result.media.artist || '?'}`;
      return {
        media: result.media,
        attached: true,
        notes: [item.notes, `Deezer attached: ${label}`].filter(Boolean).join('\n'),
      };
    } catch (err) {
      console.warn('[bank-media] deezer attach failed', err instanceof Error ? err.message : err);
      return { attached: false, notes: item.notes };
    }
  }

  return { attached: false, notes: item.notes };
}
