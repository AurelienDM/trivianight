# Anthropic setup (TriviaNight)

Optional. The game works fully **without** an AI key. Anthropic is an alternative to Mistral for authoring and grading assist.

## Setup

1. Create an API key at [console.anthropic.com](https://console.anthropic.com).
2. Either:
   - **Settings** → **AI provider** → paste the Anthropic key, or  
   - Env: `ANTHROPIC_API_KEY=…` (read on settings load)
3. Set **Active provider** to **Anthropic**.
4. Default model: **`claude-sonnet-4-5`** (strong for crafting questions and music search terms). The dropdown loads from Anthropic’s models API with a curated fallback (`claude-haiku-4-5`, `claude-opus-4-5`, …).
5. **Workspace ID (optional / required for unscoped keys):** Settings → **Anthropic Workspace ID**, or env `ANTHROPIC_WORKSPACE_ID`. Sent as header `anthropic-workspace-id` on Messages, models list, and validate. If Anthropic returns HTTP 400 “not scoped to a workspace”, paste the Workspace ID from console.anthropic.com.
6. Keys are stored in `backend/data/settings.json` on the host — **never** returned to team/TV sockets.

## What uses the selected provider

- Editor → **Generate round with AI** / **Generate all rounds**
- Optional grading suggestions (**Ask AI** on the scoring desk) when “Enable AI grading assist” is on

All of these go through `callAiJson` (shared rate-limit queue with Mistral). Deterministic grading is never overridden silently.

## Generate options

Difficulty, question type, count, era, theme, and extra instructions from the generate panels are sent to the author endpoint and enforced via a **HARD CONSTRAINTS** block in the prompt (plus a type post-filter when type ≠ `any`).

## Status

`GET /api/ai/status` returns `provider`, `model` (active), key flags, `anthropicWorkspaceConfigured`, `authoringAvailable`, and queue usage.

Author errors for missing workspace use `code: anthropic_workspace_required` with a Settings hint.
