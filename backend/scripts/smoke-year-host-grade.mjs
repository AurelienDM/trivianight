/**
 * Smoke: year exact-only grading, host Correct/Wrong override, Deezer match-attach.
 * Expects backend on http://127.0.0.1:43128
 */
/**
 * Run with: npx --prefix backend tsx backend/scripts/smoke-year-host-grade.mjs
 */
import { io } from '../../frontend/node_modules/socket.io-client/build/esm/index.js';
import { gradeAnswer } from '../src/grading/grade.ts';

const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:43128';
const PASS = process.env.HOST_PASSCODE ?? '';

// --- unit: years ---
const yearQ = {
  acceptedAnswers: ['1969', '1969 (with or without Apollo 11)'],
  points: 1,
  type: 'open',
};
if (gradeAnswer('1969', yearQ).verdict !== 'correct') throw new Error('1969 should be correct');
if (gradeAnswer('1961', yearQ).verdict !== 'incorrect') throw new Error('1961 should be incorrect (not fuzzy)');
if (gradeAnswer('Apollo 11', yearQ).verdict === 'correct') {
  throw new Error('Apollo 11 alone must not grade correct for year');
}
console.log('1969 correct / 1961 incorrect');

function client() {
  return io(BACKEND, { transports: ['websocket'] });
}

function once(socket, event, timeout = 8000) {
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

const host = client();
await new Promise((r) => host.on('connect', () => r()));
host.emit('host:create', { quizId: 'sample-pub-quiz' });
const created = await once(host, 'host:created');
const roomCode = created.roomCode;
const pin = created.state.pin;

const team = client();
await new Promise((r) => team.on('connect', () => r()));
const join = await emitAck(team, 'team:join', {
  roomCode,
  name: 'GradeTeam',
  pin,
  color: '#E63946',
});
if (!join?.ok) throw new Error('join failed');
const filler = client();
await new Promise((r) => filler.on('connect', () => r()));
await emitAck(filler, 'team:join', { roomCode, name: 'Filler', pin, color: '#2A9D8F' });

host.emit('host:start', { roomCode });
await once(host, 'game:state');

const sheetP = once(team, 'team:sheet');
host.emit('host:show-question', { roomCode, questionIndex: 0 });
await sheetP;

const answers = Array(8).fill('');
answers[0] = 'WrongCapital';
await emitAck(team, 'team:submit', {
  answers,
  roomCode,
  teamId: join.team.id,
  token: join.token,
});

{
  const lockState = once(host, 'game:state');
  const lockSecrets = once(host, 'host:secrets');
  host.emit('host:lock', { roomCode });
  await Promise.all([lockState, lockSecrets]);
}

{
  const scoringState = once(host, 'game:state');
  const scoringSecrets = once(host, 'host:secrets');
  host.emit('host:open-scoring', { roomCode });
  await Promise.all([scoringState, scoringSecrets]);
}

{
  const secretsP = once(host, 'host:secrets');
  const stateP = once(host, 'game:state');
  host.emit('host:set-grade', {
    roomCode,
    teamId: join.team.id,
    questionIndex: 0,
    verdict: 'correct',
    pointsAwarded: 1,
  });
  const [secrets, state] = await Promise.all([secretsP, stateP]);
  const g0 = secrets.teams.find((t) => t.teamId === join.team.id)?.grades?.[0];
  if (g0?.verdict !== 'correct' || g0?.pointsAwarded !== 1) {
    throw new Error(`host Correct override failed: ${JSON.stringify(g0)}`);
  }
  const score = state.teams.find((t) => t.id === join.team.id)?.score;
  if (score !== 1) throw new Error(`expected team score 1 after Correct, got ${score}`);
  console.log('host Correct override → score 1');
}

{
  const secretsP = once(host, 'host:secrets');
  const stateP = once(host, 'game:state');
  host.emit('host:set-grade', {
    roomCode,
    teamId: join.team.id,
    questionIndex: 0,
    verdict: 'incorrect',
    pointsAwarded: 0,
  });
  const [secrets, state] = await Promise.all([secretsP, stateP]);
  const g1 = secrets.teams.find((t) => t.teamId === join.team.id)?.grades?.[0];
  if (g1?.verdict !== 'incorrect' || g1?.pointsAwarded !== 0) {
    throw new Error(`host Wrong override failed: ${JSON.stringify(g1)}`);
  }
  const score = state.teams.find((t) => t.id === join.team.id)?.score;
  if (score !== 0) throw new Error(`expected team score 0 after Wrong, got ${score}`);
  console.log('host Wrong → 0');
}

const headers = {
  'Content-Type': 'application/json',
  ...(PASS ? { 'x-host-passcode': PASS } : {}),
};
{
  const match = await fetch(`${BACKEND}/api/deezer/match-attach`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      query: 'Bohemian Rhapsody Queen',
    }),
  });
  const matchBody = await match.json();
  if (match.status === 401) {
    console.log('Deezer match-attach skipped (host passcode required)');
  } else if (!match.ok || !matchBody.matched) {
    throw new Error(`match-attach failed: ${match.status} ${JSON.stringify(matchBody)}`);
  } else {
    const label = matchBody.track?.label || `${matchBody.media?.title} — ${matchBody.media?.artist}`;
    console.log(`Deezer match-attach track: ${label} (${matchBody.score}) mode=${matchBody.mode}`);
    if (matchBody.score < 1.5) throw new Error(`expected strong score ≥1.5, got ${matchBody.score}`);
    if (!matchBody.media?.previewUrl) throw new Error('match-attach missing preview');
  }
}

{
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
    console.log('Deezer album match-attach skipped (host passcode required)');
  } else if (!match.ok || !matchBody.matched) {
    throw new Error(`album match-attach failed: ${match.status} ${JSON.stringify(matchBody)}`);
  } else {
    const label = matchBody.track?.label || '';
    console.log(`Deezer album attach: ${label} (${matchBody.score}) mode=${matchBody.mode}`);
    if (matchBody.mode !== 'album') throw new Error(`expected mode album, got ${matchBody.mode}`);
    if (matchBody.score < 1.5) throw new Error(`expected album score ≥1.5, got ${matchBody.score}`);
    if (!/Pink Floyd/i.test(label) || !/Dark Side of the Moon/i.test(label)) {
      throw new Error(`expected Pink Floyd + Dark Side in label, got ${label}`);
    }
    if (!matchBody.media?.previewUrl) throw new Error('album match-attach missing preview');
    // Prefer Money when Deezer ranks it; accept any album track with preview
    if (/Money/i.test(label)) console.log('album track: Money (preferred)');
    else console.log(`album track: ${matchBody.track?.name} (any preview from album OK)`);
  }
}

host.close();
team.close();
filler.close();
console.log('SMOKE_OK');
process.exit(0);
