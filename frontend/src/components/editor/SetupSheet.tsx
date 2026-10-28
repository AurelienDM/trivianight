import { useEffect, useState } from 'react';
import { BookOpen, Layers, Sparkles, Users, X, Blend } from 'lucide-react';
import { hostFetch } from '../../lib/hostAuth';
import type { QuestionSource } from '@shared/types';

const SOURCES: Array<{ id: QuestionSource; label: string }> = [
  { id: 'blank', label: 'Blank' },
  { id: 'bank', label: 'Bank' },
  { id: 'ai', label: 'AI' },
  { id: 'both', label: 'Both' },
];

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="stepper-btn" onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Fewer ${label}`}>–</button>
        <span className="stepper-value">{value}</span>
        <button type="button" className="stepper-btn" onClick={() => onChange(Math.min(max, value + 1))} aria-label={`More ${label}`}>+</button>
      </div>
    </div>
  );
}

export default function SetupSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('Friday pub quiz');
  const [players, setPlayers] = useState(6);
  const [rounds, setRounds] = useState(5);
  const [perRound, setPerRound] = useState(8);
  const [source, setSource] = useState<QuestionSource>('both');
  const [librarySize, setLibrarySize] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    hostFetch('/api/bank?limit=1')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const size = Number(data.librarySize ?? data.total);
        setLibrarySize(Number.isFinite(size) ? size : 0);
      })
      .catch(() => {
        if (!cancelled) setLibrarySize(0);
      });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const slots = rounds * perRound;
  const bankTake = source === 'bank' || source === 'both'
    ? Math.min(librarySize ?? 0, slots)
    : 0;
  const aiTake = source === 'ai' ? slots : source === 'both' ? Math.max(0, slots - bankTake) : 0;
  const openSlots = source === 'blank' ? slots : source === 'bank' ? Math.max(0, slots - bankTake) : 0;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await hostFetch('/api/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'New quiz',
          roundCount: rounds,
          questionsPerRound: perRound,
          settings: {
            playerCount: players,
            questionsPerRound: perRound,
            questionSource: source,
            themeId: 'modern',
            allowMultipleChoice: true,
            defaultPoints: 1,
          },
        }),
      });
      if (!res.ok) {
        setError('Could not create the quiz');
        setBusy(false);
        return;
      }
      const quiz = await res.json();
      const fill = source === 'ai' || source === 'both' ? '?start=ai&fill=1' : '';
      window.location.href = `/editor/${quiz.id}${fill}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the quiz');
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="setup-title" className="text-2xl font-bold tracking-tight">New quiz</h2>
          <button type="button" className="btn btn-ghost !min-h-0 px-3 py-2" onClick={onClose} aria-label="Close">
            <X size={16} /> Close
          </button>
        </div>

        <div className="mt-5 grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <label className="block">
              <span className="text-xs font-semibold text-[var(--muted)]">Name</span>
              <input className="input mt-2" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <Stepper label="Players" hint="1 or more. Table size before you host." value={players} min={1} max={99} onChange={setPlayers} />
            <Stepper label="Rounds" hint="Creates this many rounds. 1 to 20." value={rounds} min={1} max={20} onChange={setRounds} />
            <Stepper label="Questions per round" hint="Default is 8. Empty slots can be drafted later." value={perRound} min={1} max={16} onChange={setPerRound} />
            <div>
              <p className="text-xs font-semibold text-[var(--muted)]">Questions</p>
              <div className="mt-2 grid grid-cols-4 gap-1 rounded-xl bg-[var(--bg-elevated)] p-1">
                {SOURCES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`rounded-lg px-2 py-2 text-sm font-semibold ${source === s.id ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
                    onClick={() => setSource(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <aside className="tonight">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Tonight</p>
            <ul className="mt-4 space-y-3 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[var(--muted)]"><Users size={16} /> Players</span>
                <strong>{players}</strong>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[var(--muted)]"><Layers size={16} /> Rounds</span>
                <strong>{rounds}</strong>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[var(--muted)]"><BookOpen size={16} /> From the bank</span>
                <strong>{librarySize == null ? '…' : bankTake}</strong>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[var(--muted)]"><Sparkles size={16} /> Haiku drafts</span>
                <strong>{librarySize == null && (source === 'bank' || source === 'both') ? '…' : aiTake}</strong>
              </li>
              {openSlots > 0 && (
                <li className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-[var(--muted)]"><Blend size={16} /> Left blank</span>
                  <strong>{openSlots}</strong>
                </li>
              )}
            </ul>
            <p className="mt-4 text-2xl font-bold tracking-tight">{slots} questions</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {source === 'blank' && 'Empty rounds. You write every question.'}
              {source === 'bank' && 'Least-used bank questions fill the slots. Anything left stays blank.'}
              {source === 'ai' && 'Haiku drafts every slot after you create the quiz. You still review before publish.'}
              {source === 'both' && 'The bank fills first. Haiku drafts the gaps. Sonnet is reserved for rewriting one question later.'}
            </p>
          </aside>
        </div>

        {error && <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>}
        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create quiz'}
          </button>
        </div>
      </div>
    </div>
  );
}
