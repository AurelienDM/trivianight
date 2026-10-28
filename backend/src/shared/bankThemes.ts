/** Question-bank category themes (Music, Logos, Geography, …). */

export const BANK_THEME_IDS = [
  'general',
  'music',
  'logos',
  'geography',
  'history',
  'science',
  'film_tv',
  'sport',
  'food_drink',
  'pop_culture',
  'other',
] as const;

export type BankThemeId = (typeof BANK_THEME_IDS)[number];

export const BANK_THEME_LABELS: Record<BankThemeId, string> = {
  general: 'General',
  music: 'Music',
  logos: 'Logos',
  geography: 'Geography',
  history: 'History',
  science: 'Science',
  film_tv: 'Film & TV',
  sport: 'Sport',
  food_drink: 'Food & Drink',
  pop_culture: 'Pop Culture',
  other: 'Other',
};

export function isBankThemeId(v: unknown): v is BankThemeId {
  return typeof v === 'string' && (BANK_THEME_IDS as readonly string[]).includes(v);
}

/** Infer bank theme from round title, question type, prompt, and optional category. */
export function inferBankTheme(opts: {
  roundTitle?: string;
  type?: string;
  prompt?: string;
  category?: string;
  theme?: string;
}): BankThemeId {
  if (opts.theme && isBankThemeId(opts.theme)) return opts.theme;

  const type = (opts.type || '').toLowerCase();
  if (type === 'brand_logo' || type === 'image') return 'logos';
  if (type === 'music' || type === 'video') return 'music';

  const hay = [
    opts.roundTitle,
    opts.category,
    opts.theme,
    opts.prompt?.slice(0, 120),
  ].filter(Boolean).join(' ').toLowerCase();

  if (/\b(logo|brand|trademark|swoosh|emblem)\b/.test(hay) || type === 'brand_logo') return 'logos';
  if (/\b(music|song|album|band|artist|lyrics|tune|deezer|spotify)\b/.test(hay)) return 'music';
  if (/\b(geograph|capital|country|continent|ocean|river|mountain|city)\b/.test(hay)) return 'geography';
  if (/\b(history|war|century|empire|king|queen|ancient|medieval)\b/.test(hay)) return 'history';
  if (/\b(science|physics|chemistry|biology|space|planet|element|atom)\b/.test(hay)) return 'science';
  if (/\b(film|movie|cinema|oscar|tv|television|sitcom|actor|actress|netflix)\b/.test(hay)) return 'film_tv';
  if (/\b(sport|football|soccer|olympic|cricket|tennis|golf|nba|nfl)\b/.test(hay)) return 'sport';
  if (/\b(food|drink|cuisine|recipe|chef|cocktail|beer|wine|restaurant)\b/.test(hay)) return 'food_drink';
  if (/\b(pop culture|celebrity|meme|internet|viral|tiktok|instagram)\b/.test(hay)) return 'pop_culture';
  if (/\b(general knowledge|trivia|mixed|miscellaneous)\b/.test(hay)) return 'general';

  return 'general';
}
