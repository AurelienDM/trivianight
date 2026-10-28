/** Spoiler-safe YouTube embed — never shows title overlay before reveal. */

export default function YoutubeClip({
  youtubeId,
  url,
  revealMeta,
  title,
  artist,
  className,
}: {
  youtubeId?: string;
  url?: string;
  revealMeta?: boolean;
  title?: string;
  artist?: string;
  className?: string;
}) {
  const id =
    youtubeId ||
    (url?.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{11})/)?.[1]);

  if (!id && !url) return null;

  const src = id
    ? `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&autoplay=0`
    : url;

  return (
    <div className={className}>
      <div className="relative aspect-video w-full max-w-3xl mx-auto overflow-hidden rounded-2xl bg-black/60">
        <iframe
          title={revealMeta ? title || 'Clip' : 'Quiz clip'}
          src={src}
          className="absolute inset-0 h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      {revealMeta && (title || artist) && (
        <p className="mt-3 text-center text-[var(--gold)]">
          {[title, artist].filter(Boolean).join(' — ')}
        </p>
      )}
      {!revealMeta && (
        <p className="mt-3 text-center text-[var(--muted)]">♪ Clip playing — title hidden until reveal</p>
      )}
    </div>
  );
}
