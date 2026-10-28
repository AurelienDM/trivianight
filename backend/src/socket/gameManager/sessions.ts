import { randomBytes, randomUUID as uuidv4 } from 'crypto';
import type { GameState, LeaderboardEntry, PublicQuestion, Quiz, RevealTeamResult, TeamPublic } from '../../types.js';
import { LIMITS, TEAM_COLORS } from '../../shared/limits.js';
import { normalizeChoices } from '../../shared/questionNormalize.js';
import { toClientLogoUrl } from '../../services/logoProxy.js';
import { lastActivityAt, privates, sessions, touch, type SessionPrivate } from './state.js';

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function toPublicQuestion(quiz: Quiz, roundIndex: number, questionIndex: number, revealAnswer: boolean): PublicQuestion | null {
  const round = quiz.rounds[roundIndex];
  const q = round?.questions[questionIndex];
  if (!q) return null;
  // Spoiler-protect metadata before reveal (keep ids/urls for playback).
  // Build a fresh object — never mutate the stored question media (host secrets need titles).
  const rawUrl = q.media?.url;
  const proxiedUrl =
    q.type === 'brand_logo' || (q.media?.kind === 'image' && (q.media.brandKey || q.media.domain))
      ? toClientLogoUrl(rawUrl) ?? rawUrl
      : rawUrl;
  const media = q.media
    ? {
        kind: q.media.kind,
        url: proxiedUrl,
        youtubeId: q.media.youtubeId,
        appleMusicId: revealAnswer ? q.media.appleMusicId : undefined,
        spotifyTrackId: q.media.spotifyTrackId,
        deezerTrackId: q.media.deezerTrackId,
        previewUrl: q.media.previewUrl,
        title: revealAnswer ? q.media.title : undefined,
        artist: revealAnswer ? q.media.artist : undefined,
        album: revealAnswer ? q.media.album : undefined,
        // Brand logos: keep url for display; hide brand metadata until reveal
        domain: revealAnswer ? q.media.domain : undefined,
        brandKey: revealAnswer ? q.media.brandKey : undefined,
        startMs: q.media.startMs,
        durationMs: q.media.durationMs,
      }
    : undefined;
  return {
    id: q.id,
    index: questionIndex,
    type: q.type,
    prompt: q.prompt,
    points: q.points,
    media,
    choices: normalizeChoices(q.choices),
    // For ordering during play, shuffle a copy for the team UI; TV may hide until needed
    orderItems: q.type === 'ordering' ? [...(q.orderItems ?? [])].sort(() => Math.random() - 0.5) : undefined,
    connectionClues: q.connectionClues,
    musicFields: q.musicFields,
    revealedAnswer: revealAnswer ? (q.acceptedAnswers[0] ?? '') : undefined,
  };
}

export function buildLeaderboard(state: GameState, previousRanks: Map<string, number>): LeaderboardEntry[] {
  const sorted = [...state.teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return sorted.map((t, i) => {
    const rank = i + 1;
    const roundPoints = t.roundScores[state.roundIndex] ?? 0;
    const entry: LeaderboardEntry = {
      teamId: t.id,
      name: t.name,
      color: t.color,
      score: t.score,
      roundPoints,
      rank,
      previousRank: previousRanks.get(t.id) ?? null,
    };
    if (t.avatarUrl) entry.avatarUrl = t.avatarUrl;
    return entry;
  });
}

export function createSession(
  quiz: Quiz,
  opts?: { defaultThemeId?: GameState['themeId'] },
): GameState {
  let roomCode = generateRoomCode();
  while (sessions.has(roomCode)) roomCode = generateRoomCode();

  const state: GameState = {
    quizId: quiz.id,
    quizName: quiz.name,
    roomCode,
    phase: 'lobby',
    roundIndex: 0,
    questionIndex: 0,
    revealIndex: 0,
    teams: [],
    currentQuestion: null,
    revealTeamResults: [],
    roundTitle: quiz.rounds[0]?.title ?? 'Round 1',
    totalRounds: quiz.rounds.length,
    questionsInRound: quiz.rounds[0]?.questions.length ?? 8,
    shownQuestionIndexes: [],
    maxQuestionShown: -1,
    leaderboard: [],
    showLeaderboard: false,
    timerEndsAt: null,
    timerDurationSec: null,
    pin: generatePin(),
    themeId: quiz.settings?.themeId ?? opts?.defaultThemeId ?? 'modern',
  };

  const priv: SessionPrivate = {
    quiz,
    sheets: new Map(),
    tokens: new Map(),
    grades: new Map(),
    previousRanks: new Map(),
    hostSocketId: null,
  };

  sessions.set(roomCode, state);
  privates.set(roomCode, priv);
  touch(roomCode);
  return state;
}

/** Active host rooms currently running this quiz id. */
export function findRoomsForQuiz(quizId: string): string[] {
  const rooms: string[] = [];
  for (const [code, state] of sessions) {
    if (state.quizId === quizId) rooms.push(code);
  }
  return rooms;
}

/** Snapshot of all in-memory rooms for Dashboard “Ongoing games”. */
export function listActiveRooms(): Array<{
  roomCode: string;
  pin: string;
  quizId: string;
  quizName: string;
  phase: GameState['phase'];
  teamCount: number;
  roundIndex: number;
  totalRounds: number;
}> {
  const out: Array<{
    roomCode: string;
    pin: string;
    quizId: string;
    quizName: string;
    phase: GameState['phase'];
    teamCount: number;
    roundIndex: number;
    totalRounds: number;
  }> = [];
  for (const [code, state] of sessions) {
    out.push({
      roomCode: code,
      pin: state.pin,
      quizId: state.quizId,
      quizName: state.quizName,
      phase: state.phase,
      teamCount: state.teams.length,
      roundIndex: state.roundIndex,
      totalRounds: state.totalRounds,
    });
  }
  return out.sort((a, b) => a.roomCode.localeCompare(b.roomCode));
}

/** Close (delete) every in-memory session for a quiz. Returns closed room codes. */
export function closeRoomsForQuiz(quizId: string): string[] {
  const rooms = findRoomsForQuiz(quizId);
  for (const code of rooms) deleteSession(code);
  return rooms;
}

export function getSession(roomCode: string): GameState | undefined {
  const s = sessions.get(roomCode.toUpperCase());
  if (s) touch(roomCode.toUpperCase());
  return s;
}

export function getPrivate(roomCode: string): SessionPrivate | undefined {
  return privates.get(roomCode.toUpperCase());
}

export function deleteSession(roomCode: string) {
  const code = roomCode.toUpperCase();
  sessions.delete(code);
  privates.delete(code);
  lastActivityAt.delete(code);
}

export function getIdleSessions(maxIdleMs: number): string[] {
  const now = Date.now();
  const idle: string[] = [];
  for (const roomCode of sessions.keys()) {
    const last = lastActivityAt.get(roomCode) ?? 0;
    if (now - last > maxIdleMs) idle.push(roomCode);
  }
  return idle;
}

function isNameTaken(state: GameState, name: string, excludeId?: string): boolean {
  const n = name.trim().toLowerCase();
  return state.teams.some((t) => t.id !== excludeId && t.name.trim().toLowerCase() === n);
}

export function addTeam(
  roomCode: string,
  name: string,
  color?: string,
  avatarUrl?: string,
): { team: TeamPublic; token: string } | { error: string } {
  const code = roomCode.toUpperCase();
  const state = sessions.get(code);
  const priv = privates.get(code);
  if (!state || !priv) return { error: 'Room not found' };
  if (state.phase !== 'lobby' && state.phase !== 'round_intro') {
    // Allow late join only in lobby for v1 simplicity — host can still add paper teams
  }
  if (state.teams.length >= LIMITS.MAX_TEAMS) return { error: 'Room is full' };
  const trimmed = name.trim().slice(0, LIMITS.TEAM_NAME_MAX);
  if (!trimmed) return { error: 'Name required' };
  if (isNameTaken(state, trimmed)) return { error: 'That name is already taken' };

  const team: TeamPublic = {
    id: uuidv4(),
    name: trimmed,
    color: color || TEAM_COLORS[state.teams.length % TEAM_COLORS.length],
    score: 0,
    roundScores: Array(state.totalRounds).fill(0),
    submitted: false,
    connected: true,
  };
  if (avatarUrl) team.avatarUrl = avatarUrl;
  const token = randomBytes(16).toString('hex');
  state.teams.push(team);
  priv.tokens.set(team.id, token);
  priv.sheets.set(team.id, {
    answers: Array(state.questionsInRound).fill(''),
    submittedAt: null,
  });
  touch(code);
  return { team, token };
}

export function removeTeam(roomCode: string, teamId: string) {
  const code = roomCode.toUpperCase();
  const state = sessions.get(code);
  const priv = privates.get(code);
  if (!state || !priv) return;
  state.teams = state.teams.filter((t) => t.id !== teamId);
  priv.sheets.delete(teamId);
  priv.tokens.delete(teamId);
  priv.grades.delete(teamId);
  touch(code);
}

export function renameTeam(roomCode: string, teamId: string, newName: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  if (!state) return { ok: false, error: 'Room not found' };
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return { ok: false, error: 'Team not found' };
  const trimmed = newName.trim().slice(0, LIMITS.TEAM_NAME_MAX);
  if (!trimmed) return { ok: false, error: 'Name required' };
  if (isNameTaken(state, trimmed, teamId)) return { ok: false, error: 'That name is already taken' };
  team.name = trimmed;
  return { ok: true };
}

export function verifyToken(roomCode: string, teamId: string, token: string): boolean {
  const priv = getPrivate(roomCode);
  if (!priv) return false;
  return priv.tokens.get(teamId) === token;
}

/** Rejoin an existing team by room + PIN + exact team name (no duplicate team). */
export function rejoinTeamByName(
  roomCode: string,
  name: string,
  pin?: string,
): { team: TeamPublic; token: string; state: GameState } | { error: string } {
  const code = roomCode.toUpperCase();
  const state = sessions.get(code);
  const priv = privates.get(code);
  if (!state || !priv) return { error: 'Room not found' };
  if (pin && pin !== state.pin) return { error: 'Invalid PIN' };
  const trimmed = name.trim();
  if (!trimmed) return { error: 'Name required' };
  const team = state.teams.find((t) => t.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (!team) return { error: 'No team with that name in this room' };
  let token = priv.tokens.get(team.id);
  if (!token) {
    token = randomBytes(16).toString('hex');
    priv.tokens.set(team.id, token);
  }
  team.connected = true;
  touch(code);
  return { team, token, state };
}

export function buildRevealTeamResults(roomCode: string, questionIndex: number): RevealTeamResult[] {
  const code = roomCode.toUpperCase();
  const state = sessions.get(code);
  const priv = privates.get(code);
  if (!state || !priv) return [];
  return state.teams.map((t) => {
    const grades = priv.grades.get(t.id) ?? [];
    const sheet = priv.sheets.get(t.id);
    const pointsAwarded = grades[questionIndex]?.pointsAwarded ?? 0;
    let roundPointsSoFar = 0;
    for (let i = 0; i <= questionIndex; i++) {
      roundPointsSoFar += grades[i]?.pointsAwarded ?? 0;
    }
    // Reconstruct score as if only awards through this reveal index applied this round
    const fullRound = t.roundScores[state.roundIndex] ?? 0;
    const score = t.score - fullRound + roundPointsSoFar;
    const row: RevealTeamResult = {
      teamId: t.id,
      name: t.name,
      color: t.color,
      answer: sheet?.answers[questionIndex] ?? '',
      pointsAwarded,
      roundPointsSoFar,
      score,
    };
    if (t.avatarUrl) row.avatarUrl = t.avatarUrl;
    return row;
  });
}

export function refreshPublicQuestion(roomCode: string, revealAnswer = false) {
  const code = roomCode.toUpperCase();
  const state = sessions.get(code);
  const priv = privates.get(code);
  if (!state || !priv) return;
  const qIndex = revealAnswer ? state.revealIndex : state.questionIndex;
  state.currentQuestion = toPublicQuestion(priv.quiz, state.roundIndex, qIndex, revealAnswer);
  if (revealAnswer && state.phase === 'reveal') {
    state.revealTeamResults = buildRevealTeamResults(code, state.revealIndex);
  } else if (!revealAnswer) {
    state.revealTeamResults = [];
  }
}

export { toPublicQuestion };
