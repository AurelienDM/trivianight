import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Download, Layers, Pencil, Play, Plus, Radio, Search, Trash2 } from 'lucide-react';
import { hostFetch } from '../lib/hostAuth';
import { askConfirm } from '../lib/dialogs';
import AdminShell from '../components/admin/AdminShell';
import SetupSheet from '../components/editor/SetupSheet';

interface QuizSummary {
  id: string;
  name: string;
  description?: string;
  roundCount: number;
  questionCount: number;
  playerCount?: number;
  questionSource?: string;
  updatedAt: string;
}

interface ActiveRoom {
  roomCode: string;
  pin: string;
  quizId: string;
  quizName: string;
  phase: string;
  teamCount: number;
  roundIndex: number;
  totalRounds: number;
}

type Filter = 'all' | 'live' | 'ready';

export default function Dashboard() {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [rooms, setRooms] = useState<ActiveRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sheetOpen, setSheetOpen] = useState(() => window.location.hash === '#new');
  const [rejoinCode, setRejoinCode] = useState('');

  async function loadQuizzes() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/quizzes');
      if (!res.ok) throw new Error('Failed to load quizzes');
      setQuizzes(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadRooms() {
    try {
      const res = await fetch('/api/rooms');
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.rooms)) setRooms(data.rooms);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void loadQuizzes();
    void loadRooms();
    const id = setInterval(() => void loadRooms(), 8000);
    return () => clearInterval(id);
  }, []);

  async function importJson(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await hostFetch('/api/quizzes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, id: undefined }),
      });
      if (!res.ok) {
        setError('Import failed');
        return;
      }
      const created = await res.json();
      window.location.href = `/editor/${created.id}`;
    } catch {
      setError('Import failed — invalid JSON');
    }
  }

  async function deleteQuiz(q: QuizSummary, force = false) {
    if (!force) {
      const ok = await askConfirm(`Delete “${q.name}”? This cannot be undone.`);
      if (!ok) return;
    }
    const res = await hostFetch(`/api/quizzes/${q.id}${force ? '?force=1' : ''}`, { method: 'DELETE' });
    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      const roomsList = Array.isArray(data.rooms) ? data.rooms.join(', ') : 'active rooms';
      const forceOk = await askConfirm(
        `Quiz is in use by room(s): ${roomsList}.\n\nForce delete closes those rooms and removes the quiz?`,
      );
      if (forceOk) return deleteQuiz(q, true);
      return;
    }
    if (!res.ok) {
      setError('Delete failed');
      return;
    }
    setStatus(`Deleted “${q.name}”`);
    setTimeout(() => setStatus(null), 2000);
    await loadQuizzes();
    await loadRooms();
  }

  async function loadFull(id: string) {
    const res = await fetch(`/api/quizzes/${id}`);
    if (!res.ok) throw new Error('Could not load quiz');
    return res.json();
  }

  async function duplicateQuiz(q: QuizSummary) {
    try {
      const full = await loadFull(q.id);
      const res = await hostFetch('/api/quizzes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...full, name: `Copy of ${full.name}`, id: undefined }),
      });
      if (!res.ok) {
        setError('Duplicate failed');
        return;
      }
      setStatus(`Copied “${q.name}”`);
      setTimeout(() => setStatus(null), 2000);
      await loadQuizzes();
    } catch {
      setError('Duplicate failed');
    }
  }

  async function exportQuiz(q: QuizSummary) {
    try {
      const full = await loadFull(q.id);
      const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${q.name.replace(/\s+/g, '-').toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed');
    }
  }

  const liveByQuiz = new Map(rooms.map((r) => [r.quizId, r]));
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => quizzes.filter((q) => {
    const live = liveByQuiz.has(q.id);
    if (filter === 'live' && !live) return false;
    if (filter === 'ready' && live) return false;
    if (needle && !q.name.toLowerCase().includes(needle)) return false;
    return true;
  }), [quizzes, filter, needle, rooms]);

  return (
    <AdminShell contentClassName="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="admin-page-title">Quizzes</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {quizzes.length} saved{rooms.length > 0 ? ` · ${rooms.length} live` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input !pl-9 w-56"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className="btn" type="button" onClick={() => setSheetOpen(true)}>
            <Plus size={16} /> New quiz
          </button>
          <label className="btn btn-ghost cursor-pointer">
            Import
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importJson(f);
              }}
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['all', 'All'],
          ['live', 'Live'],
          ['ready', 'Ready'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`chip ${filter === id ? 'chip--active' : ''}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {rooms.length > 0 && (
        <section className="space-y-2">
          {rooms.map((r) => (
            <div key={r.roomCode} className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--danger)]">
                  <Radio size={14} /> Live now
                </p>
                <p className="mt-0.5 truncate text-sm font-semibold">
                  {r.quizName}
                  <span className="font-normal text-[var(--muted)]">
                    {' · '}room {r.roomCode}
                    {' · '}{r.teamCount} team{r.teamCount === 1 ? '' : 's'}
                    {' · '}round {r.roundIndex + 1} of {r.totalRounds}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link className="btn !min-h-0 px-3 py-2 text-sm" to={`/host/room/${r.roomCode}`}>Open host</Link>
                <a className="btn btn-ghost !min-h-0 px-3 py-2 text-sm" href={`/tv/${r.roomCode}`} target="_blank" rel="noreferrer">TV</a>
              </div>
            </div>
          ))}
        </section>
      )}

      {loading && <p className="text-[var(--muted)]">Loading…</p>}
      {error && <p className="text-[var(--danger)]">{error}</p>}
      {status && <p className="text-sm text-[var(--muted)]">{status}</p>}
      {!loading && !error && visible.length === 0 && (
        <div className="panel p-8 text-center">
          <p className="text-[var(--muted)]">No quizzes in this view. Start a new one when you are ready.</p>
        </div>
      )}

      <ul className="space-y-2">
        {visible.map((q) => {
          const live = liveByQuiz.get(q.id);
          return (
            <li key={q.id} className="panel flex flex-wrap items-center gap-3 px-4 py-3">
              <Layers size={18} className="text-[var(--accent)] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{q.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {q.roundCount} rounds · {q.questionCount} questions
                  {q.playerCount ? ` · ${q.playerCount} players` : ''}
                </p>
              </div>
              <p className={`text-sm ${live ? 'font-semibold text-[var(--danger)]' : 'text-[var(--muted)]'}`}>
                {live ? `Live · room ${live.roomCode}` : 'Ready to host'}
              </p>
              <div className="flex items-center gap-1">
                {live ? (
                  <Link className="icon-btn" to={`/host/room/${live.roomCode}`} aria-label="Open host"><Play size={16} /></Link>
                ) : (
                  <Link className="icon-btn" to={`/host/${q.id}`} aria-label="Host"><Play size={16} /></Link>
                )}
                <Link className="icon-btn" to={`/editor/${q.id}`} aria-label="Edit"><Pencil size={16} /></Link>
                <button className="icon-btn" type="button" aria-label="Duplicate" onClick={() => void duplicateQuiz(q)}><Copy size={16} /></button>
                <button className="icon-btn" type="button" aria-label="Export" onClick={() => void exportQuiz(q)}><Download size={16} /></button>
                <button className="icon-btn icon-btn--danger" type="button" aria-label="Delete" onClick={() => void deleteQuiz(q)}><Trash2 size={16} /></button>
              </div>
            </li>
          );
        })}
      </ul>

      <section className="panel flex flex-wrap items-center gap-2 px-4 py-3">
        <p className="text-sm font-semibold text-[var(--muted)]">Rejoin host</p>
        <input
          className="input w-40 uppercase tracking-widest"
          placeholder="ROOM"
          value={rejoinCode}
          maxLength={8}
          onChange={(e) => setRejoinCode(e.target.value.toUpperCase())}
        />
        <button
          className="btn btn-ghost"
          type="button"
          disabled={!rejoinCode.trim()}
          onClick={() => navigate(`/host/room/${rejoinCode.trim().toUpperCase()}`)}
        >
          Open host
        </button>
      </section>

      <SetupSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </AdminShell>
  );
}
