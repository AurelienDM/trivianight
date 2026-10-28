/**
 * Smoke: host mid-round Deezer replace + spoiler-safe public media.
 * Run: npx --prefix backend tsx backend/scripts/smoke-host-media.mjs
 */
import { io } from '../../frontend/node_modules/socket.io-client/build/esm/index.js';
import fs from 'node:fs';
import path from 'node:path';

const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:43128';
const PASS = process.env.HOST_PASSCODE ?? '';

function client() {
  return io(BACKEND, { transports: ['websocket'] });
}

function once(socket, event, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + event)), timeout);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function emitAck(socket, event, payload, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ack timeout ' + event)), timeout);
    socket.timeout(timeout).emit(event, payload, (err, res) => {
      clearTimeout(t);
      if (err) reject(err);
      else resolve(res);
    });
  });
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const fullGenPath = path.join(root, 'frontend/src/components/editor/AiGenerateFullQuiz.tsx');
const hostReplacePath = path.join(root, 'frontend/src/components/host/HostMusicReplace.tsx');
if (!fs.existsSync(fullGenPath) || !fs.existsSync(hostReplacePath)) {
  throw new Error('missing AI full-quiz or HostMusicReplace component');
}
if (!/Generate full quiz/i.test(fs.readFileSync(fullGenPath, 'utf8'))) {
  throw new Error('UI missing Generate full quiz');
}
if (!/Search \/ Replace track/i.test(fs.readFileSync(hostReplacePath, 'utf8'))) {
  throw new Error('UI missing Search / Replace track');
}
console.log('UI_OK — bundle has “Generate full quiz” + “Search / Replace track”');

const headers = {
  'Content-Type': 'application/json',
  ...(PASS ? { 'x-host-passcode': PASS } : {}),
};

const match = await fetch(`${BACKEND}/api/deezer/match-attach`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    prompt: "Which band released the album 'The Dark Side of the Moon' in 1973?",
    answers: ['Pink Floyd'],
  }),
});
const matchBody = await match.json();
if (match.status === 401) {
  console.log('MATCH skipped (passcode)');
  process.exit(0);
}
if (!match.ok || !matchBody.matched) {
  throw new Error(`MATCH failed ${match.status} ${JSON.stringify(matchBody)}`);
}
const label = matchBody.track?.label || '';
if (!/Pink Floyd/i.test(label) || !/Dark Side/i.test(label)) {
  throw new Error(`unexpected match label: ${label}`);
}
console.log(`MATCH_OK — ${label}`);

const createdQuiz = await fetch(`${BACKEND}/api/quizzes`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    name: 'Smoke Host Media',
    rounds: [
      {
        id: 'smoke-r1',
        title: 'Music',
        questions: [
          {
            id: 'smoke-q1',
            type: 'music',
            prompt: "Which band released the album 'The Dark Side of the Moon' in 1973?",
            points: 1,
            acceptedAnswers: ['Pink Floyd'],
          },
          {
            id: 'smoke-q2',
            type: 'open',
            prompt: 'Filler',
            points: 1,
            acceptedAnswers: ['x'],
          },
        ],
      },
    ],
  }),
}).then((r) => r.json());
if (!createdQuiz?.id) throw new Error('failed to create smoke quiz ' + JSON.stringify(createdQuiz));
const quizId = createdQuiz.id;

try {
  const host = client();
  await new Promise((r) => host.on('connect', () => r()));
  const createdP = once(host, 'host:created');
  const createSecretsP = once(host, 'host:secrets');
  host.emit('host:create', { quizId });
  const created = await createdP;
  await createSecretsP;
  const roomCode = created.roomCode;
  const pin = created.state.pin;

  const team = client();
  await new Promise((r) => team.on('connect', () => r()));
  await emitAck(team, 'team:join', { roomCode, name: 'MediaA', pin, color: '#E63946' });
  const filler = client();
  await new Promise((r) => filler.on('connect', () => r()));
  await emitAck(filler, 'team:join', { roomCode, name: 'MediaB', pin, color: '#2A9D8F' });

  {
    const startState = once(host, 'game:state');
    const startSecrets = once(host, 'host:secrets');
    host.emit('host:start', { roomCode });
    await Promise.all([startState, startSecrets]);
  }

  {
    const showState = once(host, 'game:state');
    const showSecrets = once(host, 'host:secrets');
    host.emit('host:show-question', { roomCode, questionIndex: 0 });
    await Promise.all([showState, showSecrets]);
  }

  // Wait specifically for secrets that include attached media title
  const updateState = once(host, 'game:state');
  const updateSecrets = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout host:secrets with media')), 10000);
    function onSecrets(data) {
      if (data?.questions?.[0]?.media?.title) {
        clearTimeout(t);
        host.off('host:secrets', onSecrets);
        resolve(data);
      }
    }
    host.on('host:secrets', onSecrets);
  });
  host.emit('host:update-question-media', {
    roomCode,
    questionIndex: 0,
    media: matchBody.media,
    persist: true,
  });
  const [state, secrets] = await Promise.all([updateState, updateSecrets]);

  const pub = state.currentQuestion?.media;
  if (!pub?.previewUrl && !pub?.deezerTrackId) {
    throw new Error('public media missing preview after update');
  }
  if (pub.title || pub.artist || pub.album) {
    throw new Error(`title leak on public media: ${JSON.stringify(pub)}`);
  }
  const hostQ = secrets.questions[0];
  if (!hostQ?.media?.title) {
    throw new Error(`host secrets missing title: ${JSON.stringify(hostQ)}`);
  }
  console.log('SESSION_OK — preview live, no title leak; host secrets have title');

  const ai = await fetch(`${BACKEND}/api/ai/status`).then((r) => r.json());
  console.log(`AI_STATUS — authoringAvailable ${!!ai.authoringAvailable}`);

  host.close();
  team.close();
  filler.close();
} finally {
  await fetch(`${BACKEND}/api/quizzes/${quizId}?force=1`, { method: 'DELETE', headers });
}

console.log('SMOKE_OK — backend/scripts/smoke-host-media.mjs');
process.exit(0);
