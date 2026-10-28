import { Router } from 'express';
import { randomUUID as uuidv4 } from 'crypto';
import * as storage from '../storage/quizStorage.js';
import { requireHostPasscode } from '../middleware/requireHostPasscode.js';
import { closeRoomsForQuiz, findRoomsForQuiz } from '../socket/gameManager.js';
import { recordBankUsage, selectBankQuestionsForRounds, type BankItem } from '../storage/questionBank.js';
import { BANK_THEME_LABELS, type BankThemeId } from '../shared/bankThemes.js';
import type { Question, QuestionType, Quiz } from '../shared/types.js';

const router = Router();

const QUESTION_TYPES = new Set<QuestionType>([
  'open', 'music', 'video', 'image', 'brand_logo', 'numeric', 'ordering', 'connections', 'multiple_choice',
]);

function bankItemToQuestion(item: BankItem): Question {
  const type = QUESTION_TYPES.has(item.type as QuestionType) ? item.type as QuestionType : 'open';
  return {
    id: uuidv4(),
    type,
    prompt: item.prompt,
    points: item.points && item.points > 0 ? item.points : 1,
    acceptedAnswers: item.acceptedAnswers.length ? item.acceptedAnswers : [''],
    choices: item.choices,
    media: item.media,
    notes: item.notes ? `${item.notes}\nFrom question bank` : 'From question bank',
    bankItemId: item.id,
  };
}

function uniqueTitle(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base} ${n}`)) n += 1;
  const title = `${base} ${n}`;
  used.add(title);
  return title;
}

async function fillFromBank(quiz: Quiz): Promise<Quiz> {
  const perRound = quiz.settings?.questionsPerRound
    ?? quiz.rounds[0]?.questions.length
    ?? 8;
  const picks = await selectBankQuestionsForRounds({
    roundCount: quiz.rounds.length,
    perRound,
  });
  const usedIds: string[] = [];
  const titles = new Set<string>();
  const rounds = quiz.rounds.map((round, i) => {
    const picked = picks[i] ?? [];
    const questions = round.questions.map((q, qi) => {
      const item = picked[qi];
      if (!item) return q;
      usedIds.push(item.id);
      return bankItemToQuestion(item);
    });
    const theme = picked[0]?.theme as BankThemeId | undefined;
    const label = theme && BANK_THEME_LABELS[theme] ? BANK_THEME_LABELS[theme] : round.title;
    return {
      ...round,
      title: picked.length ? uniqueTitle(label, titles) : round.title,
      theme: theme || round.theme,
      questions,
    };
  });
  if (usedIds.length) await recordBankUsage(usedIds);
  return (await storage.updateQuiz(quiz.id, { ...quiz, rounds })) ?? { ...quiz, rounds };
}

router.get('/', async (_req, res) => {
  const quizzes = await storage.listQuizzes();
  res.json(quizzes);
});

router.get('/:id', async (req, res) => {
  const quiz = await storage.getQuiz(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  res.json(quiz);
});

router.post('/', requireHostPasscode, async (req, res) => {
  const body = (req.body ?? {}) as { rounds?: unknown; settings?: { questionSource?: string } };
  let quiz = await storage.createQuiz(req.body);
  const source = quiz.settings?.questionSource;
  const clientSentRounds = Array.isArray(body.rounds) && body.rounds.length > 0;
  if (!clientSentRounds && (source === 'bank' || source === 'both')) {
    quiz = await fillFromBank(quiz);
  }
  res.status(201).json(quiz);
});

router.put('/:id', requireHostPasscode, async (req, res) => {
  const quiz = await storage.updateQuiz(req.params.id, req.body);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  res.json(quiz);
});

router.delete('/:id', requireHostPasscode, async (req, res) => {
  const id = req.params.id;
  const force = req.query.force === '1' || req.query.force === 'true';
  const rooms = findRoomsForQuiz(id);
  if (rooms.length && !force) {
    return res.status(409).json({
      error: 'Quiz is in use by active host rooms',
      rooms,
      hint: 'End those games first, or delete with ?force=1 to close rooms and remove the quiz.',
    });
  }
  if (rooms.length && force) {
    closeRoomsForQuiz(id);
  }
  const ok = await storage.deleteQuiz(id);
  if (!ok) return res.status(404).json({ error: 'Quiz not found' });
  res.json({ ok: true, closedRooms: force ? rooms : [] });
});

/** Import a full quiz JSON body (normalizes missing ids). */
router.post('/import', requireHostPasscode, async (req, res) => {
  const body = req.body;
  if (!body?.name || !Array.isArray(body?.rounds)) {
    return res.status(400).json({ error: 'Invalid quiz JSON — need name and rounds[]' });
  }
  // Always create a new id on import so fixtures are not overwritten
  const { id: _ignore, ...rest } = body;
  const quiz = await storage.createQuiz(rest);
  res.status(201).json(quiz);
});

export default router;
