/** Host-facing app settings (secrets never broadcast to team/TV). */

import type { ThemeId } from './types.js';
import { isThemeId } from './types.js';

export type UrlBaseMode = 'auto' | 'manual';

export type SpellingSlack = 'strict' | 'normal' | 'loose';

export type AiProvider = 'mistral' | 'anthropic';

export type { ThemeId };

export const DEFAULT_MISTRAL_MODEL = 'mistral-small-latest';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';

/** Bulk authoring (full quiz, one round, bank batch). */
export const DEFAULT_BULK_MODEL = 'claude-haiku-4-5';

/** Single-question authoring (regenerate, add one). */
export const DEFAULT_SINGLE_MODEL = 'claude-sonnet-4-5';

/** 0 = faster drafts, 100 = stricter pass. Default sits toward faster. */
export const DEFAULT_AI_DRAFT_EFFORT = 40;

/** Curated list when `/v1/models` fails or is rate-limited */
export const FALLBACK_MISTRAL_MODELS: Array<{ id: string; name: string }> = [
  { id: 'mistral-small-latest', name: 'Mistral Small (latest)' },
  { id: 'mistral-medium-latest', name: 'Mistral Medium (latest)' },
  { id: 'mistral-large-latest', name: 'Mistral Large (latest)' },
  { id: 'open-mistral-nemo', name: 'Open Mistral Nemo' },
  { id: 'ministral-8b-latest', name: 'Ministral 8B (latest)' },
  { id: 'ministral-3b-latest', name: 'Ministral 3B (latest)' },
];

/** Curated Anthropic list when models API fails or is rate-limited */
export const FALLBACK_ANTHROPIC_MODELS: Array<{ id: string; name: string }> = [
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4-0', name: 'Claude Sonnet 4' },
  { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku (latest)' },
];

export interface AppSettingsPublic {
  /** Admin UI + default skin for new rooms (Host Skin can still override live). */
  uiThemeId: ThemeId;
  qrEnabled: boolean;
  urlBaseMode: UrlBaseMode;
  /** Used when urlBaseMode === 'manual' — e.g. http://192.168.1.10:43127 */
  manualUrlBase: string;
  showQrOnTv: boolean;
  spellingSlack: SpellingSlack;
  acceptIncompleteNames: boolean;
  /** Active AI provider for authoring + grading assist */
  aiProvider: AiProvider;
  mistralEnabled: boolean;
  /** Whether a key is stored — never the key itself */
  mistralKeyConfigured: boolean;
  /** Selected Mistral chat model id (public) */
  mistralModel: string;
  anthropicKeyConfigured: boolean;
  /** Selected Anthropic chat model id (public). Used for grading assist. */
  anthropicModel: string;
  /** 0–100. Faster drafts → stricter pass. Does not choose the model. */
  aiDraftEffort: number;
  /** Anthropic model for bulk question generation. */
  bulkModel: string;
  /** Anthropic model for a single question. */
  singleModel: string;
  /** Optional Anthropic workspace id (sent as anthropic-workspace-id) */
  anthropicWorkspaceId: string;
  /** Whether a workspace id is stored / env-loaded */
  anthropicWorkspaceConfigured: boolean;
  /** Model id for the active provider */
  activeModel: string;
  /** True when the active provider has a key */
  authoringAvailable: boolean;
  mediaDefaultProvider: 'deezer' | 'spotify' | 'covers' | 'local' | 'apple_music_mock';
  /** Optional Deezer Application ID stored */
  deezerConfigured: boolean;
  /** Legacy Spotify flag (UI hidden) */
  spotifyConfigured: boolean;
}

export interface AppSettingsStored extends Omit<
  AppSettingsPublic,
  | 'mistralKeyConfigured'
  | 'anthropicKeyConfigured'
  | 'anthropicWorkspaceConfigured'
  | 'spotifyConfigured'
  | 'deezerConfigured'
  | 'activeModel'
  | 'authoringAvailable'
> {
  /** Server-only — never returned to clients as plaintext in public settings */
  mistralApiKey?: string;
  anthropicApiKey?: string;
  /** Optional Deezer Application ID (public search works without it) */
  deezerAppId?: string;
  /** Legacy Spotify Client Credentials */
  spotifyClientId?: string;
  spotifyClientSecret?: string;
}

export const DEFAULT_SETTINGS: AppSettingsStored = {
  uiThemeId: 'modern',
  qrEnabled: true,
  urlBaseMode: 'auto',
  manualUrlBase: '',
  showQrOnTv: true,
  spellingSlack: 'normal',
  acceptIncompleteNames: true,
  aiProvider: 'mistral',
  mistralEnabled: false,
  mistralApiKey: '',
  mistralModel: DEFAULT_MISTRAL_MODEL,
  anthropicApiKey: '',
  anthropicModel: DEFAULT_ANTHROPIC_MODEL,
  aiDraftEffort: DEFAULT_AI_DRAFT_EFFORT,
  bulkModel: DEFAULT_BULK_MODEL,
  singleModel: DEFAULT_SINGLE_MODEL,
  anthropicWorkspaceId: '',
  mediaDefaultProvider: 'deezer',
  deezerAppId: '',
  spotifyClientId: '',
  spotifyClientSecret: '',
};

function resolveProvider(s: AppSettingsStored): AiProvider {
  return s.aiProvider === 'anthropic' ? 'anthropic' : 'mistral';
}

export function toPublicSettings(s: AppSettingsStored): AppSettingsPublic {
  const provider = resolveProvider(s);
  const mistralKey = !!(s.mistralApiKey && s.mistralApiKey.trim());
  const anthropicKey = !!(s.anthropicApiKey && s.anthropicApiKey.trim());
  const anthropicWorkspaceId = (s.anthropicWorkspaceId && s.anthropicWorkspaceId.trim()) || '';
  const mistralModel = (s.mistralModel && s.mistralModel.trim()) || DEFAULT_MISTRAL_MODEL;
  const anthropicModel = (s.anthropicModel && s.anthropicModel.trim()) || DEFAULT_ANTHROPIC_MODEL;
  const bulkModel = (s.bulkModel && s.bulkModel.trim()) || DEFAULT_BULK_MODEL;
  const singleModel = (s.singleModel && s.singleModel.trim()) || DEFAULT_SINGLE_MODEL;
  const effort = s.aiDraftEffort;
  const aiDraftEffort = typeof effort === 'number' && Number.isFinite(effort)
    ? Math.min(100, Math.max(0, Math.round(effort)))
    : DEFAULT_AI_DRAFT_EFFORT;
  const authoringAvailable = provider === 'anthropic' ? anthropicKey : mistralKey;
  const uiThemeId = isThemeId(s.uiThemeId) ? s.uiThemeId : 'modern';
  return {
    uiThemeId,
    qrEnabled: s.qrEnabled,
    urlBaseMode: s.urlBaseMode,
    manualUrlBase: s.manualUrlBase,
    showQrOnTv: s.showQrOnTv,
    spellingSlack: s.spellingSlack,
    acceptIncompleteNames: s.acceptIncompleteNames,
    aiProvider: provider,
    mistralEnabled: s.mistralEnabled,
    mistralKeyConfigured: mistralKey,
    mistralModel,
    anthropicKeyConfigured: anthropicKey,
    anthropicModel,
    aiDraftEffort,
    bulkModel,
    singleModel,
    anthropicWorkspaceId,
    anthropicWorkspaceConfigured: !!anthropicWorkspaceId,
    activeModel: provider === 'anthropic' ? anthropicModel : mistralModel,
    authoringAvailable,
    mediaDefaultProvider: s.mediaDefaultProvider === 'spotify' ? 'deezer' : s.mediaDefaultProvider,
    deezerConfigured: true,
    spotifyConfigured: !!(s.spotifyClientId?.trim() && s.spotifyClientSecret?.trim()),
  };
}
