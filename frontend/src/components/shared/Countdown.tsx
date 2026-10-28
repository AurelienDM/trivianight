import { useEffect, useState } from 'react';

/** Live countdown from an absolute endsAt timestamp (ticks every 250ms). */
export default function Countdown({
  endsAt,
  className,
}: {
  endsAt: number | null | undefined;
  className?: string;
}) {
  const [remaining, setRemaining] = useState(() =>
    endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null,
  );

  useEffect(() => {
    if (!endsAt) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  if (remaining == null) return null;

  return (
    <p className={className ?? 'mt-6 text-center display text-5xl text-[var(--accent-2)]'}>
      {remaining}s
    </p>
  );
}
