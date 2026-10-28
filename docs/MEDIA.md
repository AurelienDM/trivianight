# Media providers

## What works for music (product path)

1. **Deezer ~30s previews** — default  
   - Public search (optional Application ID in Settings / `DEEZER_APP_ID`)  
   - Editor → Music → Search → attach a track with a preview  
   - Host/TV play the preview only; **title/artist hidden until reveal**  
   - See `docs/DEEZER.md`

2. **Local uploads** — `/api/media/upload`  
   - MP3 / MP4 / images stored under `DATA_DIR/media`  
   - **Works offline** once files are on disk  

3. **Legacy cover clips (YouTube)** — still in `/api/covers` for old quizzes  
   - Not used for new music samples or the Editor music picker  

4. **Apple Music** — **mock only**  
   - See `docs/APPLE-MUSIC.md`

## Spoiler rules

Public `game:state` keeps `deezerTrackId` / `previewUrl` / `youtubeId` / `url` for playback but strips `title`, `artist`, and `appleMusicId` until the reveal phase.
