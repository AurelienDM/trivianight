# Mistral AI

Optional. The game works fully **without** a key. You can also use **Anthropic** as the active provider (see [anthropic-setup.md](./anthropic-setup.md)).

## Setup

1. Create an API key at [console.mistral.ai](https://console.mistral.ai) (format typically `mistral-…` / opaque token).
2. Either:
   - **Settings** UI → paste key, or  
   - Env: `MISTRAL_API_KEY=…` (read on settings load)
3. Key is stored in `backend/data/settings.json` on the host machine — **never** returned to team/TV sockets.

Enable **AI grading assist** in Settings if you want “Ask Mistral” on the scoring desk. **Question authoring** only needs the key to be configured (see Editor → Generate with AI).

## Model choice

- When a key is configured, Settings shows a **Model** dropdown.
- Models are loaded from Mistral `GET /v1/models` via `GET /api/settings/mistral/models` (host passcode, queued, 8s timeout, ~5 min cache).
- On failure or 429, a curated fallback list is shown (`source: "fallback"`).
- Selection is stored as `mistralModel` (default `mistral-small-latest`) and used for grading, authoring, and key validate.
- `GET /api/ai/status` includes the resolved `model`.

## Grading assist

- Deterministic grading always runs first (normalization, aliases, fuzzy, incomplete-name option).
- Round **lock / score / refresh** never call Mistral — only the host **Ask Mistral** button does.
- Mistral is queried only for **review** or **low-confidence** deterministic results (clear high-confidence answers skip the API).
- Suggestions are cached ~15 minutes for the same `(answer, accepted)` pair.
- Suggestions **require host confirmation** — never auto-applied.

## Question authoring (per round)

- In the **Editor**, use **Generate round with AI** (theme from round title, category, difficulty, type mix or fixed, count ≤ **8**, era).
- One Mistral call (`roundMode`) via the shared queue and selected `mistralModel`.
- Returns drafts: prompt, answer, variants, type, difficulty, optional media **search terms**, host notes.
- **Review panel:** edit prompt/answer/variants/type, remove drafts, select all / deselect.
- **Publish selected** only after confirm — never auto-publish:
  - Empty/placeholder round → fill/replace without overwrite warning.
  - Existing content → choose **Replace entire round** or **Fill empty slots only**.
- Never invents verified Apple Music / YouTube IDs — only search phrases for the cover picker.
- Prefer fact-check flags when uncertain; treat all AI content as unverified until you publish.

## Rate limits & 429 guardrails

All Mistral traffic goes through a **local gateway** (`mistralClient`):

| Guard | Value |
|-------|--------|
| In-flight | 1 |
| Spacing | ≥ 2s between calls |
| Per minute | 6 |
| Per day | 120 |
| Queue depth | 4 (extras rejected as `rate_limited`) |
| On HTTP 429 | Cooldown (Retry-After or 60s); **no automatic retries** |

- Settings **validates a key only when you paste a new one** (tiny `max_tokens: 1` ping) — not on every Save.
- Host / Generate UI surface `rate_limited` with a wait message.
- Usage snapshot: `GET /api/ai/status` → `usage` (`callsMinute`, `callsDay`, `cooldownMsRemaining`, …).

## Limits

- Needs outbound HTTPS to `api.mistral.ai`
- Default model `mistral-small-latest` (overridable in Settings)
- Prompt / completion caps: grade ~120 tokens, author ~900, validate 1
- Without a key: Generate with AI shows a clear empty state linking to Settings; grading continues manually
