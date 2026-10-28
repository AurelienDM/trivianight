/**
 * Smoke: numeric + MC scoring after lock; Deezer search.
 */
import { io } from '../../frontend/node_modules/socket.io-client/build/esm/index.js';

const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:43128';
const PASS = process.env.HOST_PASSCODE ?? '';

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
if (!jA?.ok || !jB?.ok) throw new Error('join failed');

host.emit('host:start', { roomCode });
await once(host, 'game:state');

// Show numeric Q5 and MC Q7
for (const idx of [5, 7]) {
  const p = once(alpha, 'team:sheet');
  host.emit('host:show-question', { roomCode, questionIndex: idx });
  await p;
}

const answersA = Array(8).fill('');
answersA[5] = '1912';
answersA[7] = 'Pacific';
const answersB = Array(8).fill('');
answersB[5] = '1911';
answersB[7] = 'Atlantic';

await emitAck(alpha, 'team:submit', {
  answers: answersA,
  roomCode,
  teamId: jA.team.id,
  token: jA.token,
});
await emitAck(beta, 'team:submit', {
  answers: answersB,
  roomCode,
  teamId: jB.team.id,
  token: jB.token,
});

const lockedP = once(host, 'game:state');
host.emit('host:lock', { roomCode });
const locked = await lockedP;
const a = locked.teams.find((t) => t.name === 'Alpha');
const b = locked.teams.find((t) => t.name === 'Beta');
if ((a?.score ?? -1) !== 2) throw new Error(`Alpha score expected 2, got ${a?.score}`);
if ((b?.score ?? -1) !== 0) throw new Error(`Beta score expected 0, got ${b?.score}`);
console.log('Alpha score 2, Beta 0 OK');

const headers = PASS ? { 'x-host-passcode': PASS } : {};
const search = await fetch(`${BACKEND}/api/deezer/search?q=${encodeURIComponent('Billie Jean')}`, { headers });
// search requires host passcode — may 401 without; still check status
const status = await fetch(`${BACKEND}/api/deezer/status`).then((r) => r.json());
if (!status.configured) throw new Error('deezer not ready');
console.log('deezer status OK', status);
if (search.ok) {
  const data = await search.json();
  const hit = (data.tracks || []).find((t) => t.hasPreview);
  if (!hit) throw new Error('Deezer search returned no preview tracks');
  console.log('deezer search OK', hit.name);
} else {
  console.log('deezer search skipped (auth)', search.status);
}

const quiz = await fetch(`${BACKEND}/api/quizzes/sample-pub-quiz`).then((r) => r.json());
const music = quiz.rounds.flatMap((r) => r.questions).filter((q) => q.type === 'music');
if (!music.every((q) => q.media?.kind === 'deezer' && q.media?.previewUrl)) {
  throw new Error('Sample music missing Deezer preview media');
}
console.log('sample Deezer media OK');

host.close();
alpha.close();
beta.close();
console.log('SMOKE_OK');
process.exit(0);
