/**
 * Smoke: phone answers survive sheet pushes, navigate flushes, reconnect + submit → score.
 * Expects backend on http://127.0.0.1:43128
 */
import { io } from '../../frontend/node_modules/socket.io-client/build/esm/index.js';

const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:43128';

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
const join = await emitAck(team, 'team:join', { roomCode, name: 'PhoneSave', pin, color: '#E63946' });
if (!join?.ok) throw new Error('join failed');
const { token, team: { id: teamId } } = join;

// Need a second team to start
const teamB = client();
await new Promise((r) => teamB.on('connect', () => r()));
await emitAck(teamB, 'team:join', { roomCode, name: 'Filler', pin, color: '#2A9D8F' });

const sheetStart = once(team, 'team:sheet');
host.emit('host:start', { roomCode });
await once(host, 'game:state');
await sheetStart;

async function show(idx) {
  const p = once(team, 'team:sheet');
  host.emit('host:show-question', { roomCode, questionIndex: idx });
  return p;
}

await show(0);

// Save Q1 Paris
let answers = Array(8).fill('');
answers[0] = 'Paris';
let save = await emitAck(team, 'team:update-answers', { answers, roomCode, teamId, token });
if (!save?.ok) throw new Error('save Q1 failed ' + JSON.stringify(save));
console.log('saved Q1', answers[0]);

// Host advances → sheet push must not wipe Q1 if client re-saves (server keeps prior)
const sheetPush = once(team, 'team:sheet');
host.emit('host:show-question', { roomCode, questionIndex: 1 });
const afterPush = await sheetPush;
if ((afterPush.answers?.[0] ?? '') !== 'Paris') {
  throw new Error(`Q1 wiped by sheet push: ${JSON.stringify(afterPush.answers)}`);
}
console.log('Q1 survived sheet push', afterPush.answers[0]);

// Show numeric + MC
await show(5);
await show(7);

answers = [...(afterPush.answers ?? Array(8).fill(''))];
answers[0] = 'Paris';
answers[5] = '1912';
answers[7] = 'Pacific';
save = await emitAck(team, 'team:update-answers', { answers, roomCode, teamId, token });
if (!save?.ok) throw new Error('save trio failed');

// Simulate reconnect: new socket + rejoin, then read sheet
team.disconnect();
const team2 = client();
await new Promise((r) => team2.on('connect', () => r()));
const sheetAfterRejoin = once(team2, 'team:sheet');
const rejoin = await emitAck(team2, 'team:rejoin', { roomCode, teamId, token });
if (!rejoin?.ok) throw new Error('rejoin failed ' + JSON.stringify(rejoin));
const restored = await sheetAfterRejoin;
const a0 = restored.answers?.[0];
const a5 = restored.answers?.[5];
const a7 = restored.answers?.[7];
console.log('reconnect restored', [a0, a5, a7]);
if (a0 !== 'Paris' || a5 !== '1912' || a7 !== 'Pacific') {
  throw new Error('reconnect lost answers: ' + JSON.stringify(restored.answers));
}

// Submit full sheet (fail-closed path)
const stateAfterSubmit = once(host, 'game:state');
const submit = await emitAck(team2, 'team:submit', {
  answers: restored.answers,
  roomCode,
  teamId,
  token,
});
if (!submit?.ok) throw new Error('submit failed ' + JSON.stringify(submit));
await stateAfterSubmit;

const lockedP = once(host, 'game:state');
const secretsP = once(host, 'host:secrets');
host.emit('host:lock', { roomCode });
const locked = await lockedP;
await secretsP.catch(() => null);

const phone = locked.teams.find((t) => t.name === 'PhoneSave');
const score = phone?.score ?? 0;
if (score < 3) throw new Error(`lock score expected ≥3, got ${score}`);

// Peek grades via open scoring secrets if available
host.emit('host:open-scoring', { roomCode });
const secrets = await once(host, 'host:secrets').catch(() => null);
const row = secrets?.teams?.find((t) => t.name === 'PhoneSave');
const grades = row?.grades ?? [];
const correct = [0, 5, 7].map((i) => grades[i]?.verdict).filter((v) => v === 'correct').length;
console.log(`lock score ${score}  grades correct:${grades[0]?.verdict === 'correct' ? 1 : 0} … correct:${grades[5]?.verdict === 'correct' ? 1 : 0} … correct:${grades[7]?.verdict === 'correct' ? 1 : 0}`);
if (correct < 3 && score < 3) throw new Error('expected 3 correct grades');

host.close();
teamB.close();
team2.close();
console.log('SMOKE_OK');
process.exit(0);
