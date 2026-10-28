import { QRCodeSVG } from 'qrcode.react';

export default function JoinQr({
  url,
  size = 160,
  label,
}: {
  url: string;
  size?: number;
  label?: string;
}) {
  if (!url) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-xl bg-white p-3">
        <QRCodeSVG value={url} size={size} level="M" includeMargin={false} />
      </div>
      {label && <p className="text-xs text-center text-[var(--muted)] max-w-[200px] break-all">{label}</p>}
    </div>
  );
}
