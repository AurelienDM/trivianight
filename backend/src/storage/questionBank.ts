import fs from 'fs/promises';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import type { MediaRef, QuestionType } from '../shared/types.js';
import { isDuplicateQuestion } from '../shared/questionNormalize.js';
import {
  BANK_THEME_IDS,
  BANK_THEME_LABELS,
  type BankThemeId,
  inferBankTheme,
  isBankThemeId,
} from '../shared/bankThemes.js';

export interface BankItem {
  id: string;
  prompt: string;
  type: QuestionType | string;
  acceptedAnswers: string[];
  points?: number;
  choices?: string[];
  notes?: string;
  mediaSearchTerms?: string[];
  media?: MediaRef;
  source?: string;
  /** Category theme for filtering (Music, Logos, …) */
  theme: BankThemeId;
  /**
   * Times this item was pulled into a quiz via Editor “Add from bank”.
   * Generating into the bank does not increment; hosting a room does not auto-increment.
   */
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

interface BankFile {
  items: BankItem[];
}

function dataDir() {
  return process.env.DATA_DIR ?? './data';
}

export function questionBankPath(): string {
  return path.join(dataDir(), 'question-bank.json');
}

function ensureTheme(item: Partial<BankItem> & { prompt?: string; type?: string }): BankThemeId {
  if (item.theme && isBankThemeId(item.theme)) return item.theme;
  return inferBankTheme({
    type: item.type,
    prompt: item.prompt,
  });
}

function normalizeItem(i: Partial<BankItem> & { prompt?: string; type?: string }): BankItem {
  const now = new Date().toISOString();
  return {
    id: i.id || uuidv4(),
    prompt: String(i.prompt || ''),
    type: i.type || 'open',
    acceptedAnswers: Array.isArray(i.acceptedAnswers) ? i.acceptedAnswers.map(String) : [],
    points: i.points,
    choices: i.choices,
    notes: i.notes,
    mediaSearchTerms: i.mediaSearchTerms,
    media: i.media && typeof i.media === 'object' ? i.media : undefined,
    source: i.source,
    theme: ensureTheme(i),
    useCount: typeof i.useCount === 'number' && i.useCount > 0 ? Math.floor(i.useCount) : 0,
    createdAt: i.createdAt || now,
    updatedAt: i.updatedAt || now,
  };
}

async function readBank(): Promise<BankFile> {
  try {
    const raw = await fs.readFile(questionBankPath(), 'utf-8');
    const parsed = JSON.parse(raw) as BankFile;
    const items = (Array.isArray(parsed.items) ? parsed.items : []).map((i) => normalizeItem(i));
    return { items };
  } catch {
    return { items: [] };
  }
}

async function writeBank(bank: BankFile): Promise<void> {
  await fs.mkdir(path.dirname(questionBankPath()), { recursive: true });
  await fs.writeFile(questionBankPath(), JSON.stringify(bank, null, 2));
}

function bankDedupeRefs(items: BankItem[]) {
  return items.map((i) => ({
    prompt: i.prompt,
    acceptedAnswers: i.acceptedAnswers,
    correctAnswer: i.acceptedAnswers[0],
  }));
}

export async function listBank(opts?: {
  q?: string;
  theme?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  items: BankItem[];
  total: number;
  path: string;
  themes: Array<{ id: BankThemeId; label: string; count: number }>;
}> {
  const bank = await readBank();
  const q = (opts?.q || '').trim().toLowerCase();
  const themeFilter = opts?.theme && opts.theme !== 'all' && isBankThemeId(opts.theme)
    ? opts.theme
    : null;
  const typeFilter = (opts?.type || '').trim().toLowerCase();

  const themeCounts = Object.fromEntries(BANK_THEME_IDS.map((id) => [id, 0])) as Record<BankThemeId, number>;
  for (const i of bank.items) {
    const t = ensureTheme(i);
    themeCounts[t] = (themeCounts[t] ?? 0) + 1;
  }

  let items = [...bank.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (themeFilter) items = items.filter((i) => ensureTheme(i) === themeFilter);
  if (typeFilter && typeFilter !== 'any') {
    items = items.filter((i) => String(i.type).toLowerCase() === typeFilter);
  }
  if (q) {
    items = items.filter((i) => {
      const hay = `${i.prompt} ${i.acceptedAnswers.join(' ')} ${i.type} ${i.theme}`.toLowerCase();
      return hay.includes(q);
    });
  }
  const total = items.length;
  const offset = Math.max(0, opts?.offset ?? 0);
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));
  return {
    items: items.slice(offset, offset + limit),
    total,
    path: path.relative(process.cwd(), questionBankPath()) || 'data/question-bank.json',
    themes: BANK_THEME_IDS.map((id) => ({
      id,
      label: BANK_THEME_LABELS[id],
      count: themeCounts[id] ?? 0,
    })),
  };
}

export async function addManyToBank(
  entries: Array<{
    prompt: string;
    type?: string;
    acceptedAnswers?: string[];
    correctAnswer?: string;
    points?: number;
    choices?: string[];
    notes?: string;
    mediaSearchTerms?: string[];
    media?: MediaRef;
    source?: string;
    theme?: string;
    roundTitle?: string;
    category?: string;
  }>,
): Promise<{ added: number; skipped: number }> {
  const bank = await readBank();
  let added = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const e of entries) {
    const prompt = String(e.prompt || '').trim();
    const accepted = (e.acceptedAnswers?.length
      ? e.acceptedAnswers
      : e.correctAnswer
        ? [e.correctAnswer]
        : []
    ).map(String).map((s) => s.trim()).filter(Boolean);
    if (!prompt || !accepted.length) {
      skipped += 1;
      continue;
    }
    if (isDuplicateQuestion(
      { prompt, acceptedAnswers: accepted, correctAnswer: accepted[0] },
      bankDedupeRefs(bank.items),
    )) {
      skipped += 1;
      continue;
    }
    const theme = inferBankTheme({
      theme: e.theme,
      roundTitle: e.roundTitle,
      category: e.category,
      type: e.type,
      prompt,
    });
    bank.items.push({
      id: uuidv4(),
      prompt,
      type: e.type || 'open',
      acceptedAnswers: accepted,
      points: e.points && e.points > 0 ? e.points : 1,
      choices: e.choices,
      notes: e.notes,
      mediaSearchTerms: e.mediaSearchTerms,
      media: e.media,
      source: e.source || 'ai',
      theme,
      useCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    added += 1;
  }
  if (added) await writeBank(bank);
  return { added, skipped };
}

/** Patch fields on an existing bank item (e.g. media repair). */
export async function updateBankItem(
  id: string,
  patch: Partial<Pick<BankItem, 'media' | 'notes' | 'prompt' | 'acceptedAnswers' | 'points' | 'choices' | 'mediaSearchTerms'>>,
): Promise<BankItem | null> {
  const bank = await readBank();
  const item = bank.items.find((i) => i.id === id);
  if (!item) return null;
  if (patch.media !== undefined) item.media = patch.media;
  if (patch.notes !== undefined) item.notes = patch.notes;
  if (patch.prompt !== undefined) item.prompt = patch.prompt;
  if (patch.acceptedAnswers !== undefined) item.acceptedAnswers = patch.acceptedAnswers;
  if (patch.points !== undefined) item.points = patch.points;
  if (patch.choices !== undefined) item.choices = patch.choices;
  if (patch.mediaSearchTerms !== undefined) item.mediaSearchTerms = patch.mediaSearchTerms;
  item.updatedAt = new Date().toISOString();
  await writeBank(bank);
  return { ...item, theme: ensureTheme(item) };
}

/** Increment useCount when Editor pulls bank items into a quiz. */
export async function recordBankUsage(ids: string[]): Promise<{ updated: number }> {
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  if (!unique.length) return { updated: 0 };
  const bank = await readBank();
  const now = new Date().toISOString();
  let updated = 0;
  const want = new Set(unique);
  for (const item of bank.items) {
    if (!want.has(item.id)) continue;
    item.useCount = (item.useCount || 0) + 1;
    item.updatedAt = now;
    updated += 1;
  }
  if (updated) await writeBank(bank);
  return { updated };
}

export async function deleteBankItem(id: string): Promise<boolean> {
  const bank = await readBank();
  const next = bank.items.filter((i) => i.id !== id);
  if (next.length === bank.items.length) return false;
  await writeBank({ items: next });
  return true;
}

export interface BankLibraryCounts {
  librarySize: number;
  unused: number;
}

export async function bankLibraryCounts(): Promise<BankLibraryCounts> {
  const bank = await readBank();
  return {
    librarySize: bank.items.length,
    unused: bank.items.filter((i) => !(i.useCount > 0)).length,
  };
}

/**
 * Spread least-used questions across rounds, one preferred theme per round,
 * without reusing an item. Shorter rounds mean the bank ran out.
 */
export function assignBankItemsToRounds<T extends { id: string; theme: string; useCount: number; prompt: string }>(
  items: T[],
  roundCount: number,
  perRound: number,
): T[][] {
  const roundsN = Math.max(0, Math.floor(roundCount));
  const per = Math.max(0, Math.floor(perRound));
  const sorted = [...items].sort((a, b) => (a.useCount - b.useCount) || a.prompt.localeCompare(b.prompt));
  const byTheme = new Map<string, T[]>();
  for (const item of sorted) {
    const list = byTheme.get(item.theme) ?? [];
    list.push(item);
    byTheme.set(item.theme, list);
  }
  const themes = [...byTheme.keys()];
  const used = new Set<string>();
  const rounds: T[][] = [];
  const take = (round: T[], list: T[] | undefined) => {
    if (!list) return;
    for (const item of list) {
      if (round.length >= per) return;
      if (used.has(item.id)) continue;
      used.add(item.id);
      round.push(item);
    }
  };
  for (let r = 0; r < roundsN; r++) {
    const preferred = themes.length ? themes[r % themes.length]! : '';
    const round: T[] = [];
    take(round, byTheme.get(preferred));
    if (round.length < per) {
      for (const theme of themes) {
        if (theme === preferred) continue;
        take(round, byTheme.get(theme));
        if (round.length >= per) break;
      }
    }
    rounds.push(round);
  }
  return rounds;
}

export async function selectBankQuestionsForRounds(opts: {
  roundCount: number;
  perRound: number;
}): Promise<BankItem[][]> {
  const bank = await readBank();
  const items = bank.items.map((i) => ({ ...i, theme: ensureTheme(i) }));
  return assignBankItemsToRounds(items, opts.roundCount, opts.perRound);
}

export async function getBankItem(id: string): Promise<BankItem | null> {
  const bank = await readBank();
  const item = bank.items.find((i) => i.id === id);
  if (!item) return null;
  return { ...item, theme: ensureTheme(item) };
}
