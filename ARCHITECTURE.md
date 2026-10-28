# Architecture

Trivia Night is a React + Express + Socket.io pub quiz derived from Surge-Tech/jeopardy’s process model.

## Processes

- **Backend** (`backend/`): Express REST (`/api/quizzes`, `/api/media`), Socket.io game sessions, JSON quiz files under `DATA_DIR/quizzes`, uploads under `DATA_DIR/media`.
- **Frontend** (`frontend/`): Vite React SPA — Dashboard, Editor, Host, TV (`/tv/:roomCode`), Join + Team sheet.

Shared types/events live in `backend/src/shared` and are imported by the frontend via the `@shared` alias.

## Live game

Sessions are in-memory (`gameManager`), keyed by room code. Public `game:state` never includes team answers or correct answers before reveal. Host-only `host:secrets` goes to `hostpanel:<room>`.

### Phases

`lobby` → `round_intro` → `questioning` → `locked` → `reveal` → `scoring` → `leaderboard` → next round / `finished`

Teams keep one editable 8-slot answer sheet per round until lock.

## Grading

`backend/src/grading` — normalize → aliases → fuzzy (Damerau–Levenshtein / Jaro–Winkler, length-aware) → Correct / Review / Incorrect. Numeric answers never use fuzzy text. Host overrides update scores with an audit reason.

## Media

Local uploads always work. `backend/src/media/providers.ts` defines Local + Mock Apple Music providers so the core game never depends on MusicKit credentials.
