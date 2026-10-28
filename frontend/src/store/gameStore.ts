import { create } from 'zustand';
import type { GameState, HostSecrets, MediaKind, QuestionType, TeamPublic } from '@shared/types';

export interface TeamSheetQuestion {
  index: number;
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  choices?: string[];
  connectionClues?: string[];
  musicFields?: Array<'title' | 'artist' | 'album' | 'decade' | 'year'>;
  hasMedia?: boolean;
  mediaKind?: MediaKind;
  /** Spoiler-safe image/logo URL for phone display */
  mediaUrl?: string;
}

interface TeamSheet {
  answers: string[];
  submitted: boolean;
  locked: boolean;
  questionsInRound: number;
  shownQuestionIndexes?: number[];
  questions?: TeamSheetQuestion[];
  ownReveal?: {
    index: number;
    revealedAnswer: string;
    pointsAwarded: number;
    roundPointsSoFar: number;
  } | null;
}

interface GameStore {
  connected: boolean;
  gameState: GameState | null;
  hostSecrets: HostSecrets | null;
  myTeam: TeamPublic | null;
  teamToken: string | null;
  teamSheet: TeamSheet | null;
  setConnected: (v: boolean) => void;
  setGameState: (s: GameState) => void;
  setHostSecrets: (s: HostSecrets) => void;
  setMyTeam: (t: TeamPublic | null) => void;
  setTeamToken: (t: string | null) => void;
  setTeamSheet: (s: TeamSheet | null) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  connected: false,
  gameState: null,
  hostSecrets: null,
  myTeam: null,
  teamToken: null,
  teamSheet: null,
  setConnected: (connected) => set({ connected }),
  setGameState: (gameState) => set({ gameState }),
  setHostSecrets: (hostSecrets) => set({ hostSecrets }),
  setMyTeam: (myTeam) => set({ myTeam }),
  setTeamToken: (teamToken) => set({ teamToken }),
  setTeamSheet: (teamSheet) => set({ teamSheet }),
}));
