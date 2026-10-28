/** Accept small JPEG/PNG/WebP data URLs for team selfies (~220KB cap). */

const MAX_AVATAR_CHARS = 220_000;
const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/i;

export function sanitizeAvatarUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  if (s.length > MAX_AVATAR_CHARS) return undefined;
  if (!DATA_URL_RE.test(s)) return undefined;
  // Collapse whitespace inside base64 payload
  const comma = s.indexOf(',');
  if (comma < 0) return undefined;
  const header = s.slice(0, comma).toLowerCase().replace('image/jpg', 'image/jpeg');
  const b64 = s.slice(comma + 1).replace(/\s+/g, '');
  if (!b64.length) return undefined;
  return `${header},${b64}`;
}
