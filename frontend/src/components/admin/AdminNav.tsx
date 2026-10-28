import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Check,
  Layers,
  LayoutGrid,
  Library,
  Music,
  Palette,
  Play,
  QrCode,
  Radio,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Tv,
  Users,
} from 'lucide-react';
import { hostFetch } from '../../lib/hostAuth';
import type { ThemeId } from '@shared/types';
import { isThemeId } from '@shared/types';
import { THEME_OPTIONS } from '../../hooks/useRoomTheme';

const MAIN = [
  { to: '/', label: 'Quizzes', icon: LayoutGrid, countKey: 'quizzes' as const, match: (p: string) => p === '/' || p.startsWith('/editor') },
  { to: '/bank', label: 'Question bank', icon: Library, countKey: 'bank' as const, match: (p: string) => p.startsWith('/bank') },
  { to: '/settings', label: 'Settings', icon: Settings, countKey: null, match: (p: string) => p.startsWith('/settings') },
] as const;

const SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Sun },
  { id: 'join', label: 'Join & QR', icon: QrCode },
  { id: 'grading', label: 'Grading', icon: Check },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'passcode', label: 'Passcode', icon: Shield },
] as const;

const SKIN_COLORS: Record<ThemeId, string> = {
  modern: '#7c5cfc',
  classic: '#c9a227',
  minimal: '#5b8def',
  neon: '#ff2bd6',
  arcade: '#7dff4d',
};

interface LiveRoom {
  roomCode: string;
  quizId: string;
  quizName: string;
  phase: string;
  teamCount: number;
  roundIndex: number;
  totalRounds: number;
}

interface QuizHit {
  id: string;
  name: string;
  updatedAt?: string;
}

/** On-air command rail. The studio stays warm; these swatches set the stage skin. */
export default function AdminNav() {
  const { pathname, hash } = useLocation();
  const onSettings = pathname.startsWith('/settings');
  const activeHash = (hash || '#appearance').replace('#', '');
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [quizCount, setQuizCount] = useState<number | null>(null);
  const [bankCount, setBankCount] = useState<number | null>(null);
  const [hostQuiz, setHostQuiz] = useState<QuizHit | null>(null);
  const [skin, setSkin] = useState<ThemeId>('modern');

  useEffect(() => {
    let cancelled = false;
    async function loadRooms() {
      try {
        const res = await fetch('/api/rooms');
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.rooms)) setRooms(data.rooms);
      } catch { /* ignore */ }
    }
    async function loadCounts() {
      try {
        const res = await fetch('/api/quizzes');
        const data = await res.json().catch(() => []);
        if (!cancelled && res.ok && Array.isArray(data)) {
          setQuizCount(data.length);
          const sorted = [...data].sort((a: QuizHit, b: QuizHit) =>
            String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
          );
          setHostQuiz(sorted[0] ?? null);
        }
      } catch { /* ignore */ }
      try {
        const res = await hostFetch('/api/bank?limit=1');
        const data = await res.json().catch(() => ({}));
        const n = Number(data.librarySize ?? data.total);
        if (!cancelled && res.ok && Number.isFinite(n)) setBankCount(n);
      } catch { /* ignore */ }
    }
    async function loadSkin() {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json().catch(() => ({}));
        if (!cancelled && isThemeId(data.uiThemeId)) setSkin(data.uiThemeId);
      } catch { /* ignore */ }
    }
    void loadRooms();
    void loadCounts();
    void loadSkin();
    const timer = window.setInterval(() => void loadRooms(), 8000);
    function onTheme(ev: Event) {
      const id = (ev as CustomEvent<string>).detail;
      if (isThemeId(id)) setSkin(id);
    }
    window.addEventListener('trivia-theme', onTheme);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('trivia-theme', onTheme);
    };
  }, []);

  async function pickSkin(id: ThemeId) {
    setSkin(id);
    window.dispatchEvent(new CustomEvent('trivia-theme', { detail: id }));
    try {
      await hostFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uiThemeId: id }),
      });
    } catch { /* the swatch still previews locally */ }
  }

  const room = rooms[0];
  const skinLabel = THEME_OPTIONS.find((t) => t.id === skin)?.label ?? 'Modern';
  const counts = { quizzes: quizCount, bank: bankCount };

  return (
    <nav className="studio-nav" aria-label="Studio">
      <p className="studio-nav__brand">Trivia Night</p>
      {room ? (
        <div className="on-air">
          <p className="on-air__badge"><Radio size={13} aria-hidden /> On air</p>
          <p className="on-air__code">{room.roomCode}</p>
          <p className="truncate text-xs text-[#e7d3c4]">{room.quizName}</p>
          <div className="on-air__meta">
            <span><Layers size={13} aria-hidden /> Round {room.roundIndex + 1} of {room.totalRounds || '–'} · {room.phase.replace('_', ' ')}</span>
            <span><Users size={13} aria-hidden /> {room.teamCount} team{room.teamCount === 1 ? '' : 's'}</span>
          </div>
          <div className="on-air__actions">
            <Link className="btn" to={`/host/room/${room.roomCode}`}><Play size={14} aria-hidden /> Host</Link>
            <a className="btn btn-ghost" href={`/tv/${room.roomCode}`} target="_blank" rel="noreferrer" style={{ color: '#fbf6ee', borderColor: 'rgba(255,255,255,0.2)' }}>
              <Tv size={14} aria-hidden /> TV
            </a>
          </div>
        </div>
      ) : (
        <div className="on-air on-air--quiet">
          <p className="on-air__badge"><Radio size={13} aria-hidden /> No room yet</p>
          {hostQuiz ? (
            <Link className="btn mt-3 w-full !min-h-0 py-2 text-sm" to={`/host/${hostQuiz.id}`}>
              <Play size={14} aria-hidden /> Host {hostQuiz.name}
            </Link>
          ) : (
            <p className="on-air__meta"><span>Open a quiz when you are ready to host.</span></p>
          )}
        </div>
      )}

      <div className="studio-nav__scroll">
        <ul className="studio-nav__list">
          {MAIN.map((link) => {
            const Icon = link.icon;
            const active = link.match(pathname);
            const count = link.countKey ? counts[link.countKey] : null;
            return (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={`studio-nav__link ${active ? 'studio-nav__link--active' : ''}`}
                  end={link.to === '/'}
                >
                  <Icon size={18} strokeWidth={1.75} aria-hidden />
                  {link.label}
                  {count != null && <span className="studio-nav__count">{count}</span>}
                </NavLink>
              </li>
            );
          })}
        </ul>
        {onSettings && (
          <ul className="studio-nav__sub" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon;
              const active = activeHash === section.id;
              return (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className={`studio-nav__sublink ${active ? 'studio-nav__sublink--active' : ''}`}
                  >
                    <Icon size={15} strokeWidth={1.75} aria-hidden />
                    {section.label}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="skin-bar">
        <p className="skin-bar__label"><Palette size={14} aria-hidden /> Stage skin</p>
        <div className="skin-bar__dots" role="radiogroup" aria-label="Stage skin">
          {THEME_OPTIONS.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`skin-dot ${skin === theme.id ? 'skin-dot--active' : ''}`}
              style={{ background: SKIN_COLORS[theme.id] }}
              aria-label={theme.label}
              aria-checked={skin === theme.id}
              role="radio"
              onClick={() => void pickSkin(theme.id)}
            />
          ))}
        </div>
        <p className="skin-bar__name">{skinLabel}</p>
      </div>
    </nav>
  );
}
