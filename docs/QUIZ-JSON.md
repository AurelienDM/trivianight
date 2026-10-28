# Quiz JSON (ChatGPT-friendly)

Import/export the same shape from the Editor (**Export JSON** / **Import**). Missing `id` fields are filled automatically on import.

## Minimal shape

```json
{
  "name": "My Quiz",
  "description": "Optional",
  "settings": { "themeId": "modern", "allowMultipleChoice": true, "defaultPoints": 1 },

  "rounds": [
    {
      "title": "Round 1",
      "theme": "optional theme blurb",
      "questions": [
        {
          "type": "open",
          "prompt": "What is the capital of France?",
          "points": 1,
          "acceptedAnswers": ["Paris"]
        }
      ]
    }
  ]
}
```

## Theme / skin ids

`settings.themeId` (also live via Host **Skin** → `host:set-theme`):

| Id | Look |
|----|------|
| `modern` | Default game-show purple/blue |
| `classic` | Warm pub-quiz amber |
| `minimal` | Cool muted slate |
| `neon` | Neon Night — pink/cyan, Orbitron |
| `arcade` | Arcade Cabinet — CRT green, chunky mono |

Host/Phone/TV pick up the live room theme; Editor sets the quiz default for new rooms.

## Question types

| `type` | Extra fields |
|--------|----------------|
| `open` | `acceptedAnswers[]` |
| `multiple_choice` | `choices[]` (display) + `acceptedAnswers` (correct) |
| `numeric` | `numeric: { exact, tolerance? }` + `acceptedAnswers` |
| `music` | optional `media: { kind:"deezer", deezerTrackId, previewUrl?, title?, artist? }` |
| `video` | legacy — prefer `open` or `music`; Editor no longer adds new video questions |
| `ordering` | `orderItems[]` or answer as `"A > B > C"` |
| `connections` | `connectionClues[]` |
| `image` | `media` with image URL |
| `brand_logo` | `acceptedAnswers` = brand (+ aliases); `media: { kind:"image", url, domain?, brandKey?, title? }` |

## Media rules

- Prefer Deezer: `media.kind: "deezer"` + `deezerTrackId` + `previewUrl`.
- Or leave `media` empty and use Editor → Deezer **Search** (only tracks with a preview attach).
- **Brand logos:** type `brand_logo`, prompt like “Which brand does this logo belong to?”, answer = brand name. Editor **Auto-fetch** (or AI publish) calls `POST /api/logos/resolve` (Wikidata P154 → Wikimedia Commons, then Clearbit / favicon fallbacks). Store `media.url` to a logo image; `title` / `domain` / `brandKey` stay spoiler-hidden on TV until reveal. Phone teams see the logo via spoiler-safe `mediaUrl`.
- Multiple choice: exactly 4 clean option strings (not `A|Vienna|B|Berlin…`).
- Numeric: only for how-many / what-year prompts — not which/who/name.
- Title/artist are spoiler-hidden on TV until reveal.

## ChatGPT prompt tip

Ask the model to keep this schema, use Deezer track ids or omit `media`, emit 4 clean MC choices, avoid inventing YouTube ids, avoid true/false, and set `needsFactCheck`-style notes in a `notes` string when unsure.

See also the user-facing pack: store `docs/quiz-json-guide.md` + `docs/quiz-json-example.json`.
