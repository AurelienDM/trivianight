import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createReadStream, existsSync } from 'fs';
import type { Response } from 'express';

const UA = 'TriviaNight/1.0 (pub-quiz; logo-proxy; contact=host@localhost)';

const ALLOWED_HOSTS = new Set([
  'commons.wikimedia.org',
  'upload.wikimedia.org',
  'logo.clearbit.com',
  'www.google.com',
  'google.com',
  'icons.duckduckgo.com',
  'external-content.duckduckgo.com',
]);

function dataDir(): string {
  return process.env.DATA_DIR ?? './data';
}

function logosCacheDir(): string {
  return path.join(dataDir(), 'media', 'logos');
}

export function isRemoteLogoUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false;
  if (url.startsWith('/api/logos/img')) return false;
  if (url.startsWith('/media/')) return false;
  return /^https?:\/\//i.test(url.trim());
}

export function isAllowedLogoHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Rewrite remote logo URLs so TV/Host/phone load via same-origin proxy. */
export function toClientLogoUrl(url: string | undefined | null): string | undefined {
  if (!url?.trim()) return undefined;
  const trimmed = url.trim();
  if (trimmed.startsWith('/api/logos/img') || trimmed.startsWith('/media/')) return trimmed;
  if (!isRemoteLogoUrl(trimmed)) return trimmed;
  if (!isAllowedLogoHost(trimmed)) return trimmed;
  return `/api/logos/img?u=${encodeURIComponent(trimmed)}`;
}

function cacheKey(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 40);
}

function extFromContentType(ct: string | undefined, url: string): string {
  const lower = (ct || '').toLowerCase();
  if (lower.includes('svg')) return '.svg';
  if (lower.includes('png')) return '.png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return '.jpg';
  if (lower.includes('webp')) return '.webp';
  if (lower.includes('gif')) return '.gif';
  if (lower.includes('ico') || lower.includes('icon')) return '.ico';
  const pathPart = url.split('?')[0] || '';
  const m = pathPart.match(/\.(svg|png|jpe?g|webp|gif|ico)$/i);
  if (m) return `.${m[1]!.toLowerCase().replace('jpeg', 'jpg')}`;
  return '.bin';
}

function contentTypeFromExt(ext: string): string {
  switch (ext) {
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

async function findCached(key: string): Promise<{ filePath: string; ext: string } | null> {
  const dir = logosCacheDir();
  if (!existsSync(dir)) return null;
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const hit = entries.find((f) => f.startsWith(key));
  if (!hit) return null;
  return { filePath: path.join(dir, hit), ext: path.extname(hit) || '.bin' };
}

/**
 * Download a remote logo into data/media/logos/{slug}.ext and return a same-origin
 * /media/logos/… URL for durable bank/quiz storage.
 */
export async function cacheLogoLocally(
  remoteUrl: string,
  slug: string,
): Promise<string | null> {
  const url = remoteUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    if (url.startsWith('/media/')) return url;
    return null;
  }
  const safeSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'logo';

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!upstream.ok) return null;
    const ct = upstream.headers.get('content-type') || undefined;
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (!buf.length) return null;
    const ext = extFromContentType(ct, url);
    const dir = logosCacheDir();
    await fs.mkdir(dir, { recursive: true });
    const fileName = `${safeSlug}${ext}`;
    await fs.writeFile(path.join(dir, fileName), buf);
    return `/media/logos/${fileName}`;
  } catch {
    return null;
  }
}

/** Fetch allowlisted remote logo, cache under data/media/logos/, stream to res. */
export async function proxyLogoToResponse(rawUrl: string, res: Response): Promise<void> {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url) || !isAllowedLogoHost(url)) {
    res.status(400).json({ error: 'URL host not allowed' });
    return;
  }

  const key = cacheKey(url);
  const cached = await findCached(key);
  if (cached) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', contentTypeFromExt(cached.ext));
    createReadStream(cached.filePath).pipe(res);
    return;
  }

  const upstream = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!upstream.ok) {
    res.status(502).json({ error: `Upstream HTTP ${upstream.status}` });
    return;
  }
  const ct = upstream.headers.get('content-type') || undefined;
  const buf = Buffer.from(await upstream.arrayBuffer());
  if (!buf.length) {
    res.status(502).json({ error: 'Empty upstream body' });
    return;
  }

  const ext = extFromContentType(ct, url);
  const dir = logosCacheDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${key}${ext}`);
  await fs.writeFile(filePath, buf);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Type', ct && (ct.startsWith('image/') || ct.includes('svg'))
    ? ct.split(';')[0]!.trim()
    : contentTypeFromExt(ext));
  res.send(buf);
}
