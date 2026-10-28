/**
 * Spotify Web API — Client Credentials for search + 30s preview URLs.
 * Secrets stay server-side; Host/TV only ever receive previewUrl for playback.
 */

import { getSettings } from '../storage/settingsStorage.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export interface SpotifyTrackHit {
  id: string;
  name: string;
  artists: string;
  album?: string;
  artworkUrl?: string;
  previewUrl: string | null;
  durationMs?: number;
}

export async function isSpotifyConfigured(): Promise<boolean> {
  const s = await getSettings();
  return !!(s.spotifyClientId?.trim() && s.spotifyClientSecret?.trim());
}

async function getAccessToken(): Promise<string> {
  const s = await getSettings();
  const id = s.spotifyClientId?.trim() ?? '';
  const secret = s.spotifyClientSecret?.trim() ?? '';
  if (!id || !secret) {
    throw new Error('Spotify not configured — add Client ID and Secret in Settings');
  }
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.accessToken;
  }
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify auth failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return tokenCache.accessToken;
}

/** Clear cached token after credentials change. */
export function clearSpotifyTokenCache() {
  tokenCache = null;
}

function mapTrack(t: {
  id: string;
  name: string;
  artists?: Array<{ name: string }>;
  album?: { name?: string; images?: Array<{ url: string }> };
  preview_url?: string | null;
  duration_ms?: number;
}): SpotifyTrackHit {
  return {
    id: t.id,
    name: t.name,
    artists: (t.artists ?? []).map((a) => a.name).join(', '),
    album: t.album?.name,
    artworkUrl: t.album?.images?.[0]?.url,
    previewUrl: t.preview_url ?? null,
    durationMs: t.duration_ms,
  };
}

export async function searchSpotifyTracks(query: string, limit = 12): Promise<SpotifyTrackHit[]> {
  const q = query.trim();
  if (!q) return [];
  const token = await getAccessToken();
  const url = `${API}/search?type=track&limit=${Math.min(20, Math.max(1, limit))}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify search failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { tracks?: { items?: unknown[] } };
  const items = (data.tracks?.items ?? []) as Array<Parameters<typeof mapTrack>[0]>;
  return items.map(mapTrack);
}

export async function getSpotifyTrack(trackId: string): Promise<SpotifyTrackHit | null> {
  const id = trackId.trim();
  if (!id) return null;
  const token = await getAccessToken();
  const res = await fetch(`${API}/tracks/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify track failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return mapTrack(await res.json() as Parameters<typeof mapTrack>[0]);
}

/** Build MediaRef for a track that has a playable preview. */
export function trackToMediaRef(track: SpotifyTrackHit) {
  if (!track.previewUrl) {
    return null;
  }
  return {
    kind: 'spotify' as const,
    spotifyTrackId: track.id,
    previewUrl: track.previewUrl,
    title: track.name,
    artist: track.artists,
    durationMs: 30_000,
  };
}
