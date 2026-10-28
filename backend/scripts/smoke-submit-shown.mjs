/**
 * Smoke: submit-with-answers + host-shown questions + scoring + Deezer samples.
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

const teamA = client();
const teamB = client();
await Promise.all([
  new Promise((r) => teamA.on('connect', () => r())),
  new Promise((r) => teamB.on('connect', () => r())),
]);

const joinA = await emitAck(teamA, 'team:join', { roomCode, name: 'PhoneA', pin, color: '#E63946' });
const joinB = await emitAck(teamB, 'team:join', { roomCode, name: 'PhoneB', pin, color: '#2A9D8F' });
if (!joinA?.ok || !joinB?.ok) throw new Error('join failed');
const tokenA = joinA.token;
const teamIdA = joinA.team.id;

const sheetAfterStart = once(teamA, 'team:sheet');
host.emit('host:start', { roomCode });
await once(host, 'game:state');
const preSheet = await sheetAfterStart;
if ((preSheet.shownQuestionIndexes ?? []).length !== 0 || (preSheet.questions ?? []).length !== 0) {
  throw new Error('Pre-show expected 0 questions');
}
console.log('pre-show: 0 questions OK');

const sheetQ1 = once(teamA, 'team:sheet');
host.emit('host:show-question', { roomCode, questionIndex: 0 });
await sheetQ1;

// Show Q0,Q1,Q5,Q7 for open+open+numeric+MC scoring check
for (const idx of [1, 5, 7]) {
  const p = once(teamA, 'team:sheet');
  host.emit('host:show-question', { roomCode, questionIndex: idx });
  await p;
}
const sheetShown = await new Promise((resolve) => {
  teamA.once('team:sheet', resolve);
  teamA.emit('team:update-answers', {
    answers: Array(8).fill(''),
    roomCode,
    teamId: teamIdA,
    token: tokenA,
  });
});
const shown = (sheetShown.shownQuestionIndexes ?? []).sort((a, b) => a - b);
console.log('shown', shown);
const mc = (sheetShown.questions ?? []).find((q) => q.index === 7);
if (mc?.choices) {
  const joined = mc.choices.join(' | ');
  console.log('MC choices', joined);
  if (mc.choices.length !== 4) throw new Error('Expected 4 MC choices, got ' + mc.choices.length);
  if (joined !== 'Atlantic | Indian | Pacific | Arctic') {
    throw new Error('Unexpected MC choices: ' + joined);
  }
}

const answers = Array(8).fill('');
answers[0] = 'Paris';
answers[1] = 'George Orwell';
answers[5] = '1912';
answers[7] = 'Pacific';

const stateAfterSubmit = once(host, 'game:state');
const submitRes = await emitAck(teamA, 'team:submit', {
  answers,
  roomCode,
  teamId: teamIdA,
  token: tokenA,
});
if (!submitRes?.ok) throw new Error('submit failed: ' + JSON.stringify(submitRes));
const stateAfter = await stateAfterSubmit;
if (!stateAfter.teams.find((t) => t.name === 'PhoneA')?.submitted) {
  throw new Error('Host did not see PhoneA submitted');
}
console.log('submit → PhoneA:true OK');

const stateAfterLock = once(host, 'game:state');
host.emit('host:lock', { roomCode });
const lockedState = await stateAfterLock;
const phoneA = lockedState.teams.find((t) => t.name === 'PhoneA');
if ((phoneA?.score ?? 0) !== 4) {
  throw new Error(`Expected PhoneA score 4 after lock, got ${phoneA?.score}`);
}
console.log('after lock score 4 OK');

const lockedUpdate = await emitAck(teamA, 'team:update-answers', {
  answers: Array(8).fill('hack'),
  roomCode,
  teamId: teamIdA,
  token: tokenA,
});
if (lockedUpdate?.ok) throw new Error('Post-lock update should be rejected');
console.log('post-lock update rejected OK');

const statusRes = await fetch(`${BACKEND}/api/deezer/status`);
const status = await statusRes.json();
if (!status.configured) throw new Error('deezer status not configured');
console.log('/api/deezer/status', status);

const quizRes = await fetch(`${BACKEND}/api/quizzes/sample-pub-quiz`);
const quiz = await quizRes.json();
let deezer = 0;
let video = 0;
for (const rnd of quiz.rounds ?? []) {
  for (const q of rnd.questions ?? []) {
    if (q.type === 'video') video += 1;
    if (q.media?.kind === 'deezer' || q.media?.deezerTrackId) deezer += 1;
  }
}
if (deezer < 8) throw new Error(`Expected ≥8 Deezer music, got ${deezer}`);
if (video !== 0) throw new Error(`Expected 0 video questions, got ${video}`);
console.log(`sample: ${deezer} Deezer music, ${video} video OK`);

host.close();
teamA.close();
teamB.close();
console.log('SMOKE_OK');
process.exit(0);
