/** Shared LLM rate-limit queue (Mistral + Anthropic). */

/** Max concurrent upstream calls */
const MAX_IN_FLIGHT = 1;
/** Minimum gap between completed/started calls */
const MIN_SPACING_MS = 2000;
/** Rolling window limits */
const MAX_PER_MINUTE = 6;
const MAX_PER_DAY = 120;
/** Reject when waiting queue is already this deep (no tight retries) */
const MAX_QUEUE_DEPTH = 4;
/** Default cooldown after HTTP 429 when Retry-After missing */
export const DEFAULT_429_COOLDOWN_MS = 60_000;
/** Grade suggestion cache TTL */
const GRADE_CACHE_TTL_MS = 15 * 60_000;

export type LlmPurpose = 'grade' | 'author' | 'validate' | 'models';

export class LlmRateLimitError extends Error {
  readonly code = 'rate_limited' as const;
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'LlmRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** @deprecated alias — prefer LlmRateLimitError */
export class MistralRateLimitError extends LlmRateLimitError {
  constructor(message: string, retryAfterMs?: number) {
    super(message, retryAfterMs);
    this.name = 'MistralRateLimitError';
  }
}

interface QueueJob<T> {
  purpose: LlmPurpose;
  provider: string;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  enqueuedAt: number;
}

const queue: QueueJob<unknown>[] = [];
let inFlight = 0;
let lastStartMs = 0;
let cooldownUntilMs = 0;
const minuteTimestamps: number[] = [];
const dayTimestamps: number[] = [];
let pumpTimer: ReturnType<typeof setTimeout> | null = null;

interface GradeCacheEntry {
  expiresAt: number;
  value: unknown;
}
const gradeCache = new Map<string, GradeCacheEntry>();

function pruneWindows(now: number) {
  while (minuteTimestamps.length && now - minuteTimestamps[0]! >= 60_000) minuteTimestamps.shift();
  while (dayTimestamps.length && now - dayTimestamps[0]! >= 86_400_000) dayTimestamps.shift();
}

function schedulePump(delayMs: number) {
  if (pumpTimer) return;
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    void pump();
  }, Math.max(0, delayMs));
}

async function pump(): Promise<void> {
  if (inFlight >= MAX_IN_FLIGHT) return;
  if (!queue.length) return;

  const now = Date.now();
  pruneWindows(now);

  if (now < cooldownUntilMs) {
    schedulePump(cooldownUntilMs - now);
    return;
  }
  if (minuteTimestamps.length >= MAX_PER_MINUTE) {
    const wait = 60_000 - (now - minuteTimestamps[0]!);
    schedulePump(wait);
    return;
  }
  if (dayTimestamps.length >= MAX_PER_DAY) {
    const err = new LlmRateLimitError('AI daily local budget reached (120/day)');
    while (queue.length) {
      const job = queue.shift()!;
      job.reject(err);
    }
    return;
  }
  const sinceLast = now - lastStartMs;
  if (lastStartMs && sinceLast < MIN_SPACING_MS) {
    schedulePump(MIN_SPACING_MS - sinceLast);
    return;
  }

  const job = queue.shift()!;
  inFlight += 1;
  lastStartMs = Date.now();
  minuteTimestamps.push(lastStartMs);
  dayTimestamps.push(lastStartMs);

  try {
    const result = await job.run();
    console.log(
      `[llm] done provider=${job.provider} purpose=${job.purpose} waitedMs=${Date.now() - job.enqueuedAt}`,
    );
    job.resolve(result);
  } catch (err) {
    job.reject(err);
  } finally {
    inFlight -= 1;
    if (queue.length) schedulePump(MIN_SPACING_MS);
  }
}

export function enqueueLlm<T>(
  purpose: LlmPurpose,
  provider: string,
  run: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  pruneWindows(now);

  if (dayTimestamps.length >= MAX_PER_DAY && inFlight === 0 && !queue.length) {
    return Promise.reject(new LlmRateLimitError('AI daily local budget reached (120/day)'));
  }
  if (queue.length >= MAX_QUEUE_DEPTH) {
    return Promise.reject(
      new LlmRateLimitError('AI queue full — wait a few seconds (no automatic retry)'),
    );
  }
  if (now < cooldownUntilMs && queue.length === 0 && inFlight === 0) {
    console.log(
      `[llm] enqueue provider=${provider} purpose=${purpose} (cooldown ${cooldownUntilMs - now}ms)`,
    );
  } else {
    console.log(`[llm] enqueue provider=${provider} purpose=${purpose} depth=${queue.length + 1}`);
  }

  return new Promise<T>((resolve, reject) => {
    queue.push({
      purpose,
      provider,
      run: run as () => Promise<unknown>,
      resolve: resolve as (v: unknown) => void,
      reject,
      enqueuedAt: Date.now(),
    });
    void pump();
  });
}

export function apply429Cooldown(retryAfterMs: number): void {
  cooldownUntilMs = Date.now() + retryAfterMs;
}

export function parseRetryAfterMs(res: Response): number {
  const header = res.headers.get('retry-after');
  if (!header) return DEFAULT_429_COOLDOWN_MS;
  const asInt = Number(header);
  if (Number.isFinite(asInt) && asInt >= 0) return Math.min(300_000, asInt * 1000);
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.min(300_000, Math.max(0, when - Date.now()));
  return DEFAULT_429_COOLDOWN_MS;
}

export function getLlmUsage() {
  const now = Date.now();
  pruneWindows(now);
  return {
    inFlight,
    queueDepth: queue.length,
    callsMinute: minuteTimestamps.length,
    callsDay: dayTimestamps.length,
    limits: {
      maxInFlight: MAX_IN_FLIGHT,
      spacingMs: MIN_SPACING_MS,
      perMinute: MAX_PER_MINUTE,
      perDay: MAX_PER_DAY,
      queueDepth: MAX_QUEUE_DEPTH,
    },
    cooldownMsRemaining: Math.max(0, cooldownUntilMs - now),
    gradeCacheSize: gradeCache.size,
  };
}

/** @deprecated alias */
export const getMistralUsage = getLlmUsage;

export function gradeCacheKey(given: string, acceptedAnswers: string[]): string {
  return `${given.trim().toLowerCase()}||${acceptedAnswers.map((a) => a.trim().toLowerCase()).join('|')}`;
}

export function getCachedGradeSuggestion(key: string): unknown | null {
  const hit = gradeCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    gradeCache.delete(key);
    return null;
  }
  console.log(`[llm] cache hit purpose=grade keyChars=${key.length}`);
  return hit.value;
}

export function setCachedGradeSuggestion(key: string, value: unknown): void {
  gradeCache.set(key, { expiresAt: Date.now() + GRADE_CACHE_TTL_MS, value });
}

export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
