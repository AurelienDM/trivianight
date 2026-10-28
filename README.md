# Trivia Night

A self-hosted, host-controlled **pub quiz** platform for in-person game nights. One host laptop, one TV projection, one phone per team — eight editable answers per round, locked until the dramatic reveal.

Built by transforming [Surge-Tech/jeopardy](https://github.com/Surge-Tech/jeopardy) (MIT): we keep Express + Socket.io, JSON storage, media uploads, room codes, and the host / TV / phone split — and replace Jeopardy buzzers with pub-quiz round sheets, delayed reveals, and intelligent grading.

## Quick start

**Prerequisites:** Node.js 18+

```bash
npm run install:all
npm run dev:backend   # http://localhost:43128
npm run dev:frontend  # http://localhost:43127
```

**macOS app (recommended for game night):**

```bash
npm run install:all
npm run desktop       # builds + Electron window on :43128
```

See [docs/MACOS-APP.md](docs/MACOS-APP.md).

Or production-style (single port after build):

```bash
npm run build
npm start             # serves UI + API on http://localhost:43128
```

- **Dashboard / editor / settings:** http://localhost:43127  
- **Host a quiz:** open a quiz → **Host** (QR uses LAN IP, not localhost)  
- **TV:** **Open TV** — lobby shows QR when enabled  
- **Teams:** scan QR or `/join` — room code prefilled; **PIN still required**  
- **Music:** Editor music → Deezer ~30s previews — [docs/DEEZER.md](docs/DEEZER.md) · [docs/MEDIA.md](docs/MEDIA.md)  
- **Mistral (optional):** Settings → [docs/MISTRAL.md](docs/MISTRAL.md)  

LAN: QR/auto-detect prefers your Mac’s LAN address. Override in **Settings**. Optional `HOST_PASSCODE` gates quiz/media/settings writes.

## What’s included

- Sample **8×8** quiz (`backend/data/quizzes/sample-pub-quiz.json`)
- Host dashboard, TV game-show view, mobile team answer sheets
- Lock → reveal → host review/override → leaderboard → next round
- Typo-tolerant grading (no AI key required)
- Local image/audio/video upload; Apple Music via **mock adapter** (see docs)
- JSON import/export in the editor

```bash
npm test   # grading unit tests
```

## License

MIT — includes original copyright from Surge-Tech/jeopardy; Trivia Night modifications © contributors.
