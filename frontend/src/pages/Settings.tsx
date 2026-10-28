import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Gem, Zap } from 'lucide-react';
import { hostFetch } from '../lib/hostAuth';
import type { AiProvider, AppSettingsPublic, SpellingSlack, UrlBaseMode } from '@shared/settings';
import type { ThemeId } from '@shared/types';
import AdminShell from '../components/admin/AdminShell';
import { THEME_OPTIONS } from '../hooks/useRoomTheme';

type ModelOption = { id: string; name: string };

export default function Settings() {
  const { hash } = useLocation();
  const [settings, setSettings] = useState<AppSettingsPublic | null>(null);
  const [mistralKey, setMistralKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [deezerAppId, setDeezerAppId] = useState('');
  const [network, setNetwork] = useState<{ joinBase: string; lanIps: string[]; preferredLanIp: string | null } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mistralModels, setMistralModels] = useState<ModelOption[]>([]);
  const [mistralModelsSource, setMistralModelsSource] = useState<'api' | 'fallback' | null>(null);
  const [mistralModelsLoading, setMistralModelsLoading] = useState(false);
  const [anthropicModels, setAnthropicModels] = useState<ModelOption[]>([]);
  const [anthropicModelsSource, setAnthropicModelsSource] = useState<'api' | 'fallback' | null>(null);
  const [anthropicModelsLoading, setAnthropicModelsLoading] = useState(false);

  async function loadMistralModels() {
    setMistralModelsLoading(true);
    try {
      const res = await hostFetch('/api/settings/mistral/models');
      const data = (await res.json().catch(() => ({}))) as {
        models?: ModelOption[];
        source?: 'api' | 'fallback';
        selected?: string;
      };
      if (res.ok && Array.isArray(data.models) && data.models.length) {
        setMistralModels(data.models);
        setMistralModelsSource(data.source ?? 'api');
        setSettings((prev) => {
          if (!prev) return prev;
          const selected = data.selected || prev.mistralModel;
          if (selected && selected !== prev.mistralModel) {
            return { ...prev, mistralModel: selected };
          }
          return prev;
        });
      }
    } catch {
      /* dropdown stays empty / previous */
    } finally {
      setMistralModelsLoading(false);
    }
  }

  async function loadAnthropicModels() {
    setAnthropicModelsLoading(true);
    try {
      const res = await hostFetch('/api/settings/anthropic/models');
      const data = (await res.json().catch(() => ({}))) as {
        models?: ModelOption[];
        source?: 'api' | 'fallback';
        selected?: string;
      };
      if (res.ok && Array.isArray(data.models) && data.models.length) {
        setAnthropicModels(data.models);
        setAnthropicModelsSource(data.source ?? 'api');
        setSettings((prev) => {
          if (!prev) return prev;
          const selected = data.selected || prev.anthropicModel;
          if (selected && selected !== prev.anthropicModel) {
            return { ...prev, anthropicModel: selected };
          }
          return prev;
        });
      }
    } catch {
      /* dropdown stays empty / previous */
    } finally {
      setAnthropicModelsLoading(false);
    }
  }

  async function load() {
    const [s, n] = await Promise.all([
      fetch('/api/settings').then((r) => r.json()),
      fetch('/api/settings/network').then((r) => r.json()),
    ]);
    setSettings(s);
    setNetwork(n);
    if (s?.mistralKeyConfigured) void loadMistralModels();
    if (s?.anthropicKeyConfigured) void loadAnthropicModels();
  }

  useEffect(() => { load().catch((e) => setError(String(e))); }, []);

  useEffect(() => {
    const id = (hash || '#ai').replace('#', '');
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, settings]);

  function describeSaveError(err: unknown, res?: Response): string {
    if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
      return 'Save timed out — check the host passcode / desktop bridge and try again.';
    }
    if (res?.status === 401) {
      return 'Unauthorized (401) — host passcode rejected. Clear localStorage key trivia-night:hostPasscode or restart the desktop app.';
    }
    if (res && !res.ok) return `Save failed (HTTP ${res.status})`;
    return err instanceof Error ? err.message : 'Save failed';
  }

  async function validateMistralNote(pastedKey: string) {
    if (!pastedKey) return;
    try {
      const res = await hostFetch('/api/settings/mistral/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mistralApiKey: pastedKey }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; skipped?: boolean };
      if (data.skipped) return;
      if (data.ok) {
        setStatus((prev) => (prev === 'Saved' ? 'Saved — Mistral key OK' : prev));
      } else if (data.error) {
        setStatus((prev) => (prev?.startsWith('Saved') ? `Saved — Mistral: ${data.error}` : prev));
      }
    } catch {
      /* non-blocking */
    }
  }

  async function validateAnthropicNote(pastedKey: string) {
    if (!pastedKey) return;
    try {
      const res = await hostFetch('/api/settings/anthropic/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anthropicApiKey: pastedKey }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        skipped?: boolean;
        code?: string;
      };
      if (data.skipped) return;
      if (data.ok) {
        setStatus((prev) => {
          if (!prev || prev === 'Saved') return 'Saved — Anthropic key OK';
          if (prev.startsWith('Saved')) return `${prev}; Anthropic key OK`;
          return prev;
        });
      } else if (data.code === 'anthropic_workspace_required' || data.error) {
        const msg = data.code === 'anthropic_workspace_required'
          ? (data.error || 'Workspace ID required — paste it below and Save again')
          : data.error!;
        setStatus((prev) => (prev?.startsWith('Saved') ? `${prev} — Anthropic: ${msg}` : prev));
      }
    } catch {
      /* non-blocking */
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setStatus('Saving…');
    setError(null);
    const body: Record<string, unknown> = {
      uiThemeId: settings.uiThemeId ?? 'modern',
      qrEnabled: settings.qrEnabled,
      urlBaseMode: settings.urlBaseMode,
      manualUrlBase: settings.manualUrlBase,
      showQrOnTv: settings.showQrOnTv,
      spellingSlack: settings.spellingSlack,
      acceptIncompleteNames: settings.acceptIncompleteNames,
      aiProvider: settings.aiProvider,
      mistralEnabled: settings.mistralEnabled,
      mistralModel: settings.mistralModel,
      anthropicModel: settings.anthropicModel,
      aiDraftEffort: settings.aiDraftEffort ?? 40,
      bulkModel: settings.bulkModel || 'claude-haiku-4-5',
      singleModel: settings.singleModel || 'claude-sonnet-4-5',
      anthropicWorkspaceId: settings.anthropicWorkspaceId ?? '',
      mediaDefaultProvider: settings.mediaDefaultProvider,
    };
    const mistralTrimmed = mistralKey.trim();
    const anthropicTrimmed = anthropicKey.trim();
    if (mistralTrimmed) body.mistralApiKey = mistralTrimmed;
    if (anthropicTrimmed) body.anthropicApiKey = anthropicTrimmed;
    if (deezerAppId.trim()) body.deezerAppId = deezerAppId.trim();
    try {
      const res = await hostFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(describeSaveError(null, res));
        setStatus(null);
        return;
      }
      const saved = await res.json();
      setSettings(saved);
      setMistralKey('');
      setAnthropicKey('');
      setDeezerAppId('');
      setStatus('Saved');
      const n = await fetch('/api/settings/network').then((r) => r.json());
      setNetwork(n);
      setTimeout(() => setStatus((s) => (s === 'Saved' ? null : s)), 1500);
      if (mistralTrimmed) {
        void validateMistralNote(mistralTrimmed).then(() => loadMistralModels());
      }
      if (anthropicTrimmed) {
        void validateAnthropicNote(anthropicTrimmed).then(() => loadAnthropicModels());
      }
    } catch (err) {
      setError(describeSaveError(err));
      setStatus(null);
    }
  }

  async function clearMistralKey() {
    setError(null);
    try {
      const res = await hostFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mistralApiKey: '' }),
      });
      if (res.ok) {
        setSettings(await res.json());
        setStatus('Mistral API key cleared');
        setMistralModels([]);
        setMistralModelsSource(null);
      } else {
        setError(describeSaveError(null, res));
      }
    } catch (err) {
      setError(describeSaveError(err));
    }
  }

  async function clearAnthropicKey() {
    setError(null);
    try {
      const res = await hostFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anthropicApiKey: '' }),
      });
      if (res.ok) {
        setSettings(await res.json());
        setStatus('Anthropic API key cleared');
        setAnthropicModels([]);
        setAnthropicModelsSource(null);
      } else {
        setError(describeSaveError(null, res));
      }
    } catch (err) {
      setError(describeSaveError(err));
    }
  }

  if (!settings) {
    return (
      <AdminShell>
        <p className="text-[var(--muted)]">{error || 'Loading settings…'}</p>
      </AdminShell>
    );
  }

  const provider = (settings.aiProvider === 'anthropic' ? 'anthropic' : 'mistral') as AiProvider;

  return (
    <AdminShell>
      <div>
        <h1 className="admin-page-title">Settings</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Appearance, AI, music, and network. Secrets stay on the server.
        </p>
      </div>
      <form onSubmit={save} className="space-y-6">
        <section id="appearance" className="panel p-5 space-y-4 scroll-mt-6">
          <p className="settings-section-label">Appearance</p>
          <p className="text-xs text-[var(--muted)]">
            Admin chrome + default room skin. Quiz theme still wins when set.
          </p>
          <select
            className="input"
            value={settings.uiThemeId ?? 'modern'}
            onChange={(e) => setSettings({ ...settings, uiThemeId: e.target.value as ThemeId })}
          >
            {THEME_OPTIONS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </section>

        <section id="join" className="panel p-5 space-y-4 scroll-mt-6">
          <p className="settings-section-label">Join QR & LAN URL</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.qrEnabled}
              onChange={(e) => setSettings({ ...settings, qrEnabled: e.target.checked })}
            />
            Show QR code on host
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.showQrOnTv}
              onChange={(e) => setSettings({ ...settings, showQrOnTv: e.target.checked })}
            />
            Show QR code on TV lobby
          </label>
          <label className="block text-sm text-[var(--muted)]">URL base</label>
          <select
            className="input"
            value={settings.urlBaseMode}
            onChange={(e) => setSettings({ ...settings, urlBaseMode: e.target.value as UrlBaseMode })}
          >
            <option value="auto">Auto (LAN IP)</option>
            <option value="manual">Manual override</option>
          </select>
          {settings.urlBaseMode === 'manual' && (
            <input
              className="input"
              placeholder="http://192.168.1.10:43128"
              value={settings.manualUrlBase}
              onChange={(e) => setSettings({ ...settings, manualUrlBase: e.target.value })}
            />
          )}
          {network && (
            <div className="text-xs text-[var(--muted)] space-y-1">
              <p>Join base: <span className="text-[var(--gold)] font-mono">{network.joinBase}</span></p>
              <p>LAN IPs: {network.lanIps.join(', ') || 'none detected'}</p>
            </div>
          )}
        </section>

        <section id="grading" className="panel p-5 space-y-4 scroll-mt-6">
          <p className="settings-section-label">Answer grading</p>
          <label className="block text-sm text-[var(--muted)]">Spelling slack</label>
          <select
            className="input"
            value={settings.spellingSlack}
            onChange={(e) => setSettings({ ...settings, spellingSlack: e.target.value as SpellingSlack })}
          >
            <option value="strict">Strict</option>
            <option value="normal">Normal</option>
            <option value="loose">Loose</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.acceptIncompleteNames}
              onChange={(e) => setSettings({ ...settings, acceptIncompleteNames: e.target.checked })}
            />
            Accept incomplete names (e.g. last name only / missing “The”)
          </label>
        </section>

        <section id="ai" className="panel p-5 space-y-5 scroll-mt-6">
          <div>
            <p className="settings-section-label">AI</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              The slider changes how hard a job tries. It does not pick the model. Job size does.
            </p>
          </div>
          <label className="block text-sm">
            <span className="font-semibold">Speed / quality</span>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              Faster drafts on the left. A stricter pass on the right.
            </span>
            <input
              className="mt-3 w-full accent-[var(--accent)]"
              type="range"
              min={0}
              max={100}
              value={settings.aiDraftEffort ?? 40}
              onChange={(e) => setSettings({ ...settings, aiDraftEffort: Number(e.target.value) })}
            />
            <span className="mt-1 flex justify-between text-xs text-[var(--muted)]">
              <span>Faster drafts</span>
              <span>Stricter pass</span>
            </span>
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-[rgba(80,48,20,0.08)] bg-[var(--bg-elevated)] p-4 space-y-2">
              <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                <Zap size={14} /> Bulk
              </p>
              <p className="text-lg font-bold">Claude Haiku</p>
              <ul className="text-sm text-[var(--muted)] space-y-1">
                <li>Generate the whole quiz</li>
                <li>Generate one round</li>
                <li>Generate a batch into the bank</li>
              </ul>
              <label className="block text-xs text-[var(--muted)]">
                Bulk model
                <input
                  className="input mt-1 font-mono text-xs"
                  value={settings.bulkModel || 'claude-haiku-4-5'}
                  onChange={(e) => setSettings({ ...settings, bulkModel: e.target.value })}
                />
              </label>
            </div>
            <div className="rounded-2xl border border-[rgba(80,48,20,0.08)] bg-[var(--bg-elevated)] p-4 space-y-2">
              <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                <Gem size={14} /> One question
              </p>
              <p className="text-lg font-bold">Claude Sonnet</p>
              <ul className="text-sm text-[var(--muted)] space-y-1">
                <li>Regenerate this question</li>
                <li>Add a single question</li>
              </ul>
              <label className="block text-xs text-[var(--muted)]">
                Single-question model
                <input
                  className="input mt-1 font-mono text-xs"
                  value={settings.singleModel || 'claude-sonnet-4-5'}
                  onChange={(e) => setSettings({ ...settings, singleModel: e.target.value })}
                />
              </label>
            </div>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Used when Anthropic is the active provider. Keys stay on this Mac. Grading assist still uses the Anthropic model chosen below.
          </p>
          <label className="block text-sm text-[var(--muted)]">Active provider</label>
          <select
            className="input"
            value={provider}
            onChange={(e) => setSettings({ ...settings, aiProvider: e.target.value as AiProvider })}
          >
            <option value="mistral">Mistral</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <p className="text-xs text-[var(--muted)]">
            Active model: <span className="font-mono text-[var(--gold)]">{settings.activeModel}</span>
            {' · '}
            Authoring: {settings.authoringAvailable ? 'ready' : 'needs key for selected provider'}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.mistralEnabled}
              onChange={(e) => setSettings({ ...settings, mistralEnabled: e.target.checked })}
            />
            Enable AI grading assist
          </label>
        </section>

        <section id="mistral" className="panel p-5 space-y-4 scroll-mt-6">
          <p className="settings-section-label">AI · Mistral</p>
          <p className="text-xs text-[var(--muted)]">
            Key format: <code className="text-[var(--gold)]">mistral-…</code> from console.mistral.ai.
            Or set <code>MISTRAL_API_KEY</code> env.
          </p>
          <p className="text-xs text-[var(--muted)]">
            Key configured: {settings.mistralKeyConfigured ? 'yes' : 'no'}
          </p>
          <input
            className="input font-mono text-sm"
            type="password"
            autoComplete="off"
            placeholder={settings.mistralKeyConfigured ? '•••••••• (paste to replace)' : 'Paste Mistral API key'}
            value={mistralKey}
            onChange={(e) => setMistralKey(e.target.value)}
          />
          {settings.mistralKeyConfigured && (
            <>
              <label className="block text-sm text-[var(--muted)]">Mistral model</label>
              <select
                className="input font-mono text-sm"
                value={settings.mistralModel || 'mistral-small-latest'}
                onChange={(e) => setSettings({ ...settings, mistralModel: e.target.value })}
                disabled={mistralModelsLoading && mistralModels.length === 0}
              >
                {(mistralModels.length
                  ? mistralModels
                  : [{ id: settings.mistralModel || 'mistral-small-latest', name: settings.mistralModel || 'mistral-small-latest' }]
                ).map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
              </select>
              <p className="text-xs text-[var(--muted)]">
                {mistralModelsLoading
                  ? 'Loading models…'
                  : mistralModelsSource === 'fallback'
                    ? 'Using fallback model list (API unavailable or rate-limited).'
                    : mistralModelsSource === 'api'
                      ? 'Models loaded from Mistral API.'
                      : 'Save a key, then models will load.'}
                {' '}
                <button type="button" className="underline" onClick={() => void loadMistralModels()}>Refresh</button>
              </p>
              <button type="button" className="btn btn-ghost text-sm" onClick={() => void clearMistralKey()}>
                Clear Mistral key
              </button>
            </>
          )}
        </section>

        <section id="anthropic" className="panel p-5 space-y-4 scroll-mt-6">
          <p className="settings-section-label">AI · Anthropic</p>
          <p className="text-xs text-[var(--muted)]">
            Paste an Anthropic API key (or set <code>ANTHROPIC_API_KEY</code>). Default model:{' '}
            <code className="text-[var(--gold)]">claude-sonnet-4-5</code> — strong for crafting questions and music search terms.
          </p>
          <p className="text-xs text-[var(--muted)]">
            Key configured: {settings.anthropicKeyConfigured ? 'yes' : 'no'}
            {' · '}
            Workspace ID: {settings.anthropicWorkspaceConfigured ? 'yes' : 'no'}
          </p>
          <input
            className="input font-mono text-sm"
            type="password"
            autoComplete="off"
            placeholder={settings.anthropicKeyConfigured ? '•••••••• (paste to replace)' : 'Paste Anthropic API key'}
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
          />
          <label className="block text-sm text-[var(--muted)]">Anthropic Workspace ID</label>
          <input
            className="input font-mono text-sm"
            autoComplete="off"
            placeholder="Required for unscoped keys (console.anthropic.com)"
            value={settings.anthropicWorkspaceId ?? ''}
            onChange={(e) => setSettings({ ...settings, anthropicWorkspaceId: e.target.value })}
          />
          <p className="text-xs text-[var(--muted)]">
            Sent as <code className="text-[var(--gold)]">anthropic-workspace-id</code> on Messages, models, and validate.
            Or set <code>ANTHROPIC_WORKSPACE_ID</code> env. Clear the field and Save to remove.
          </p>
          {settings.anthropicKeyConfigured && (
            <>
              <label className="block text-sm text-[var(--muted)]">Anthropic model</label>
              <select
                className="input font-mono text-sm"
                value={settings.anthropicModel || 'claude-sonnet-4-5'}
                onChange={(e) => setSettings({ ...settings, anthropicModel: e.target.value })}
                disabled={anthropicModelsLoading && anthropicModels.length === 0}
              >
                {(anthropicModels.length
                  ? anthropicModels
                  : [{ id: settings.anthropicModel || 'claude-sonnet-4-5', name: settings.anthropicModel || 'claude-sonnet-4-5' }]
                ).map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
              </select>
              <p className="text-xs text-[var(--muted)]">
                {anthropicModelsLoading
                  ? 'Loading models…'
                  : anthropicModelsSource === 'fallback'
                    ? 'Using fallback model list (API unavailable or rate-limited).'
                    : anthropicModelsSource === 'api'
                      ? 'Models loaded from Anthropic API.'
                      : 'Save a key, then models will load.'}
                {' '}
                <button type="button" className="underline" onClick={() => void loadAnthropicModels()}>Refresh</button>
              </p>
              <button type="button" className="btn btn-ghost text-sm" onClick={() => void clearAnthropicKey()}>
                Clear Anthropic key
              </button>
            </>
          )}
        </section>

        <section id="music" className="panel p-5 space-y-4 scroll-mt-6">
          <p className="settings-section-label">Music (Deezer)</p>
          <p className="text-xs text-[var(--muted)]">
            Music rounds search Deezer and play ~30s previews. Title/artist stay hidden until reveal.
            Optional Application ID from{' '}
            <a className="underline text-[var(--gold)]" href="https://developers.deezer.com" target="_blank" rel="noreferrer">
              developers.deezer.com
            </a>
            {' '}(or <code>DEEZER_APP_ID</code> env).
          </p>
          <input
            className="input font-mono text-sm"
            autoComplete="off"
            placeholder="Deezer Application ID (optional)"
            value={deezerAppId}
            onChange={(e) => setDeezerAppId(e.target.value)}
          />
          <label className="block text-sm text-[var(--muted)]">Default media provider</label>
          <select
            className="input"
            value={settings.mediaDefaultProvider === 'spotify' ? 'deezer' : settings.mediaDefaultProvider}
            onChange={(e) => setSettings({
              ...settings,
              mediaDefaultProvider: e.target.value as AppSettingsPublic['mediaDefaultProvider'],
            })}
          >
            <option value="deezer">Deezer — 30s previews</option>
            <option value="local">Local uploads only</option>
            <option value="covers">Legacy cover clips (YouTube)</option>
            <option value="apple_music_mock">Apple Music (mock)</option>
          </select>
        </section>

        <section id="passcode" className="panel p-5 space-y-4 scroll-mt-6">
          <p className="settings-section-label">Security (passcode)</p>
          <p className="text-xs text-[var(--muted)]">
            Set <code className="text-[var(--gold)]">HOST_PASSCODE</code> in <code>.env</code> to gate quiz/media/settings writes.
            The desktop app stores a local copy after you enter it once.
          </p>
          <button
            type="button"
            className="btn btn-ghost text-sm"
            onClick={() => {
              try {
                localStorage.removeItem('trivia-night:hostPasscode');
                setStatus('Cleared stored passcode');
              } catch {
                setError('Could not clear passcode');
              }
            }}
          >
            Clear stored passcode
          </button>
        </section>

        {error && <p className="text-[var(--danger)]">{error}</p>}
        {status && <p className="text-[var(--muted)]">{status}</p>}
        <button className="btn btn-lg w-full" type="submit">Save settings</button>
      </form>
    </AdminShell>
  );
}
