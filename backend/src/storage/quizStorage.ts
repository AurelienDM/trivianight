import fs from 'fs/promises';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import type { QuestionSource, Quiz, Round } from '../types.js';
import { isQuestionSource } from '../shared/types.js';
import { normalizeQuestion, normalizeQuizQuestions } from '../shared/questionNormalize.js';

const DATA_DIR = process.env.DATA_DIR ?? './data';
const QUIZZES_DIR = path.join(DATA_DIR, 'quizzes');

async function ensureDir() {
  await fs.mkdir(QUIZZES_DIR, { recursive: true });
}

export function clampRoundCount(value: unknown, fallback = 8): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 20) return fallback;
  return n;
}

export function clampQuestionsPerRound(value: unknown, fallback = 8): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 16) return fallback;
  return n;
}

export function clampPlayerCount(value: unknown, fallback = 6): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 99) return fallback;
  return n;
}

function emptyRound(title: string, questionCount = 8): Round {
  const count = clampQuestionsPerRound(questionCount, 8);
  return {
    id: uuidv4(),
    title,
    questions: Array.from({ length: count }, (_, i) => ({
      id: uuidv4(),
      type: 'open' as const,
      prompt: `Question ${i + 1}`,
      points: 1,
      acceptedAnswers: [],
    })),
  };
}

export async function listQuizzes(): Promise<
  {
    id: string;
    name: string;
    description?: string;
    roundCount: number;
    questionCount: number;
    playerCount?: number;
    questionSource?: QuestionSource;
    createdAt: string;
    updatedAt: string;
  }[]
> {
  await ensureDir();
  const files = await fs.readdir(QUIZZES_DIR).catch(() => [] as string[]);
  const quizzes = [];
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(path.join(QUIZZES_DIR, file), 'utf-8');
      const quiz = JSON.parse(raw) as Quiz;
      const questionCount = quiz.rounds.reduce((n, r) => n + r.questions.length, 0);
      quizzes.push({
        id: quiz.id,
        name: quiz.name,
        description: quiz.description,
        roundCount: quiz.rounds.length,
        questionCount,
        playerCount: quiz.settings?.playerCount,
        questionSource: quiz.settings?.questionSource,
        createdAt: quiz.createdAt,
        updatedAt: quiz.updatedAt,
      });
    } catch {
      /* skip bad files */
    }
  }
  return quizzes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getQuiz(id: string): Promise<Quiz | null> {
  await ensureDir();
  try {
    const raw = await fs.readFile(path.join(QUIZZES_DIR, `${id}.json`), 'utf-8');
    return normalizeQuizQuestions(JSON.parse(raw) as Quiz);
  } catch {
    return null;
  }
}

/** Fill missing ids / defaults so ChatGPT-style JSON imports cleanly. */
export function normalizeImportedQuiz(data: Partial<Quiz>): Partial<Quiz> {
  const rounds = (data.rounds ?? []).map((r, ri) => ({
    ...r,
    id: r.id || uuidv4(),
    title: r.title || `Round ${ri + 1}`,
    questions: (r.questions ?? []).map((q, qi) =>
      normalizeQuestion({
        ...q,
        id: q.id || uuidv4(),
        type: q.type || 'open',
        prompt: q.prompt || `Question ${qi + 1}`,
        points: typeof q.points === 'number' ? q.points : 1,
        acceptedAnswers: Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers : [],
      }),
    ),
  }));
  return { ...data, rounds };
}

export async function createQuiz(data: Partial<Quiz> & {
  roundCount?: number;
  questionsPerRound?: number;
}): Promise<Quiz> {
  await ensureDir();
  const now = new Date().toISOString();
  const normalized = normalizeImportedQuiz(data);
  const questionsPerRound = clampQuestionsPerRound(
    data.questionsPerRound ?? data.settings?.questionsPerRound,
    8,
  );
  const roundCount = clampRoundCount(data.roundCount, 8);
  const source = isQuestionSource(data.settings?.questionSource) ? data.settings.questionSource : undefined;
  const playerCount = data.settings?.playerCount != null
    ? clampPlayerCount(data.settings.playerCount, 6)
    : undefined;
  const quiz: Quiz = {
    id: data.id && typeof data.id === 'string' && !data.id.includes(' ') ? data.id : uuidv4(),
    name: normalized.name ?? 'New Quiz',
    description: normalized.description,
    rounds: normalized.rounds?.length
      ? (normalized.rounds as Quiz['rounds'])
      : Array.from({ length: roundCount }, (_, i) => emptyRound(`Round ${i + 1}`, questionsPerRound)),
    settings: {
      allowMultipleChoice: true,
      themeId: 'modern',
      defaultPoints: 1,
      ...normalized.settings,
      ...(playerCount != null ? { playerCount } : {}),
      questionsPerRound,
      ...(source ? { questionSource: source } : {}),
    },
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(path.join(QUIZZES_DIR, `${quiz.id}.json`), JSON.stringify(quiz, null, 2));
  return quiz;
}

export async function updateQuiz(id: string, data: Partial<Quiz>): Promise<Quiz | null> {
  const existing = await getQuiz(id);
  if (!existing) return null;
  const updated: Quiz = {
    ...existing,
    ...data,
    id,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(QUIZZES_DIR, `${id}.json`), JSON.stringify(updated, null, 2));
  return updated;
}

export async function deleteQuiz(id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(QUIZZES_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

export async function saveQuizFile(quiz: Quiz): Promise<void> {
  await ensureDir();
  await fs.writeFile(path.join(QUIZZES_DIR, `${quiz.id}.json`), JSON.stringify(quiz, null, 2));
}
