import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Sparkles } from 'lucide-react';
import CardDealer, { type DealtCard } from '../components/editor/CardDealer';
import { hostFetch } from '../lib/hostAuth';
import AdminShell from '../components/admin/AdminShell';
import BankQuestionCard, { type BankCardItem } from '../components/bank/BankQuestionCard';
import {
  BANK_THEME_IDS,
  BANK_THEME_LABELS,
  type BankThemeId,
} from '@shared/bankThemes';

interface ThemeCount {
  id: BankThemeId;
  label: string;
  count: number;
}

export default function Bank() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('any');
  const [theme, setTheme] = useState<string>('all');
  const [items, setItems] = useState<BankCardItem[]>([]);
  const [themes, setThemes] = useState<ThemeCount[]>([]);
  const [total, setTotal] = useState(0);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genCount, setGenCount] = useState(6);
  const [genTheme, setGenTheme] = useState<BankThemeId>('general');
  const [genType, setGenType] = useState('any');
  const [genBusy, setGenBusy] = useState(false);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const [dealt, setDealt] = useState<DealtCard[]>([]);
  const [aiLabel, setAiLabel] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [fetchBusyId, setFetchBusyId] = useState<string | null>(null);

  async function loadAiStatus() {
    try {
      const res = await hostFetch('/api/ai/status');
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.configured) {
        setAiLabel(`${data.provider || 'ai'} / ${data.model || 'default'}`);
      } else {
        setAiLabel(null);
      }
    } catch {
      setAiLabel(null);
    }
  }

  async function load(nextTheme = theme, search = q, nextType = type) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (search.trim()) params.set('q', search.trim());
      if (nextTheme && nextTheme !== 'all') params.set('theme', nextTheme);
      if (nextType && nextType !== 'any') params.set('type', nextType);
      const res = await hostFetch(`/api/bank?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to load bank');
        setItems([]);
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total) || 0);
      setThemes(Array.isArray(data.themes) ? data.themes : []);
      setPath(typeof data.path === 'string' ? data.path : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    void loadAiStatus();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<BankThemeId, BankCardItem[]>();
    for (const id of BANK_THEME_IDS) map.set(id, []);
    for (const item of items) {
      const t = (BANK_THEME_IDS as readonly string[]).includes(String(item.theme))
        ? (item.theme as BankThemeId)
        : 'other';
      map.get(t)!.push(item);
    }
    return BANK_THEME_IDS
      .map((id) => ({ id, label: BANK_THEME_LABELS[id], items: map.get(id) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [items]);

  async function generateIntoBank() {
    setGenBusy(true);
    setError(null);
    setGenStatus(null);
    setDealt([]);
    const beforeIds = new Set(items.map((i) => i.id));
    try {
      const themeLabel = BANK_THEME_LABELS[genTheme];
      const res = await hostFetch('/api/ai/author', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: themeLabel,
          category: themeLabel,
          difficulty: 'medium',
          questionType: genType === 'any' ? undefined : genType,
          count: genCount,
          job: 'bulk',
          roundMode: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429 || data.code === 'rate_limited') {
        setError(data.error || data.hint || 'AI rate limited — wait, then try once.');
        return;
      }
      if (!res.ok) {
        setError(data.hint || data.error || 'Generate failed');
        return;
      }
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      setDealt(suggestions.map((s: { id?: string; prompt?: string; type?: string }, i: number) => ({
        id: String(s.id || i),
        prompt: String(s.prompt || 'Draft'),
        type: s.type,
      })));
      const n = suggestions.length;
      const mediaN = typeof data.mediaAttached === 'number' ? data.mediaAttached : 0;
      const added = typeof data.bankAdded === 'number' ? data.bankAdded : n;
      setGenStatus(
        n
          ? `Generated ${n} · bank +${added} · media attached ${mediaN} (usage stays 0 until Add from bank).`
          : 'No drafts returned',
      );
      await load();
      const listRes = await hostFetch(`/api/bank?limit=100`);
      const listData = await listRes.json().catch(() => ({}));
      if (listRes.ok && Array.isArray(listData.items)) {
        const next: BankCardItem[] = listData.items;
        const fresh = new Set(next.filter((i) => !beforeIds.has(i.id)).map((i) => i.id));
        setHighlightIds(fresh);
        if (fresh.size) {
          const first = [...fresh][0];
          setExpandedId(first);
          setTimeout(() => setHighlightIds(new Set()), 8000);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setGenBusy(false);
    }
  }

  async function removeItem(id: string) {
    setBusy(true);
    try {
      const res = await hostFetch(`/api/bank/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        setError('Delete failed');
        return;
      }
      if (expandedId === id) setExpandedId(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function fetchMedia(id: string) {
    setFetchBusyId(id);
    setError(null);
    try {
      const res = await hostFetch(`/api/bank/${id}/attach-media`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Fetch media failed');
        return;
      }
      await load();
      setExpandedId(id);
    } finally {
      setFetchBusyId(null);
    }
  }

  return (
    <AdminShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="admin-page-title">Question bank</h1>
          <p className="mt-2 text-sm text-[var(--muted)] max-w-xl">
            Expand any item to see the full question — choices, media, answers, usage.
            {path ? (
              <> Stored in <code className="text-[var(--gold)]">{path}</code>.</>
            ) : null}
          </p>
        </div>
        <button
          className="btn"
          type="button"
          onClick={() => setShowGenerate((v) => !v)}
        >
          <Sparkles size={16} />
          Generate
        </button>
      </div>

      {showGenerate && (
        <section className="panel p-4 md:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Generate</p>
              <h2 className="font-semibold text-lg mt-1">Generate questions into bank</h2>
              <p className="text-xs text-[var(--muted)] mt-1">
                {aiLabel
                  ? `Uses Settings AI: ${aiLabel}`
                  : 'Configure an AI key in Settings before generating.'}
              </p>
            </div>
            <Link className="btn btn-ghost text-sm" to="/settings">AI settings</Link>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-sm text-[var(--muted)]">
              Count
              <select
                className="input mt-1 w-auto block"
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value))}
              >
                {[3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-[var(--muted)]">
              Theme
              <select
                className="input mt-1 w-auto block"
                value={genTheme}
                onChange={(e) => setGenTheme(e.target.value as BankThemeId)}
              >
                {BANK_THEME_IDS.map((id) => (
                  <option key={id} value={id}>{BANK_THEME_LABELS[id]}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-[var(--muted)]">
              Type
              <select
                className="input mt-1 w-auto block"
                value={genType}
                onChange={(e) => setGenType(e.target.value)}
              >
                <option value="any">Any</option>
                <option value="open">open</option>
                <option value="music">music</option>
                <option value="brand_logo">brand_logo</option>
                <option value="multiple_choice">multiple_choice</option>
                <option value="numeric">numeric</option>
                <option value="ordering">ordering</option>
                <option value="image">image</option>
              </select>
            </label>
            <button
              className="btn"
              type="button"
              disabled={genBusy || !aiLabel}
              onClick={() => void generateIntoBank()}
            >
              <Sparkles size={16} />
              {genBusy ? 'Generating…' : 'Generate into bank'}
            </button>
          </div>
          <CardDealer
            slots={genCount}
            revealed={dealt}
            model="Haiku"
            busy={genBusy}
            detail={genBusy ? 'Dealing a batch into the bank…' : genStatus}
          />
          {genStatus && <p className="text-sm text-[var(--muted)]">{genStatus}</p>}
        </section>
      )}

      <div className="panel p-4 space-y-3">
        <input
          className="input"
          placeholder="Search prompt or answer…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void load())}
        />
        <div className="flex flex-wrap gap-2 items-center">
          <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="any">Any type</option>
            <option value="open">open</option>
            <option value="music">music</option>
            <option value="brand_logo">brand_logo</option>
            <option value="multiple_choice">multiple_choice</option>
            <option value="numeric">numeric</option>
            <option value="ordering">ordering</option>
            <option value="image">image</option>
          </select>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void load()}>
            <Search size={16} />
            Search
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`chip ${theme === 'all' ? 'chip--active' : ''}`}
            onClick={() => { setTheme('all'); void load('all'); }}
          >
            All
          </button>
          {(themes.length ? themes : BANK_THEME_IDS.map((id) => ({
            id,
            label: BANK_THEME_LABELS[id],
            count: 0,
          }))).map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chip ${theme === t.id ? 'chip--active' : ''}`}
              onClick={() => { setTheme(t.id); void load(t.id); }}
            >
              {t.label}
              {t.count > 0 && <span className="chip__count">· {t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-[var(--danger)]">{error}</p>}
      <p className="text-sm text-[var(--muted)]">
        {busy ? 'Loading…' : `${total} matching · click a row to expand`}
      </p>

      <div className="space-y-8">
        {grouped.map((g) => (
          <section key={g.id} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="chip chip--active uppercase tracking-wide text-xs">
                {g.label} <span className="chip__count">· {g.items.length}</span>
              </span>
            </div>
            <ul className="space-y-2">
              {g.items.map((i) => (
                <li key={i.id}>
                  <BankQuestionCard
                    item={i}
                    expanded={expandedId === i.id}
                    onToggle={() => setExpandedId((cur) => (cur === i.id ? null : i.id))}
                    onRemove={() => void removeItem(i.id)}
                    onFetchMedia={() => void fetchMedia(i.id)}
                    fetchBusy={fetchBusyId === i.id}
                    highlight={highlightIds.has(i.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!busy && !grouped.length && (
          <p className="text-[var(--muted)]">No bank items yet — use Generate or AI in the Editor.</p>
        )}
      </div>
    </AdminShell>
  );
}
