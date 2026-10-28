import { io } from '../../frontend/node_modules/socket.io-client/build/esm/index.js';

const BACKEND = 'http://127.0.0.1:43128';

function client() {
  return io(BACKEND, { transports: ['websocket'] });
}

function once(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + event)), timeout);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

const host = client();
await new Promise((r) => host.on('connect', () => r()));
host.emit('host:create', { quizId: 'sample-pub-quiz' });
const created = await once(host, 'host:created');
const roomCode = created.roomCode;
const pin = created.state.pin;
console.log('ROOM', roomCode, 'PIN', pin);

const teamA = client();
const teamB = client();
await Promise.all([
  new Promise((r) => teamA.on('connect', () => r())),
  new Promise((r) => teamB.on('connect', () => r())),
]);

await new Promise((resolve, reject) => {
  teamA.emit('team:join', { roomCode, name: 'Alpha', pin, color: '#E63946' }, (res) =>
    res.ok ? resolve() : reject(new Error(JSON.stringify(res))),
  );
});
await new Promise((resolve, reject) => {
  teamB.emit('team:join', { roomCode, name: 'Beta', pin, color: '#2A9D8F' }, (res) =>
    res.ok ? resolve() : reject(new Error(JSON.stringify(res))),
  );
});
console.log('teams joined');

host.emit('host:start', { roomCode });
await once(host, 'game:state');
host.emit('host:show-question', { roomCode, questionIndex: 0 });
const qState = await once(host, 'game:state');
console.log('phase', qState.phase, 'prompt', qState.currentQuestion?.prompt?.slice(0, 50));

const answersA = ['Paris', 'George Orwell', 'Mars', '6', 'Au', '1912', 'Leonardo da Vinci', 'Pacific'];
const answersB = ['Lyon', 'Orwell', 'Mars', 'six', 'Au', '1911', 'da Vinci', 'Atlantic'];

await new Promise((resolve) => {
  teamA.emit('team:update-answers', { answers: answersA }, () => resolve());
});
await new Promise((resolve) => {
  teamB.emit('team:update-answers', { answers: answersB }, () => resolve());
});
await new Promise((resolve) => teamA.emit('team:submit', {}, () => resolve()));
await new Promise((resolve) => teamB.emit('team:submit', {}, () => resolve()));
console.log('submitted');

host.emit('host:lock', { roomCode });
await once(host, 'host:secrets');
host.emit('host:begin-reveal', { roomCode });
const reveal = await once(host, 'game:state');
console.log('reveal', reveal.phase, reveal.currentQuestion?.revealedAnswer);

for (let i = 0; i < 8; i++) {
  host.emit('host:reveal-next', { roomCode });
  await once(host, 'game:state');
}
host.emit('host:open-scoring', { roomCode });
const secrets = await once(host, 'host:secrets');
const alpha = secrets.teams.find((t) => t.name === 'Alpha');
const beta = secrets.teams.find((t) => t.name === 'Beta');
console.log('Alpha round points', alpha?.roundPoints, 'Q1', alpha?.grades[0]?.verdict);
console.log('Beta round points', beta?.roundPoints, 'Q1', beta?.grades[0]?.verdict);

host.emit('host:show-leaderboard', { roomCode });
const lb = await once(host, 'game:state');
console.log(
  'leaderboard',
  lb.leaderboard.map((e) => `${e.rank}:${e.name}=${e.score}`).join(', '),
);
console.log('SMOKE_OK');
host.close();
teamA.close();
teamB.close();
process.exit(0);
