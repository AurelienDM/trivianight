# Setup

## Development

```bash
npm run install:all
npm run dev:backend    # :43128
npm run dev:frontend   # :43127 (proxies /api and /media)
```

Open http://localhost:43127 — sample quiz is seeded automatically.

## Production (single process)

```bash
npm run install:all
npm run build
HOST_PASSCODE=secret npm start   # :43128
```

## Environment

See `.env.example`. `HOST_PASSCODE` is required when `NODE_ENV=production`.

## LAN game night

1. Start the server on the host laptop.
2. TV/browser: `/tv/ROOM` (or Open TV from host).
3. Teams: `http://LAN_IP:PORT/join` with room code + PIN.
4. Keep a single audio output (TV or host) — avoid duplicate playback.

**Team photos on LAN HTTP:** phones join over plain `http://192.168.x.x`, which is not a secure context — browsers block `getUserMedia`. Join uses **Take a picture** (`<input type="file" accept="image/*" capture="user">`) so the native camera / photo picker works. Live getUserMedia is only offered on https/localhost.

## Tests

```bash
npm test
```
