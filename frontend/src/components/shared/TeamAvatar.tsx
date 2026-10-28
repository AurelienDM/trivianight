/** Small circular team selfie / color fallback. */
export default function TeamAvatar({
  name,
  color,
  avatarUrl,
  size = 36,
}: {
  name: string;
  color: string;
  avatarUrl?: string;
  size?: number;
}) {
  const style = {
    width: size,
    height: size,
    background: avatarUrl ? undefined : color,
  } as const;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="rounded-full object-cover shrink-0 border-2"
        style={{ ...style, borderColor: color }}
      />
    );
  }

  return (
    <span
      className="inline-flex items-center justify-center rounded-full shrink-0 text-xs font-bold text-white"
      style={style}
      aria-hidden
    >
      {(name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}
