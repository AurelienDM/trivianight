import { io } from '../../frontend/node_modules/socket.io-client/build/esm/index.js';

const host = io('http://127.0.0.1:43128', { transports: ['websocket'] });
await new Promise((r) => host.on('connect', r));
host.emit('host:create', { quizId: 'sample-pub-quiz' });
const created = await new Promise((r) => host.once('host:created', r));
const roomCode = created.roomCode;
const pin = created.state.pin;

async function join(name, color) {
  const t = io('http://127.0.0.1:43128', { transports: ['websocket'] });
  await new Promise((r) => t.on('connect', r));
  const joined = await new Promise((res, rej) =>
    t.emit('team:join', { roomCode, name, pin, color }, (x) => (x.ok ? res(x) : rej(x))),
  );
  return { socket: t, ...joined };
}

const alpha = await join('Alpha', '#E63946');
await join('Beta', '#2A9D8F');

host.emit('host:start', { roomCode });
await new Promise((r) => host.once('game:state', r));
host.emit('host:show-question', { roomCode, questionIndex: 0 });
await new Promise((r) => host.once('game:state', r));

const answers = ['Paris', 'Orwell', 'Mars', '6', 'Au', '1912', 'da Vinci', 'Pacific'];
await new Promise((r) => alpha.socket.emit('team:update-answers', { answers }, () => r()));
await new Promise((r) => alpha.socket.emit('team:submit', {}, () => r()));

host.emit('host:lock', { roomCode });
await new Promise((r) => host.once('host:secrets', r));
host.emit('host:begin-reveal', { roomCode });
await new Promise((r) => host.once('game:state', r));
for (let i = 0; i < 8; i++) {
  host.emit('host:reveal-next', { roomCode });
  await new Promise((r) => host.once('game:state', r));
}
host.emit('host:show-leaderboard', { roomCode });
await new Promise((r) => host.once('game:state', r));

console.log(
  JSON.stringify({
    roomCode,
    pin,
    teamId: alpha.team.id,
    token: alpha.token,
  }),
);

await new Promise((r) => setTimeout(r, 25000));
process.exit(0);
