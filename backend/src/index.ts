import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { networkInterfaces } from 'os';
import { fileURLToPath } from 'url';
import quizzesRouter from './routes/quizzes.js';
import mediaRouter from './routes/media.js';
import settingsRouter from './routes/settings.js';
import coversRouter from './routes/covers.js';
import deezerRouter from './routes/deezer.js';
import logosRouter from './routes/logos.js';
import bankRouter from './routes/bank.js';
import aiRouter from './routes/ai.js';
import roomsRouter from './routes/rooms.js';
import { registerSocketHandlers } from './socket/socketHandler.js';
import { CONTENT_TYPE_BY_EXT } from './mediaTypes.js';
import { seedSampleQuiz } from './seed.js';
import { suggestGradeWithMistral, MistralRateLimitError } from './grading/mistral.js';
import { requireHostPasscode } from './middleware/requireHostPasscode.js';
import { getQuiz } from './storage/quizStorage.js';
import { gradeAnswer } from './grading/grade.js';
import { getSettings } from './storage/settingsStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 43128);
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, '../data');

// quizStorage / media routes read DATA_DIR from env — keep them aligned
process.env.DATA_DIR = DATA_DIR;

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const mediaPath = path.resolve(DATA_DIR, 'media');
app.use('/media', express.static(mediaPath, {
  index: false,
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream');
  },
}));

app.use('/api/quizzes', quizzesRouter);
app.use('/api/media', mediaRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/covers', coversRouter);
app.use('/api/deezer', deezerRouter);
app.use('/api/logos', logosRouter);
app.use('/api/bank', bankRouter);
app.use('/api/ai', aiRouter);
app.use('/api/rooms', roomsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'trivia-night', timestamp: new Date().toISOString() });
});

/** Optional Mistral assist — suggestion only; never auto-applied */
app.post('/api/grade/suggest', requireHostPasscode, async (req, res) => {
  const { quizId, roundIndex, questionIndex, given } = req.body as {
    quizId: string;
    roundIndex: number;
    questionIndex: number;
    given: string;
  };
  const quiz = await getQuiz(quizId);
  const q = quiz?.rounds[roundIndex]?.questions[questionIndex];
  if (!q) return res.status(404).json({ error: 'Question not found' });
  const settings = await getSettings();
  const deterministic = gradeAnswer(given, q, {
    spellingSlack: settings.spellingSlack,
    acceptIncompleteNames: settings.acceptIncompleteNames,
  });
  try {
    const suggestion = await suggestGradeWithMistral({
      given,
      acceptedAnswers: q.acceptedAnswers,
      prompt: q.prompt,
      deterministic,
    });
    res.json({ deterministic, suggestion });
  } catch (err) {
    if (err instanceof MistralRateLimitError) {
      return res.status(429).json({
        deterministic,
        suggestion: null,
        error: err.message,
        code: 'rate_limited',
        retryAfterMs: err.retryAfterMs,
      });
    }
    throw err;
  }
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: err.message });
});

registerSocketHandlers(io);

const publicPath = path.resolve(__dirname, '../public');
if (existsSync(publicPath)) {
  app.use(express.static(publicPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

await seedSampleQuiz(DATA_DIR);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n>> Trivia Night server running`);
  console.log(`   Local:   http://localhost:${PORT}`);
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`   Network: http://${iface.address}:${PORT}  <- share this on LAN`);
      }
    }
  }
  console.log(`   Data:    ${path.resolve(DATA_DIR)}\n`);
});
