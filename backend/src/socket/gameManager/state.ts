import type { GameState, GradeResult, Quiz, TeamAnswerSheet } from '../../types.js';

export interface SessionPrivate {
  quiz: Quiz;
  /** teamId → current round answer sheet */
  sheets: Map<string, TeamAnswerSheet>;
  /** teamId → session token for rejoin */
  tokens: Map<string, string>;
  /** Cached auto-grades after lock */
  grades: Map<string, GradeResult[]>;
  /** Previous ranks for delta display */
  previousRanks: Map<string, number>;
  hostSocketId: string | null;
}

export const sessions = new Map<string, GameState>();
export const privates = new Map<string, SessionPrivate>();
export const lastActivityAt = new Map<string, number>();
/** socketId → { roomCode, teamId } */
export const socketTeams = new Map<string, { roomCode: string; teamId: string }>();

export function touch(roomCode: string) {
  lastActivityAt.set(roomCode, Date.now());
}
