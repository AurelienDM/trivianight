/**
 * Smoke: MC coercion + reveal per-team breakdown.
 * Run: node --import tsx backend/scripts/smoke-reveal-choices.mjs
 *   or: npx tsx backend/scripts/smoke-reveal-choices.mjs
 */
import { io } from '../../frontend/node_modules/socket.io-client/build/esm/index.js';

const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:43128';

// Inline normalize checks via dynamic import of compiled shared module through tsx
const { normalizeQuestion, normalizeChoices } = await import('../src/shared/questionNormalize.ts');

const coerced = normalizeQuestion({
  id: 'x',
  type: 'connections',
  prompt: 'Which of these animals is NOT a mammal?',
  points: 1,
  acceptedAnswers: ['Crocodile'],
  connectionClues: [],
  notes: 'choices: Dog | Whale | Platypus | Crocodile',
});
const joined = (coerced.choices || []).join(' | ');
if (coerced.type !== 'multiple_choice' || joined !== 'Dog | Whale | Platypus | Crocodile') {
  throw new Error('normalize failed: ' + coerced.type + ' ' + joined);
}
console.log('normalize OK', joined);

const quizRes = await fetch(`${BACKEND}/api/quizzes/8f160460-a1b2-4c3d-8e9f-0a1b2c3d4e5f`);
if (!quizRes.ok) throw new Error('mammal quiz missing — restart backend to re-seed');
const mammal = await quizRes.json();
const q0 = mammal.rounds[0].questions[0];
if (q0.type !== 'multiple_choice') throw new Error('quiz mammal not coerced to MC: ' + q0.type);
if ((normalizeChoices(q0.choices) || []).join(' | ') !== 'Dog | Whale | Platypus | Crocodile') {
  throw new Error('quiz mammal choices wrong: ' + (q0.choices || []).join(' | '));
}
console.log('quiz mammal MC →', q0.acceptedAnswers[0]);

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
const { roomCode } = created;
const pin = created.state.pin;

const alpha = client();
const beta = client();
await Promise.all([
  new Promise((r) => alpha.on('connect', () => r())),
  new Promise((r) => beta.on('connect', () => r())),
]);
const jA = await emitAck(alpha, 'team:join', { roomCode, name: 'Alpha', pin, color: '#E63946' });
const jB = await emitAck(beta, 'team:join', { roomCode, name: 'Beta', pin, color: '#2A9D8F' });

host.emit('host:start', { roomCode });
await once(host, 'game:state');

for (const idx of [0, 5]) {
  const p = once(alpha, 'team:sheet');
  host.emit('host:show-question', { roomCode, questionIndex: idx });
  await p;
}

const ansA = Array(8).fill('');
ansA[0] = 'Paris';
ansA[5] = '1912';
const ansB = Array(8).fill('');
ansB[0] = 'Lyon';
ansB[5] = '1912';

await emitAck(alpha, 'team:submit', { answers: ansA, roomCode, teamId: jA.team.id, token: jA.token });
await emitAck(beta, 'team:submit', { answers: ansB, roomCode, teamId: jB.team.id, token: jB.token });

const lockP = once(host, 'game:state');
host.emit('host:lock', { roomCode });
await lockP;

const revealP = once(host, 'game:state');
host.emit('host:begin-reveal', { roomCode });
const reveal1 = await revealP;
const rows1 = reveal1.revealTeamResults || [];
const a1 = rows1.find((r) => r.name === 'Alpha');
const b1 = rows1.find((r) => r.name === 'Beta');
if (!a1 || !b1) throw new Error('missing reveal rows: ' + JSON.stringify(rows1));
console.log(`reveal Q1: Alpha:${a1.answer}:+${a1.pointsAwarded}/r${a1.roundPointsSoFar}, Beta:${b1.answer}:+${b1.pointsAwarded}/r${b1.roundPointsSoFar}`);
if (a1.answer !== 'Paris' || a1.pointsAwarded !== 1 || a1.roundPointsSoFar !== 1) {
  throw new Error('Alpha Q1 reveal wrong ' + JSON.stringify(a1));
}
if (b1.answer !== 'Lyon' || b1.pointsAwarded !== 0 || b1.roundPointsSoFar !== 0) {
  throw new Error('Beta Q1 reveal wrong ' + JSON.stringify(b1));
}

let state = reveal1;
for (let i = 0; i < 5; i++) {
  const p = once(host, 'game:state');
  host.emit('host:reveal-next', { roomCode });
  state = await p;
}
const rows6 = state.revealTeamResults || [];
const a6 = rows6.find((r) => r.name === 'Alpha');
if (!a6) throw new Error('no Alpha at Q6');
if (a6.pointsAwarded !== 1 || a6.roundPointsSoFar !== 2) {
  throw new Error(`reveal Q6 numeric expected +1 / r2, got +${a6.pointsAwarded}/r${a6.roundPointsSoFar}`);
}
console.log(`reveal Q6 numeric: +${a6.pointsAwarded}, roundPointsSoFar ${a6.roundPointsSoFar}`);

host.close();
alpha.close();
beta.close();
console.log('SMOKE_OK');
process.exit(0);
