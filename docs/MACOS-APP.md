# Trivia Night — macOS desktop app

Lightweight **Electron** wrapper that starts the local backend and opens the host UI in a native window. No Docker required.

## Prerequisites

- macOS with **Node.js 18+**
- Clone this repo and install dependencies once:

```bash
npm run install:all
npm install --prefix desktop
npm run build          # builds frontend into backend/public + compiles backend
```

## Run (one click after install)

```bash
npm run desktop
```

This launches Electron → starts Express on **port 43128** → opens the dashboard window.

Teams join from phones on the same Wi‑Fi using the **LAN URL / QR** shown on Host and TV lobby (auto-detected; override in **Settings**).

### Dev alternative (two terminals, hot reload)

```bash
npm run dev:backend
npm run dev:frontend   # :43127 — then open manually, or use Electron against a production build
```

## What works offline vs needs network

| Feature | Offline | Needs network |
|---------|---------|----------------|
| Host / TV / team sheets / scoring | ✅ | — |
| Local media uploads | ✅ | — |
| Cover clip YouTube embeds | — | ✅ (YouTube) |
| Mistral AI grade suggestions | — | ✅ + API key |
| Apple Music | mock only | real MusicKit not wired |

## Environment / `.env`

Electron loads optional env files (without overriding vars already set in the shell):

1. Repo root `.env`
2. `backend/.env`

Copy from `.env.example` if you want a local file:

```bash
cp .env.example .env
```

**`HOST_PASSCODE`:** production servers (`npm start`, Docker, Fly) still **require** this to be set. The desktop shell defaults it to `trivia-local` when unset so `npm run desktop` can boot in production mode without a crash. Override via `.env` or the environment if you want a different passcode for LAN hosts.

The Electron **preload** injects that passcode into the renderer (`window.triviaDesktop.hostPasscode`) so Settings Save never calls `window.prompt` (unsupported in Electron). Host mutations use an in-DOM modal / stored passcode in the browser.

## Limits / notes

- **Notarization / signed `.dmg`:** not included in this slice. `npm run desktop` runs Electron from `node_modules` (fine for local hosting). Packaging with `electron-builder` + Apple notarization is left for later.
- **YouTube autoplay:** browsers often block autoplay with sound; the TV embed uses controls so the host/TV can press play. Prefer HDMI audio from the TV machine.
- **Mistral key:** paste in Settings (`mistral-…`) or set `MISTRAL_API_KEY`. Stored under `backend/data/settings.json` (server-side only). Suggestions always need host confirmation.
- **PIN:** QR opens `/join/ROOM` with room code prefilled; PIN is still required.
- **Firewall:** allow inbound TCP on the UI/backend port for LAN phones.

## Scripts (repo root)

| Script | Purpose |
|--------|---------|
| `npm run install:all` | Backend + frontend deps |
| `npm run build` | Production web build |
| `npm run desktop` | Electron shell |
| `npm start` | Backend only (serves built SPA) |
