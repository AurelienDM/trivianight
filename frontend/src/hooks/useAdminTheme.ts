import { useEffect, useState } from 'react';
import type { ThemeId } from '@shared/types';
import { isThemeId } from '@shared/types';
import { useRoomTheme } from './useRoomTheme';

/** Fetch Settings Appearance theme id (no DOM apply). */
export function useAdminThemeId(): ThemeId | null {
  const [themeId, setThemeId] = useState<ThemeId | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => {
        if (cancelled) return;
        setThemeId(isThemeId(s?.uiThemeId) ? s.uiThemeId : 'modern');
      })
      .catch(() => {
        if (!cancelled) setThemeId('modern');
      });
    function onTheme(ev: Event) {
      const id = (ev as CustomEvent<string>).detail;
      if (isThemeId(id)) setThemeId(id);
    }
    window.addEventListener('trivia-theme', onTheme);
    return () => {
      cancelled = true;
      window.removeEventListener('trivia-theme', onTheme);
    };
  }, []);

  return themeId;
}

/** Load Settings Appearance theme and apply admin chrome skins. */
export function useAdminTheme() {
  const themeId = useAdminThemeId();
  useRoomTheme(themeId);
  return themeId;
}
