import type { MediaRef } from '../shared/types.js';

const UA = 'TriviaNight/1.0 (pub-quiz; logo-resolve; contact=host@localhost)';

export type LogoSource = 'wikidata' | 'clearbit' | 'google' | 'duckduckgo' | 'url';

export function slugBrand(brand: string): string {
  return brand
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function hostnameFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function commonsFileUrl(filename: string): string {
  const cleaned = filename.replace(/^File:/i, '').trim();
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(cleaned)}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** HEAD/GET check that URL looks like an image (incl. SVG). */
export async function probeImageUrl(url: string): Promise<{ ok: boolean; contentType?: string }> {
  try {
    const head = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    if (head.ok) {
      const ct = head.headers.get('content-type') || undefined;
      if (!ct || ct.startsWith('image/') || ct.includes('svg')) {
        return { ok: true, contentType: ct };
      }
    }
  } catch {
    /* try GET */
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false };
    const ct = res.headers.get('content-type') || undefined;
    // Drain a bit so we don't leave sockets hanging; discard body
    await res.arrayBuffer().catch(() => undefined);
    if (!ct || ct.startsWith('image/') || ct.includes('svg') || ct.includes('octet-stream')) {
      return { ok: true, contentType: ct };
    }
    return { ok: false, contentType: ct };
  } catch {
    return { ok: false };
  }
}

interface WikidataHit {
  id: string;
  label: string;
  description?: string;
}

async function wikidataSearch(brand: string): Promise<WikidataHit | null> {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(brand)}`
    + `&language=en&limit=5&format=json&origin=*`;
  const data = await fetchJson<{
    search?: Array<{ id?: string; label?: string; description?: string }>;
  }>(url);
  const hits = (data.search ?? [])
    .map((h) => ({
      id: String(h.id ?? '').trim(),
      label: String(h.label ?? '').trim(),
      description: h.description ? String(h.description) : undefined,
    }))
    .filter((h) => h.id && h.label);
  if (!hits.length) return null;
  // Prefer company/brand-ish descriptions
  const preferred = hits.find((h) =>
    /brand|company|corporation|business|retailer|manufacturer|restaurant|airline|bank/i.test(
      h.description ?? '',
    ),
  );
  return preferred ?? hits[0]!;
}

async function wikidataLogoAndSite(entityId: string): Promise<{
  logoFile?: string;
  website?: string;
}> {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(entityId)}`
    + `&props=claims&format=json&origin=*`;
  const data = await fetchJson<{
    entities?: Record<string, {
      claims?: {
        P154?: Array<{ mainsnak?: { datavalue?: { value?: string } } }>;
        P856?: Array<{ mainsnak?: { datavalue?: { value?: string } } }>;
      };
    }>;
  }>(url);
  const claims = data.entities?.[entityId]?.claims;
  const logoFile = claims?.P154?.[0]?.mainsnak?.datavalue?.value;
  const website = claims?.P856?.[0]?.mainsnak?.datavalue?.value;
  return {
    logoFile: typeof logoFile === 'string' ? logoFile : undefined,
    website: typeof website === 'string' ? website : undefined,
  };
}

function fallbackIconUrls(domain: string): Array<{ source: LogoSource; url: string }> {
  const d = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return [
    { source: 'clearbit', url: `https://logo.clearbit.com/${d}` },
    { source: 'google', url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=256` },
    { source: 'duckduckgo', url: `https://icons.duckduckgo.com/ip3/${d}.ico` },
  ];
}

function toMedia(opts: {
  url: string;
  brand: string;
  domain?: string;
  brandKey?: string;
}): MediaRef {
  return {
    kind: 'image',
    url: opts.url,
    title: opts.brand.trim(),
    domain: opts.domain,
    brandKey: opts.brandKey || slugBrand(opts.brand),
  };
}

/**
 * Resolve a brand name to a logo image URL.
 * Prefer Wikidata P154 → Wikimedia Commons, then Clearbit / Google / DuckDuckGo icons.
 */
export async function resolveBrandLogo(input: {
  brand: string;
  domain?: string;
}): Promise<{ media: MediaRef; source: LogoSource; wikidataId?: string } | null> {
  const brand = input.brand.trim();
  if (!brand) return null;
  const brandKey = slugBrand(brand);
  let domain = input.domain?.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '') || undefined;
  let wikidataId: string | undefined;

  try {
    const hit = await wikidataSearch(brand);
    if (hit) {
      wikidataId = hit.id;
      const { logoFile, website } = await wikidataLogoAndSite(hit.id);
      if (!domain && website) domain = hostnameFromUrl(website);
      if (logoFile) {
        const url = commonsFileUrl(logoFile);
        const probe = await probeImageUrl(url);
        if (probe.ok) {
          return {
            media: toMedia({ url, brand, domain, brandKey }),
            source: 'wikidata',
            wikidataId,
          };
        }
      }
    }
  } catch (err) {
    console.warn('[logos] wikidata failed', err instanceof Error ? err.message : err);
  }

  // Weak domain guess if still missing
  if (!domain) {
    const guess = `${brandKey.replace(/-/g, '')}.com`;
    if (guess.length > 4) domain = guess;
  }

  if (domain) {
    for (const candidate of fallbackIconUrls(domain)) {
      try {
        const probe = await probeImageUrl(candidate.url);
        if (probe.ok) {
          return {
            media: toMedia({ url: candidate.url, brand, domain, brandKey }),
            source: candidate.source,
            wikidataId,
          };
        }
      } catch {
        /* next */
      }
    }
  }

  return null;
}

/** Validate a pasted logo URL and wrap as MediaRef. */
export async function mediaFromLogoUrl(opts: {
  url: string;
  brand?: string;
  domain?: string;
}): Promise<{ media: MediaRef; source: LogoSource } | null> {
  const url = opts.url.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const probe = await probeImageUrl(url);
  if (!probe.ok) return null;
  const brand = (opts.brand || 'Brand').trim();
  return {
    media: toMedia({
      url,
      brand,
      domain: opts.domain || hostnameFromUrl(url),
      brandKey: slugBrand(brand),
    }),
    source: 'url',
  };
}
