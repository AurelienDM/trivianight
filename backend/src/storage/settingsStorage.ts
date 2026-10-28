import fs from 'fs/promises';
import path from 'path';
import {
  DEFAULT_SETTINGS,
  toPublicSettings,
  type AppSettingsPublic,
  type AppSettingsStored,
} from '../shared/settings.js';

function dataDir() {
  return process.env.DATA_DIR ?? './data';
}

function settingsPath() {
  return path.join(dataDir(), 'settings.json');
}

let cache: AppSettingsStored | null = null;

export async function getSettings(): Promise<AppSettingsStored> {
  if (cache) return cache;
  let loaded: AppSettingsStored = { ...DEFAULT_SETTINGS };
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* defaults */
  }
  if (process.env.MISTRAL_API_KEY && !loaded.mistralApiKey) {
    loaded = { ...loaded, mistralApiKey: process.env.MISTRAL_API_KEY };
  }
  if (process.env.ANTHROPIC_API_KEY && !loaded.anthropicApiKey) {
    loaded = { ...loaded, anthropicApiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.ANTHROPIC_WORKSPACE_ID && !loaded.anthropicWorkspaceId) {
    loaded = { ...loaded, anthropicWorkspaceId: process.env.ANTHROPIC_WORKSPACE_ID };
  }
  if (process.env.DEEZER_APP_ID && !loaded.deezerAppId) {
    loaded = { ...loaded, deezerAppId: process.env.DEEZER_APP_ID };
  }
  if (process.env.SPOTIFY_CLIENT_ID && !loaded.spotifyClientId) {
    loaded = { ...loaded, spotifyClientId: process.env.SPOTIFY_CLIENT_ID };
  }
  if (process.env.SPOTIFY_CLIENT_SECRET && !loaded.spotifyClientSecret) {
    loaded = { ...loaded, spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET };
  }
  if (loaded.mediaDefaultProvider === 'spotify') {
    loaded = { ...loaded, mediaDefaultProvider: 'deezer' };
  }
  cache = loaded;
  return cache;
}

export async function getPublicSettings(): Promise<AppSettingsPublic> {
  return toPublicSettings(await getSettings());
}

export async function updateSettings(patch: Partial<AppSettingsStored>): Promise<AppSettingsPublic> {
  const current = await getSettings();
  const next: AppSettingsStored = { ...current, ...patch };
  if ('mistralApiKey' in patch && patch.mistralApiKey === '') {
    next.mistralApiKey = '';
  }
  if ('anthropicApiKey' in patch && patch.anthropicApiKey === '') {
    next.anthropicApiKey = '';
  }
  if ('anthropicWorkspaceId' in patch && patch.anthropicWorkspaceId === '') {
    next.anthropicWorkspaceId = '';
  }
  if ('deezerAppId' in patch && patch.deezerAppId === '') {
    next.deezerAppId = '';
  }
  if ('spotifyClientId' in patch && patch.spotifyClientId === '') {
    next.spotifyClientId = '';
  }
  if ('spotifyClientSecret' in patch && patch.spotifyClientSecret === '') {
    next.spotifyClientSecret = '';
  }
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2));
  cache = next;
  return toPublicSettings(next);
}
