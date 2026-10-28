// Trivia Night shared types — used by backend and frontend via @shared.

export type QuestionType =
  | 'open'
  | 'music'
  | 'video'
  | 'image'
  | 'brand_logo'
  | 'numeric'
  | 'ordering'
  | 'connections'
  | 'multiple_choice';

export type GamePhase =
  | 'lobby'
  | 'round_intro'
  | 'questioning'
  | 'locked'
  | 'reveal'
  | 'scoring'
  | 'leaderboard'
  | 'finished';

export type MediaKind = 'image' | 'video' | 'audio' | 'youtube' | 'apple_music' | 'spotify' | 'deezer';

export interface MediaRef {
  kind: MediaKind;
  url?: string;
  /** YouTube video id for embed playback (legacy / optional) */
  youtubeId?: string;
  appleMusicId?: string;
  /** Legacy Spotify track id */
  spotifyTrackId?: string;
  /** Deezer track id — Host/TV play previewUrl only */
  deezerTrackId?: string;
  /** ~30s preview URL (Deezer/Spotify; may be absent if rights change) */
  previewUrl?: string;
  /** Spoiler-safe label shown only after reveal */
  title?: string;
  artist?: string;
  /** Album title (spoiler-safe; shown in editor / after reveal) */
  album?: string;
  /** Brand logo: inferred / official domain (spoiler-safe until reveal) */
  domain?: string;
  /** Brand logo: stable key / slug (spoiler-safe until reveal) */
  brandKey?: string;
  startMs?: number;
  durationMs?: number;
}

export interface NumericConfig {
  exact?: number;
  min?: number;
  max?: number;
  tolerance?: number;
  tolerancePercent?: number;
  closestWins?: boolean;
}

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  /** Primary answer + aliases used by the grading engine */
  acceptedAnswers: string[];
  hint?: string;
  notes?: string;
  /** Question-bank item this slot was copied from, when setup filled from the bank. */
  bankItemId?: string;
  media?: MediaRef;
  choices?: string[];
  /** Correct order of items (ordering type) */
  orderItems?: string[];
  /** Clues that share a connection */
  connectionClues?: string[];
  numeric?: NumericConfig;
  /** Music ID fields the team must fill */
  musicFields?: Array<'title' | 'artist' | 'album' | 'decade' | 'year'>;
  imageReveal?: { blurStart?: number; steps?: number };
}

export interface Round {
  id: string;
  title: string;
  theme?: string;
  questions: Question[];
}

export const THEME_IDS = ['modern', 'classic', 'minimal', 'neon', 'arcade'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}

export type QuestionSource = 'blank' | 'bank' | 'ai' | 'both';

export function isQuestionSource(v: unknown): v is QuestionSource {
  return v === 'blank' || v === 'bank' || v === 'ai' || v === 'both';
}

export interface QuizSettings {
  allowMultipleChoice?: boolean;
  themeId?: ThemeId;
  defaultPoints?: number;
  /** Table size chosen on the setup sheet. 1 or more. Not the live join cap. */
  playerCount?: number;
  /** Slots created in each new round. */
  questionsPerRound?: number;
  questionSource?: QuestionSource;
}

export interface Quiz {
  id: string;
  name: string;
  description?: string;
  rounds: Round[];
  settings?: QuizSettings;
  createdAt: string;
  updatedAt: string;
}

export interface TeamPublic {
  id: string;
  name: string;
  color: string;
  /** Optional selfie / team icon as a small data URL */
  avatarUrl?: string;
  score: number;
  roundScores: number[];
  /** True once the team locks their sheet for the current round */
  submitted: boolean;
  connected: boolean;
}

export interface LeaderboardEntry {
  teamId: string;
  name: string;
  color: string;
  avatarUrl?: string;
  score: number;
  roundPoints: number;
  rank: number;
  previousRank: number | null;
}

export interface PublicQuestion {
  id: string;
  index: number;
  type: QuestionType;
  prompt: string;
  points: number;
  media?: MediaRef;
  choices?: string[];
  orderItems?: string[];
  connectionClues?: string[];
  musicFields?: Question['musicFields'];
  /** Only present during reveal / scoring after host reveals */
  revealedAnswer?: string;
}

/** Per-team breakdown shown on TV/Host during reveal */
export interface RevealTeamResult {
  teamId: string;
  name: string;
  color: string;
  avatarUrl?: string;
  answer: string;
  pointsAwarded: number;
  /** Points earned this round through the current reveal index (inclusive) */
  roundPointsSoFar: number;
  /** Team total score after applying this round's awards so far */
  score: number;
}

export interface GameState {
  quizId: string;
  quizName: string;
  roomCode: string;
  phase: GamePhase;
  roundIndex: number;
  questionIndex: number;
  revealIndex: number;
  teams: TeamPublic[];
  currentQuestion: PublicQuestion | null;
  /** Populated during reveal for the current revealed question */
  revealTeamResults: RevealTeamResult[];
  roundTitle: string;
  totalRounds: number;
  questionsInRound: number;
  /** Indexes the host has presented this round (phones may only answer these). */
  shownQuestionIndexes: number[];
  /** Highest index presented (inclusive); -1 before any question. */
  maxQuestionShown: number;
  leaderboard: LeaderboardEntry[];
  showLeaderboard: boolean;
  /** Wall-clock end for the current question countdown (null when cleared / locked). */
  timerEndsAt: number | null;
  /** Armed per-question length in seconds; survives lock so later Qs restart with it. */
  timerDurationSec: number | null;
  pin: string;
  themeId: ThemeId;
}

export type GradeVerdict = 'correct' | 'incorrect' | 'review';

export interface GradeResult {
  verdict: GradeVerdict;
  confidence: number;
  matchedAnswer?: string;
  reason?: string;
  pointsAwarded: number;
}

export interface AiGradeSuggestion {
  verdict: GradeVerdict;
  confidence: number;
  reason: string;
  matchedAnswer?: string;
  requiresHostConfirmation: true;
}

export interface TeamAnswerSheet {
  answers: string[];
  submittedAt: number | null;
}

export interface HostTeamRoundReview {
  teamId: string;
  name: string;
  color: string;
  answers: string[];
  grades: GradeResult[];
  roundPoints: number;
}

export interface HostSecrets {
  roundIndex: number;
  questions: Array<{
    id: string;
    prompt?: string;
    acceptedAnswers: string[];
    points: number;
    type: QuestionType;
    /** Full media incl. title/artist/album for host review (not sent on public game state) */
    media?: MediaRef;
  }>;
  teams: HostTeamRoundReview[];
}
