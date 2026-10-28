# Question bank

Persistent host-side library of questions stored at `DATA_DIR/question-bank.json` (default `backend/data/question-bank.json`).

Core play does **not** require the bank — rooms run from quiz JSON only.

## How items get in

- **AI generate** (`POST /api/ai/author`) auto-adds returned drafts (deduped by prompt + answer entity).
- **Editor publish** of AI drafts also upserts into the bank.
- Manual: `POST /api/bank` with `{ items: [...] }` or a single `{ prompt, acceptedAnswers, type }` (host passcode).

## API (host passcode)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/bank?q=&limit=&offset=` | List / search |
| `POST` | `/api/bank` | Add items |
| `GET` | `/api/bank/:id` | One item |
| `DELETE` | `/api/bank/:id` | Remove |

## Editor

**Browse bank** → search → select → **Add from bank to round**.
