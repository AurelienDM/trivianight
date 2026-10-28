/**
 * Media provider abstraction — core quiz works without Apple Music.
 * Default playable path: Cover clips (YouTube embeds) + local uploads.
 */

export interface TrackSearchResult {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  previewUrl?: string;
  youtubeId?: string;
  provider?: string;
}

export interface MediaProvider {
  readonly id: string;
  readonly label: string;
  search?(query: string): Promise<TrackSearchResult[]>;
  resolvePlayback?(catalogId: string): Promise<{ url?: string; kind: 'apple_music' | 'audio' | 'youtube' } | null>;
}

/** Local uploaded files / URLs — always available offline. */
export const localMediaProvider: MediaProvider = {
  id: 'local',
  label: 'Local media',
  async resolvePlayback() {
    return null;
  },
};

/** Mock Apple Music provider for demos without credentials. */
export const mockAppleMusicProvider: MediaProvider = {
  id: 'apple_music_mock',
  label: 'Apple Music (mock)',
  async search(query: string) {
    return [
      {
        id: 'mock.track.1',
        title: `Mock result for “${query}”`,
        artist: 'Demo Artist',
        album: 'Trivia Night Samples',
        provider: 'apple_music_mock',
      },
    ];
  },
  async resolvePlayback(_catalogId: string) {
    return { kind: 'apple_music' as const, url: undefined };
  },
};

import { coversMediaProvider } from './coversCatalog.js';

let activeProvider: MediaProvider = coversMediaProvider;

export function setMediaProvider(provider: MediaProvider) {
  activeProvider = provider;
}

export function getMediaProvider(): MediaProvider {
  return activeProvider;
}

export function getAvailableProviders(): MediaProvider[] {
  return [coversMediaProvider, localMediaProvider, mockAppleMusicProvider];
}

export { coversMediaProvider };
