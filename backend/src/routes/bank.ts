import { Router } from 'express';
import { requireHostPasscode } from '../middleware/requireHostPasscode.js';
import {
  addManyToBank,
  deleteBankItem,
  getBankItem,
  bankLibraryCounts,
  listBank,
  questionBankPath,
  recordBankUsage,
  updateBankItem,
} from '../storage/questionBank.js';
import { attachMediaForBankItem } from '../services/bankMediaAttach.js';
import path from 'path';

const router = Router();

/** Increment useCount when Editor adds bank items into a quiz (not on generate). */
router.post('/record-usage', requireHostPasscode, async (req, res) => {
  const body = req.body as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!ids.length) {
    res.status(400).json({ error: 'ids[] required' });
    return;
  }
  const result = await recordBankUsage(ids);
  res.json(result);
});

router.get('/', requireHostPasscode, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const theme = typeof req.query.theme === 'string' ? req.query.theme : undefined;
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const offset = req.query.offset ? Number(req.query.offset) : undefined;
  const result = await listBank({ q, theme, type, limit, offset });
  const counts = await bankLibraryCounts();
  res.json({
    items: result.items,
    total: result.total,
    librarySize: counts.librarySize,
    unused: counts.unused,
    themes: result.themes,
    path: result.path.replace(/\\/g, '/'),
  });
});

router.post('/', requireHostPasscode, async (req, res) => {
  type BankIn = {
    prompt?: string;
    type?: string;
    acceptedAnswers?: string[];
    correctAnswer?: string;
    points?: number;
    choices?: string[];
    notes?: string;
    mediaSearchTerms?: string[];
    media?: unknown;
    source?: string;
    theme?: string;
    roundTitle?: string;
    category?: string;
  };
  const body = req.body as BankIn & { items?: BankIn[]; roundTitle?: string; category?: string };
  const items: BankIn[] = Array.isArray(body.items)
    ? body.items
    : body.prompt
      ? [body]
      : [];
  if (!items.length) {
    res.status(400).json({ error: 'items[] or prompt required' });
    return;
  }
  const sharedRound = body.roundTitle ? String(body.roundTitle) : undefined;
  const sharedCategory = body.category ? String(body.category) : undefined;
  const result = await addManyToBank(
    items.map((i) => ({
      prompt: String(i.prompt ?? ''),
      type: i.type ? String(i.type) : 'open',
      acceptedAnswers: Array.isArray(i.acceptedAnswers)
        ? i.acceptedAnswers.map(String)
        : undefined,
      correctAnswer: i.correctAnswer ? String(i.correctAnswer) : undefined,
      points: typeof i.points === 'number' ? i.points : undefined,
      choices: Array.isArray(i.choices) ? i.choices.map(String) : undefined,
      notes: i.notes ? String(i.notes) : undefined,
      mediaSearchTerms: Array.isArray(i.mediaSearchTerms)
        ? i.mediaSearchTerms.map(String)
        : undefined,
      media: i.media && typeof i.media === 'object' ? i.media as never : undefined,
      source: i.source ? String(i.source) : 'manual',
      theme: i.theme ? String(i.theme) : undefined,
      roundTitle: i.roundTitle ? String(i.roundTitle) : sharedRound,
      category: i.category ? String(i.category) : sharedCategory,
    })),
  );
  res.json({
    ...result,
    path: path.relative(process.cwd(), questionBankPath()).replace(/\\/g, '/') || 'data/question-bank.json',
  });
});

/** Repair older bank items missing logo/Deezer media. */
router.post('/:id/attach-media', requireHostPasscode, async (req, res) => {
  const item = await getBankItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (item.media?.url || item.media?.deezerTrackId || item.media?.previewUrl) {
    res.json({ attached: true, item, alreadyHadMedia: true });
    return;
  }
  const attach = await attachMediaForBankItem({
    type: item.type,
    prompt: item.prompt,
    acceptedAnswers: item.acceptedAnswers,
    correctAnswer: item.acceptedAnswers[0],
    mediaSearchTerms: item.mediaSearchTerms,
    notes: item.notes,
  });
  if (!attach.attached || !attach.media) {
    res.status(422).json({
      attached: false,
      error: 'Could not resolve media for this item',
      item,
    });
    return;
  }
  const updated = await updateBankItem(item.id, {
    media: attach.media,
    notes: attach.notes ?? item.notes,
  });
  res.json({ attached: true, item: updated });
});

router.delete('/:id', requireHostPasscode, async (req, res) => {
  const ok = await deleteBankItem(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).end();
});

router.get('/:id', requireHostPasscode, async (req, res) => {
  const item = await getBankItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(item);
});

export default router;
