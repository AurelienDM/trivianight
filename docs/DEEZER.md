# Deezer music previews

Trivia Night plays **~30-second Deezer previews** for music questions. Full tracks are not streamed.

## Setup

1. Search works out of the box (Deezer public API — no secret required).
2. Optional: create an app at [developers.deezer.com](https://developers.deezer.com), copy the **Application ID**, paste in **Settings → Deezer**, or set `DEEZER_APP_ID`.
3. Editor → Music → **Search** → attach a track with a preview.
4. Host/TV play only that preview; title/artist stay hidden until reveal.

## API (host)

| Route | Purpose |
|-------|---------|
| `GET /api/deezer/status` | `{ configured, appIdConfigured }` |
| `GET /api/deezer/search?q=` | Search tracks (host passcode) |
| `POST /api/deezer/attach` | `{ trackId }` → `MediaRef` (requires preview) |
| `GET /api/deezer/preview/:trackId` | Refresh preview URL |

## Media shape

```json
{
  "kind": "deezer",
  "deezerTrackId": "4603408",
  "previewUrl": "https://cdns-preview-….dzcdn.net/stream/…",
  "title": "Billie Jean",
  "artist": "Michael Jackson"
}
```

## Samples

`backend/fixtures/sample-pub-quiz.json` Name That Tune round stores Deezer track ids + preview URLs.
