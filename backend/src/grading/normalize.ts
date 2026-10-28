/** Text normalization for intelligent answer matching. */

const ARTICLE_RE = /^(the|a|an)\s+/i;

export interface NormalizeOptions {
  stripArticles?: boolean;
  stripDiacritics?: boolean;
}

export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/\p{M}/gu, '');
}

export function normalizeAnswer(raw: string, opts: NormalizeOptions = {}): string {
  const { stripArticles = true, stripDiacritics: removeMarks = true } = opts;
  let s = (raw ?? '').trim().toLowerCase();
  if (removeMarks) s = stripDiacritics(s);
  // Unify curly quotes / apostrophes
  s = s.replace(/[\u2018\u2019\u201A\u2032]/g, "'");
  s = s.replace(/[\u201C\u201D\u201E\u2033]/g, '"');
  // Drop most punctuation except internal apostrophes in words
  s = s.replace(/[^\p{L}\p{N}\s']/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (stripArticles) s = s.replace(ARTICLE_RE, '');
  return s;
}

export function tokenize(normalized: string): string[] {
  return normalized.split(/\s+/).filter(Boolean);
}
