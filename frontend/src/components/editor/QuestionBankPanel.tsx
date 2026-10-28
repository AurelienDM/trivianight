import { useEffect, useState } from 'react';
import { hostFetch } from '../../lib/hostAuth';
import type { Question, QuestionType } from '@shared/types';
import {
  BANK_THEME_IDS,
  BANK_THEME_LABELS,
  type BankThemeId,
} from '@shared/bankThemes';
import BankQuestionCard, { type BankCardItem } from '../bank/BankQuestionCard';

interface ThemeCount {
  id: BankThemeId;
  label: string;
  count: number;
}

export default function QuestionBankPanel({
  onAddToRound,
  forceOpen,
}: {
  onAddToRound: (questions: Question[]) => void;
  /** When true (e.g. Dashboard ?start=bank), open the browse panel. */
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!forceOpen);
  const [q, setQ] = useState('');
  const [theme, setTheme] = useState('all');
  const [items, setItems] = useState<BankCardItem[]>([]);
  const [themes, setThemes] = useState<ThemeCount[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);

  async function load(search = q, nextTheme = theme) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '40' });
      if (search.trim()) params.set('q', search.trim());
      if (nextTheme && nextTheme !== 'all') params.set('theme', nextTheme);
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
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  useEffect(() => {
    if (open) void load();
  }, [open]);

  async function addSelected() {
    const picked = items.filter((i) => selected[i.id]);
    if (!picked.length) {
      setError('Select at least one bank item');
      return;
    }
    const questions: Question[] = picked.map((i) => ({
      id: crypto.randomUUID(),
      type: (i.type as QuestionType) || 'open',
      prompt: i.prompt,
      points: i.points && i.points > 0 ? i.points : 1,
      acceptedAnswers: i.acceptedAnswers?.length ? i.acceptedAnswers : [''],
      choices: i.choices,
      media: i.media,
      notes: i.notes ? `${i.notes}\nFrom question bank` : 'From question bank',
    }));
    onAddToRound(questions);
    try {
      await hostFetch('/api/bank/record-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: picked.map((i) => i.id) }),
      });
    } catch {
      /* non-blocking */
    }
    setSelected({});
    setError(null);
    void load();
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

  if (!open) {
    return (
      <div className="panel p-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Question bank</h3>
          <p className="text-xs text-[var(--gold)] mt-0.5">
            Expand for full preview. Usage counts on Add from bank.
          </p>
        </div>
        <button className="btn btn-ghost text-sm" type="button" onClick={() => setOpen(true)}>
          Browse bank
        </button>
      </div>
    );
  }

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Question bank</h3>
          <p className="text-xs text-[var(--muted)]">
            Persistent store ({total} item{total === 1 ? '' : 's'}
            {path ? <> · <code className="text-[var(--gold)]">{path}</code></> : null}).
          </p>
        </div>
        <button className="btn btn-ghost text-sm" type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Search prompt or answer…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void load())}
        />
        <button className="btn btn-ghost text-sm" type="button" disabled={busy} onClick={() => void load()}>
          Search
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={`chip ${theme === 'all' ? 'chip--active' : ''}`}
          onClick={() => { setTheme('all'); void load(q, 'all'); }}
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
            onClick={() => { setTheme(t.id); void load(q, t.id); }}
          >
            {t.label}
            {t.count > 0 && <span className="chip__count">{t.count}</span>}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      <div className="max-h-80 overflow-y-auto space-y-2">
        {!items.length && !busy && (
          <p className="text-sm text-[var(--muted)]">No bank items yet — generate with AI or open /bank.</p>
        )}
        {items.map((i) => (
          <BankQuestionCard
            key={i.id}
            item={i}
            expanded={expandedId === i.id}
            onToggle={() => setExpandedId((cur) => (cur === i.id ? null : i.id))}
            selectable
            selected={!!selected[i.id]}
            onSelectedChange={(next) => setSelected({ ...selected, [i.id]: next })}
            onRemove={() => void removeItem(i.id)}
          />
        ))}
      </div>

      <button className="btn text-sm" type="button" disabled={busy} onClick={() => void addSelected()}>
        Add from bank to round
      </button>
    </div>
  );
}
