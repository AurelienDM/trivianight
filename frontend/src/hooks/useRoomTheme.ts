import { useEffect } from 'react';
import { THEME_IDS, type ThemeId, isThemeId } from '@shared/types';

const THEME_CLASSES = THEME_IDS.map((id) => `theme-${id}`);

/** Apply room/quiz skin classes on <html> so Host / Phone / TV / Join share CSS variables + fonts. */
export function useRoomTheme(themeId?: string | null) {
  useEffect(() => {
    const root = document.documentElement;
    const id: ThemeId = isThemeId(themeId) ? themeId : 'modern';
    for (const cls of THEME_CLASSES) root.classList.remove(cls);
    if (id !== 'modern') root.classList.add(`theme-${id}`);
    root.dataset.theme = id;
    return () => {
      for (const cls of THEME_CLASSES) root.classList.remove(cls);
      delete root.dataset.theme;
    };
  }, [themeId]);
}

export const THEME_OPTIONS: Array<{ id: ThemeId; label: string }> = [
  { id: 'modern', label: 'Modern Game Show' },
  { id: 'classic', label: 'Classic Pub Quiz' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'neon', label: 'Neon Night' },
  { id: 'arcade', label: 'Arcade Cabinet' },
];
