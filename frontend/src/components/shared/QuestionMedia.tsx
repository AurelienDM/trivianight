import { useEffect, useState } from 'react';
import type { MediaRef } from '@shared/types';
import YoutubeClip from './YoutubeClip';

function toProxiedLogoSrc(url: string): string {
  if (url.startsWith('/api/logos/img') || url.startsWith('/media/')) return url;
  if (/^https?:\/\//i.test(url)) {
    return `/api/logos/img?u=${encodeURIComponent(url)}`;
  }
  return url;
}

function LogoImage({
  url,
  className,
  imgClassName,
  revealMeta,
  title,
}: {
  url: string;
  className?: string;
  imgClassName?: string;
  revealMeta?: boolean;
  title?: string;
}) {
  const preferred = toProxiedLogoSrc(url);
  const [src, setSrc] = useState(preferred);
  const [triedProxyFallback, setTriedProxyFallback] = useState(false);

  useEffect(() => {
    setSrc(toProxiedLogoSrc(url));
    setTriedProxyFallback(false);
  }, [url]);

  return (
    <div className={`${className ?? ''} w-full max-w-2xl mx-auto`.trim()}>
      <div className="rounded-3xl bg-white px-8 py-10 md:px-14 md:py-14 shadow-lg flex items-center justify-center min-h-[28vh]">
        <img
          src={src}
          alt=""
          className={imgClassName ?? 'max-h-[36vh] max-w-full w-auto object-contain'}
          onError={() => {
            if (!triedProxyFallback && !url.startsWith('/api/logos/img') && /^https?:\/\//i.test(url)) {
              setTriedProxyFallback(true);
              setSrc(`/api/logos/img?u=${encodeURIComponent(url)}`);
            }
          }}
        />
      </div>
      {revealMeta && title ? (
        <p className="mt-3 text-center text-lg text-[var(--muted)]">{title}</p>
      ) : null}
    </div>
  );
}

/** Shared Host/TV media renderer — Deezer preview first; brand logos on white panel; legacy paths still render. */
export default function QuestionMedia({
  media,
  revealMeta = false,
  className,
  logoPanel,
}: {
  media?: MediaRef | null;
  revealMeta?: boolean;
  className?: string;
  /** Force large white-panel logo treatment (brand_logo questions) */
  logoPanel?: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(media?.previewUrl);

  useEffect(() => {
    setPreviewUrl(media?.previewUrl);
    const trackId = media?.deezerTrackId || media?.spotifyTrackId;
    if (!trackId || media.previewUrl) return;
    let cancelled = false;
    const path = media.deezerTrackId
      ? `/api/deezer/preview/${encodeURIComponent(media.deezerTrackId)}`
      : `/api/spotify/preview/${encodeURIComponent(media.spotifyTrackId!)}`;
    fetch(path)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.previewUrl) setPreviewUrl(d.previewUrl);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [media?.deezerTrackId, media?.spotifyTrackId, media?.previewUrl]);

  if (!media) return null;

  const isPreview =
    media.kind === 'deezer'
    || media.kind === 'spotify'
    || !!media.deezerTrackId
    || !!media.spotifyTrackId
    || (!!media.previewUrl && media.kind !== 'youtube');

  if (isPreview && (media.kind === 'deezer' || media.kind === 'spotify' || media.deezerTrackId || media.spotifyTrackId || media.previewUrl)) {
    const src = previewUrl || media.previewUrl;
    const label = media.kind === 'spotify' ? 'Spotify preview' : 'Deezer preview';
    return (
      <div className={`${className ?? ''} w-full max-w-xl mx-auto space-y-3`.trim()}>
        <div className="rounded-2xl bg-black/40 border border-white/10 px-5 py-6 text-center">
          <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">{label}</p>
          {revealMeta ? (
            <p className="mt-2 text-xl font-medium">
              {media.title ?? 'Track'}
              {media.artist ? <span className="text-[var(--muted)]"> — {media.artist}</span> : null}
            </p>
          ) : (
            <p className="mt-2 text-lg text-[var(--muted)]">♪ Listen &amp; name that tune</p>
          )}
          {src ? (
            <audio className="mt-4 w-full" src={src} controls autoPlay={false} />
          ) : (
            <p className="mt-4 text-sm text-[var(--muted)]">
              Preview unavailable — pick another track in the editor.
            </p>
          )}
        </div>
      </div>
    );
  }

  const hasYoutube = !!(media.youtubeId || media.kind === 'youtube' || media.url?.includes('youtu'));
  if (hasYoutube && (media.youtubeId || media.url)) {
    return (
      <YoutubeClip
        className={className}
        youtubeId={media.youtubeId}
        url={media.url}
        revealMeta={revealMeta}
        title={media.title}
        artist={media.artist}
      />
    );
  }

  const treatAsLogo = !!(
    logoPanel
    || media.brandKey
    || (media.kind === 'image' && media.domain)
  );

  if (media.url && media.kind === 'image' && treatAsLogo) {
    return (
      <LogoImage
        url={media.url}
        className={className}
        revealMeta={revealMeta}
        title={media.title}
      />
    );
  }

  if (media.url && media.kind === 'image') {
    return (
      <img
        src={media.url}
        alt=""
        className={`${className ?? ''} max-h-[40vh] mx-auto rounded-2xl object-contain`.trim()}
      />
    );
  }

  if (media.url && media.kind === 'video') {
    return (
      <video
        src={media.url}
        className={`${className ?? ''} max-h-[40vh] mx-auto rounded-2xl w-full`.trim()}
        controls
      />
    );
  }

  if (media.url && (media.kind === 'audio' || media.kind === 'apple_music')) {
    return <audio src={media.url} className={`${className ?? ''} w-full`.trim()} controls />;
  }

  return null;
}
