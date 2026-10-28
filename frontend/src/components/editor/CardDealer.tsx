import { useEffect, useState } from 'react';
import { CheckCircle2, Layers, Sparkles, Wand2 } from 'lucide-react';

export type DealtCard = { id: string; prompt: string; type?: string };

const LINES = [
  'Shuffling the deck…',
  'Dealing this round…',
  'Keeping the easy ones friendly…',
  'Checking the loud facts…',
];

export default function CardDealer({
  slots,
  revealed,
  model,
  busy,
  detail,
}: {
  slots: number;
  revealed: DealtCard[];
  model: 'Haiku' | 'Sonnet';
  busy: boolean;
  detail?: string | null;
}) {
  const [line, setLine] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setLine((n) => (n + 1) % LINES.length), 2200);
    return () => window.clearInterval(id);
  }, [busy]);

  const count = Math.min(8, Math.max(1, slots, revealed.length > 8 ? 8 : revealed.length));
  const extra = Math.max(0, Math.max(slots, revealed.length) - count);
  const status = busy
    ? (detail?.trim() || LINES[line])
    : revealed.length
      ? `${revealed.length} face up. Review before you publish.`
      : 'Face down until the draft arrives.';

  return (
    <div className="deal-board" aria-live="polite">
      <div className="deal-board__bar">
        <span className={`deal-badge ${model === 'Haiku' ? 'deal-badge--haiku' : 'deal-badge--sonnet'}`}>
          {model === 'Haiku' ? <Sparkles size={14} aria-hidden /> : <Wand2 size={14} aria-hidden />}
          {model}
        </span>
        <span className="deal-board__status">
          {busy ? <Layers size={14} aria-hidden /> : <CheckCircle2 size={14} aria-hidden />}
          {status}
        </span>
      </div>
      <div className="deal-grid">
        {Array.from({ length: count }).map((_, i) => {
          const card = revealed[i];
          return (
            <article
              key={card?.id ?? `slot-${i}`}
              className={`deal-card ${card ? 'deal-card--up' : 'deal-card--down'} ${busy && !card ? 'deal-card--live' : ''}`}
              style={card ? { animationDelay: `${i * 90}ms` } : undefined}
            >
              {card ? (
                <>
                  <p className="deal-card__kicker">{card.type ? card.type.replace('_', ' ') : `Q${i + 1}`}</p>
                  <p className="deal-card__prompt">{card.prompt}</p>
                </>
              ) : (
                <span className="deal-card__back">Face down</span>
              )}
            </article>
          );
        })}
      </div>
      {extra > 0 && (
        <p className="deal-board__more">+{extra} more in this deal</p>
      )}
    </div>
  );
}
