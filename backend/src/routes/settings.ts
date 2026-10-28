import { Router } from 'express';
import { requireHostPasscode } from '../middleware/requireHostPasscode.js';
import { getPublicSettings, getSettings, updateSettings } from '../storage/settingsStorage.js';
import type { AiProvider, AppSettingsStored } from '../shared/settings.js';
import { listLanIpv4, preferLanIp } from '../network.js';
import { listMistralModels, validateMistralApiKey } from '../grading/mistralClient.js';
import { listAnthropicModels, validateAnthropicApiKey } from '../grading/anthropicClient.js';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_BULK_MODEL,
  DEFAULT_MISTRAL_MODEL,
  DEFAULT_SINGLE_MODEL,
} from '../shared/settings.js';
import { clampDraftEffort } from '../ai/authorRouting.js';
import { isThemeId } from '../shared/types.js';
const router = Router();

router.get('/', async (_req, res) => {
  res.json(await getPublicSettings());
});

/** Persist settings only — never calls upstream AI on this path. */
router.put('/', requireHostPasscode, async (req, res) => {
  const body = req.body as Partial<AppSettingsStored>;
  const allowed: (keyof AppSettingsStored)[] = [
    'uiThemeId',
    'qrEnabled',
    'urlBaseMode',
    'manualUrlBase',
    'showQrOnTv',
    'spellingSlack',
    'acceptIncompleteNames',
    'aiProvider',
    'mistralEnabled',
    'mistralApiKey',
    'mistralModel',
    'anthropicApiKey',
    'anthropicModel',
    'aiDraftEffort',
    'bulkModel',
    'singleModel',
    'anthropicWorkspaceId',
    'mediaDefaultProvider',
    'deezerAppId',
  ];
  const patch: Partial<AppSettingsStored> = {};
  for (const key of allowed) {
    if (key in body) (patch as Record<string, unknown>)[key] = body[key];
  }
  if (typeof patch.uiThemeId === 'string' && !isThemeId(patch.uiThemeId)) {
    delete patch.uiThemeId;
  }
  if (typeof patch.aiProvider === 'string') {
    const p = patch.aiProvider as AiProvider;
    patch.aiProvider = p === 'anthropic' ? 'anthropic' : 'mistral';
  }
  if (typeof patch.mistralModel === 'string') {
    const trimmed = patch.mistralModel.trim();
    patch.mistralModel = trimmed || DEFAULT_MISTRAL_MODEL;
  }
  if (typeof patch.anthropicModel === 'string') {
    const trimmed = patch.anthropicModel.trim();
    patch.anthropicModel = trimmed || DEFAULT_ANTHROPIC_MODEL;
  }
  if ('aiDraftEffort' in body) {
    patch.aiDraftEffort = clampDraftEffort(body.aiDraftEffort);
  }
  if (typeof patch.bulkModel === 'string') {
    patch.bulkModel = patch.bulkModel.trim() || DEFAULT_BULK_MODEL;
  }
  if (typeof patch.singleModel === 'string') {
    patch.singleModel = patch.singleModel.trim() || DEFAULT_SINGLE_MODEL;
  }
  if (typeof patch.anthropicWorkspaceId === 'string') {
    patch.anthropicWorkspaceId = patch.anthropicWorkspaceId.trim();
  }
  if (patch.mediaDefaultProvider === 'spotify') {
    patch.mediaDefaultProvider = 'deezer';
  }
  const next = await updateSettings(patch);
  res.json(next);
});

/**
 * Optional post-save key check (tiny max_tokens:1 chat via the shared queue).
 * Call only when a new key was pasted — does not affect persisted settings.
 */
router.post('/mistral/validate', requireHostPasscode, async (req, res) => {
  const body = (req.body ?? {}) as { mistralApiKey?: string };
  const pasted = typeof body.mistralApiKey === 'string' ? body.mistralApiKey.trim() : '';
  if (!pasted) {
    res.json({ ok: false, skipped: true, error: 'No new key to validate' });
    return;
  }
  const result = await validateMistralApiKey(pasted);
  res.json(result);
});

/** Chat model list for Settings dropdown (queued; falls back on failure/429). */
router.get('/mistral/models', requireHostPasscode, async (_req, res) => {
  const result = await listMistralModels();
  res.json(result);
});

router.post('/anthropic/validate', requireHostPasscode, async (req, res) => {
  const body = (req.body ?? {}) as { anthropicApiKey?: string };
  const pasted = typeof body.anthropicApiKey === 'string' ? body.anthropicApiKey.trim() : '';
  if (!pasted) {
    res.json({ ok: false, skipped: true, error: 'No new key to validate' });
    return;
  }
  const result = await validateAnthropicApiKey(pasted);
  res.json(result);
});

router.get('/anthropic/models', requireHostPasscode, async (_req, res) => {
  const result = await listAnthropicModels();
  res.json(result);
});

/** LAN join URL helpers for QR — never returns secrets */
router.get('/network', async (req, res) => {
  const settings = await getSettings();
  const port = Number(process.env.PORT ?? 43128);
  // Desktop/production: SPA is served from the same Express port. Prefer PORT, then UI_PORT / FRONTEND_PORT.
  const uiPort = Number(process.env.UI_PORT ?? process.env.FRONTEND_PORT ?? process.env.PORT ?? 43128);
  const ips = listLanIpv4();
  const lanIp = preferLanIp(ips);
  let joinBase: string;
  if (settings.urlBaseMode === 'manual' && settings.manualUrlBase.trim()) {
    joinBase = settings.manualUrlBase.trim().replace(/\/$/, '');
  } else if (lanIp) {
    joinBase = `http://${lanIp}:${uiPort}`;
  } else {
    const host = req.get('host')?.split(':')[0] || 'localhost';
    joinBase = `${req.protocol}://${host}:${uiPort}`;
  }
  res.json({
    lanIps: ips,
    preferredLanIp: lanIp,
    joinBase,
    backendPort: port,
    uiPort,
    qrEnabled: settings.qrEnabled,
    showQrOnTv: settings.showQrOnTv,
  });
});

export default router;
