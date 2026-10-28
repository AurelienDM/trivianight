# Apple Music setup (optional)

Trivia Night’s music rounds work with **local audio uploads** without Apple Music.

When you want catalog search + MusicKit playback:

1. Create a MusicKit key in Apple Developer → Keys.
2. Set env vars from `.env.example`:
   - `APPLE_MUSIC_TEAM_ID`
   - `APPLE_MUSIC_KEY_ID`
   - `APPLE_MUSIC_PRIVATE_KEY_PATH` (or `APPLE_MUSIC_TOKEN` if you mint JWTs yourself)
3. The backend exposes a **media provider** abstraction (`backend/src/media/providers.ts`). Swap `mockAppleMusicProvider` for a real MusicKit-backed provider — never ship private keys to the browser.
4. Until credentials exist, the mock provider returns demo search hits; hosts should attach local `mp3` files or leave media as host-played cues.

Spoiler rule: track title/artist must not appear on team/TV payloads until the reveal phase (already stripped in `toPublicQuestion`).
