import { gradeSheet } from '../../grading/grade.js';
import type { GradeResult, HostSecrets, HostTeamRoundReview, MediaRef, ThemeId } from '../../types.js';
import { isThemeId } from '../../shared/types.js';
import { normalizeChoices } from '../../shared/questionNormalize.js';
import { toClientLogoUrl } from '../../services/logoProxy.js';
import { saveQuizFile } from '../../storage/quizStorage.js';
import { getSettings } from '../../storage/settingsStorage.js';
import { buildLeaderboard, buildRevealTeamResults, getPrivate, getSession, refreshPublicQuestion } from './sessions.js';
import { touch } from './state.js';

/** Restart countdown from armed duration (used on each shown question). */
export function restartQuestionTimer(roomCode: string): void {
  const state = getSession(roomCode);
  if (!state) return;
  const sec = state.timerDurationSec;
  if (sec && sec > 0) {
    state.timerEndsAt = Date.now() + sec * 1000;
  }
}

export function setTimer(
  roomCode: string,
  seconds: number | null,
): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  if (!state) return { ok: false, error: 'Room not found' };
  if (seconds == null || !(seconds > 0)) {
    state.timerDurationSec = null;
    state.timerEndsAt = null;
  } else {
    state.timerDurationSec = Math.round(seconds);
    if (state.phase === 'questioning') {
      state.timerEndsAt = Date.now() + state.timerDurationSec * 1000;
    }
  }
  touch(roomCode);
  return { ok: true };
}

export function setTheme(
  roomCode: string,
  themeId: string,
): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  if (!state) return { ok: false, error: 'Room not found' };
  if (!isThemeId(themeId)) return { ok: false, error: 'Invalid theme' };
  state.themeId = themeId as ThemeId;
  touch(roomCode);
  return { ok: true };
}

/**
 * Replace question media mid-round (Deezer search/replace).
 * Updates in-memory quiz, refreshes public currentQuestion (spoiler-safe),
 * and persists quiz JSON by default.
 */
export async function updateQuestionMedia(
  roomCode: string,
  opts: {
    questionIndex: number;
    media: MediaRef;
    roundIndex?: number;
    persist?: boolean;
  },
): Promise<{ ok: boolean; error?: string }> {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  const ri = opts.roundIndex ?? state.roundIndex;
  const round = priv.quiz.rounds[ri];
  const q = round?.questions[opts.questionIndex];
  if (!q) return { ok: false, error: 'Bad question' };

  // Clone so socket payload mutation cannot strip host-only fields later
  q.media = opts.media ? { ...opts.media } : opts.media;
  priv.quiz.updatedAt = new Date().toISOString();

  if (ri === state.roundIndex) {
    if (state.phase === 'reveal') {
      refreshPublicQuestion(roomCode, true);
    } else if (state.phase === 'questioning' || state.currentQuestion) {
      // Keep preview live; strip title/artist/album until reveal
      refreshPublicQuestion(roomCode, false);
    }
  }

  if (opts.persist !== false) {
    try {
      await saveQuizFile(priv.quiz);
    } catch (err) {
      console.warn('[updateQuestionMedia] persist failed', err);
      // Session override still applied
    }
  }

  touch(roomCode);
  return { ok: true };
}

export function startGame(roomCode: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  if (state.teams.length < 2) return { ok: false, error: 'Need at least 2 teams' };
  state.phase = 'round_intro';
  state.roundIndex = 0;
  state.questionIndex = 0;
  state.revealIndex = 0;
  state.roundTitle = priv.quiz.rounds[0]?.title ?? 'Round 1';
  state.questionsInRound = priv.quiz.rounds[0]?.questions.length ?? 8;
  state.currentQuestion = null;
  state.showLeaderboard = false;
  state.shownQuestionIndexes = [];
  state.maxQuestionShown = -1;
  resetSheetsForRound(roomCode);
  touch(roomCode);
  return { ok: true };
}

function resetSheetsForRound(roomCode: string) {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return;
  state.shownQuestionIndexes = [];
  state.maxQuestionShown = -1;
  for (const team of state.teams) {
    team.submitted = false;
    priv.sheets.set(team.id, {
      answers: Array(state.questionsInRound).fill(''),
      submittedAt: null,
    });
  }
  priv.grades.clear();
}

function markQuestionShown(state: { shownQuestionIndexes: number[]; maxQuestionShown: number; questionIndex: number }) {
  const idx = state.questionIndex;
  if (!state.shownQuestionIndexes.includes(idx)) {
    state.shownQuestionIndexes = [...state.shownQuestionIndexes, idx].sort((a, b) => a - b);
  }
  state.maxQuestionShown = Math.max(state.maxQuestionShown, idx);
}

export function showQuestion(roomCode: string, questionIndex?: number): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  if (questionIndex != null) state.questionIndex = questionIndex;
  if (state.questionIndex < 0 || state.questionIndex >= state.questionsInRound) {
    return { ok: false, error: 'Invalid question index' };
  }
  state.phase = 'questioning';
  state.showLeaderboard = false;
  markQuestionShown(state);
  refreshPublicQuestion(roomCode, false);
  restartQuestionTimer(roomCode);
  touch(roomCode);
  return { ok: true };
}

export function nextQuestion(roomCode: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  if (!state) return { ok: false, error: 'Room not found' };
  if (state.questionIndex >= state.questionsInRound - 1) {
    return { ok: false, error: 'Already on last question — lock the round to continue' };
  }
  state.questionIndex += 1;
  return showQuestion(roomCode);
}

export function prevQuestion(roomCode: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  if (!state) return { ok: false, error: 'Room not found' };
  if (state.questionIndex <= 0) return { ok: false, error: 'Already on first question' };
  state.questionIndex -= 1;
  return showQuestion(roomCode);
}

function persistShownAnswers(
  state: NonNullable<ReturnType<typeof getSession>>,
  sheet: { answers: string[] },
  answers: string[],
) {
  const shown = new Set(state.shownQuestionIndexes ?? []);
  const next = Array(state.questionsInRound)
    .fill('')
    .map((_, i) => {
      // Only accept edits for host-presented indexes; keep prior otherwise.
      // Missing indexes (sparse / short arrays) preserve prior; '' clears intentionally.
      if (shown.has(i)) {
        if (i < answers.length) {
          return String(answers[i] ?? '').slice(0, 200);
        }
        return String(sheet.answers[i] ?? '').slice(0, 200);
      }
      return String(sheet.answers[i] ?? '').slice(0, 200);
    });
  sheet.answers = next;
}

export function updateAnswers(
  roomCode: string,
  teamId: string,
  answers: string[],
  opts?: { allowIfSubmitted?: boolean },
): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  if (state.phase === 'locked' || state.phase === 'reveal' || state.phase === 'scoring' || state.phase === 'leaderboard' || state.phase === 'finished') {
    return { ok: false, error: 'Answers are locked' };
  }
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return { ok: false, error: 'Team not found' };
  if (team.submitted && !opts?.allowIfSubmitted) {
    return { ok: false, error: 'Already submitted' };
  }

  const sheet = priv.sheets.get(teamId);
  if (!sheet) return { ok: false, error: 'No sheet' };
  persistShownAnswers(state, sheet, answers);
  touch(roomCode);
  return { ok: true };
}

/** Persist answers (optional) then mark submitted. Idempotent if already submitted. */
export function submitSheet(
  roomCode: string,
  teamId: string,
  answers?: string[],
): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  if (state.phase === 'locked' || state.phase === 'reveal' || state.phase === 'scoring' || state.phase === 'finished') {
    return { ok: false, error: 'Answers are locked' };
  }
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return { ok: false, error: 'Team not found' };
  const sheet = priv.sheets.get(teamId);
  if (!sheet) return { ok: false, error: 'No sheet' };

  // Fail-closed: if answers provided, persist must succeed before marking submitted
  if (answers) {
    const saved = updateAnswers(roomCode, teamId, answers, { allowIfSubmitted: true });
    if (!saved.ok) return saved;
  }
  if (team.submitted) {
    touch(roomCode);
    return { ok: true };
  }
  team.submitted = true;
  sheet.submittedAt = Date.now();
  touch(roomCode);
  return { ok: true };
}

export async function lockRound(roomCode: string): Promise<{ ok: boolean; error?: string }> {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  const round = priv.quiz.rounds[state.roundIndex];
  if (!round) return { ok: false, error: 'No round' };

  const settings = await getSettings();
  const gradingCfg = {
    spellingSlack: settings.spellingSlack,
    acceptIncompleteNames: settings.acceptIncompleteNames,
  };

  // Auto-submit any unsubmitted sheets, then grade
  for (const team of state.teams) {
    team.submitted = true;
    const sheet = priv.sheets.get(team.id);
    if (sheet && !sheet.submittedAt) sheet.submittedAt = Date.now();
    const answers = sheet?.answers ?? Array(state.questionsInRound).fill('');
    const grades = gradeSheet(answers, round.questions, gradingCfg);
    priv.grades.set(team.id, grades);
  }

  state.phase = 'locked';
  state.currentQuestion = null;
  state.timerEndsAt = null;
  // Keep timerDurationSec so later unlock / Qs can restart the same length
  // Score totals as soon as pencils are down (idempotent if host re-opens scoring later)
  applyAutoScores(roomCode);
  touch(roomCode);
  return { ok: true };
}

export function unlockRound(roomCode: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  if (state.phase !== 'locked') return { ok: false, error: 'Not locked' };
  for (const team of state.teams) {
    team.submitted = false;
    const sheet = priv.sheets.get(team.id);
    if (sheet) sheet.submittedAt = null;
  }
  priv.grades.clear();
  state.phase = 'questioning';
  refreshPublicQuestion(roomCode, false);
  restartQuestionTimer(roomCode);
  touch(roomCode);
  return { ok: true };
}

export function beginReveal(roomCode: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  if (!state) return { ok: false, error: 'Room not found' };
  if (state.phase !== 'locked' && state.phase !== 'scoring') {
    return { ok: false, error: 'Lock the round before revealing' };
  }
  state.phase = 'reveal';
  state.revealIndex = 0;
  state.questionIndex = 0;
  refreshPublicQuestion(roomCode, true);
  touch(roomCode);
  return { ok: true };
}

export function revealNext(roomCode: string): { ok: boolean; error?: string; done?: boolean } {
  const state = getSession(roomCode);
  if (!state) return { ok: false, error: 'Room not found' };
  if (state.phase !== 'reveal') return { ok: false, error: 'Not in reveal phase' };
  if (state.revealIndex >= state.questionsInRound - 1) {
    return { ok: true, done: true };
  }
  state.revealIndex += 1;
  state.questionIndex = state.revealIndex;
  refreshPublicQuestion(roomCode, true);
  touch(roomCode);
  return { ok: true, done: false };
}

export function openScoring(roomCode: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  if (!state) return { ok: false, error: 'Room not found' };
  state.phase = 'scoring';
  touch(roomCode);
  return { ok: true };
}

export function setGrade(
  roomCode: string,
  teamId: string,
  questionIndex: number,
  verdict: GradeResult['verdict'],
  pointsAwarded?: number,
): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  const grades = priv.grades.get(teamId);
  const round = priv.quiz.rounds[state.roundIndex];
  if (!grades || !round) return { ok: false, error: 'No grades' };
  const q = round.questions[questionIndex];
  if (!q) return { ok: false, error: 'Bad question' };
  const pts = pointsAwarded ?? (verdict === 'correct' ? q.points : verdict === 'incorrect' ? 0 : grades[questionIndex]?.pointsAwarded ?? 0);
  grades[questionIndex] = {
    ...grades[questionIndex],
    verdict,
    pointsAwarded: pts,
    confidence: 1,
    reason: 'host override',
  };
  // Recompute round score for team
  const team = state.teams.find((t) => t.id === teamId);
  if (team) {
    const roundPoints = grades.reduce((sum, g) => sum + (g.pointsAwarded || 0), 0);
    const oldRound = team.roundScores[state.roundIndex] ?? 0;
    team.roundScores[state.roundIndex] = roundPoints;
    team.score = team.score - oldRound + roundPoints;
  }
  if (state.phase === 'reveal') {
    state.revealTeamResults = buildRevealTeamResults(roomCode, state.revealIndex);
  }
  touch(roomCode);
  return { ok: true };
}

/** Apply auto-grades into team scores (idempotent per round if already applied — host can re-open scoring). */
export function applyAutoScores(roomCode: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };

  for (const team of state.teams) {
    const grades = priv.grades.get(team.id) ?? [];
    const roundPoints = grades.reduce((sum, g) => sum + (g.verdict === 'correct' ? g.pointsAwarded : 0), 0);
    // Zero out review/incorrect already handled in gradeSheet pointsAwarded
    const awarded = grades.reduce((sum, g) => sum + (g.pointsAwarded || 0), 0);
    const oldRound = team.roundScores[state.roundIndex] ?? 0;
    team.roundScores[state.roundIndex] = awarded || roundPoints;
    team.score = team.score - oldRound + team.roundScores[state.roundIndex];
  }
  touch(roomCode);
  return { ok: true };
}

export function showLeaderboard(roomCode: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  applyAutoScores(roomCode);
  state.leaderboard = buildLeaderboard(state, priv.previousRanks);
  for (const e of state.leaderboard) {
    priv.previousRanks.set(e.teamId, e.rank);
  }
  state.phase = 'leaderboard';
  state.showLeaderboard = true;
  state.currentQuestion = null;
  touch(roomCode);
  return { ok: true };
}

export function hideLeaderboard(roomCode: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  if (!state) return { ok: false, error: 'Room not found' };
  state.showLeaderboard = false;
  touch(roomCode);
  return { ok: true };
}

export function nextRound(roomCode: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  if (state.roundIndex >= state.totalRounds - 1) {
    state.phase = 'finished';
    state.showLeaderboard = true;
    state.leaderboard = buildLeaderboard(state, priv.previousRanks);
    touch(roomCode);
    return { ok: true };
  }
  state.roundIndex += 1;
  state.questionIndex = 0;
  state.revealIndex = 0;
  state.roundTitle = priv.quiz.rounds[state.roundIndex]?.title ?? `Round ${state.roundIndex + 1}`;
  state.questionsInRound = priv.quiz.rounds[state.roundIndex]?.questions.length ?? 8;
  state.phase = 'round_intro';
  state.showLeaderboard = false;
  state.currentQuestion = null;
  state.shownQuestionIndexes = [];
  state.maxQuestionShown = -1;
  resetSheetsForRound(roomCode);
  touch(roomCode);
  return { ok: true };
}

export function endGame(roomCode: string): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  applyAutoScores(roomCode);
  state.phase = 'finished';
  state.leaderboard = buildLeaderboard(state, priv.previousRanks);
  state.showLeaderboard = true;
  state.currentQuestion = null;
  touch(roomCode);
  return { ok: true };
}

export function buildHostSecrets(roomCode: string): HostSecrets | null {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return null;
  const round = priv.quiz.rounds[state.roundIndex];
  if (!round) return null;

  const teams: HostTeamRoundReview[] = state.teams.map((t) => {
    const answers = priv.sheets.get(t.id)?.answers ?? [];
    const grades = priv.grades.get(t.id) ?? [];
    return {
      teamId: t.id,
      name: t.name,
      color: t.color,
      answers: [...answers],
      grades: [...grades],
      roundPoints: t.roundScores[state.roundIndex] ?? 0,
    };
  });

  const questions = round.questions.map((q) => {
    const row: HostSecrets['questions'][number] = {
      id: q.id,
      prompt: q.prompt,
      acceptedAnswers: q.acceptedAnswers,
      points: q.points,
      type: q.type,
    };
    if (q.media) {
      row.media = { ...q.media };
    }
    return row;
  });
  return {
    roundIndex: state.roundIndex,
    questions,
    teams,
  };
}

export function getTeamSheet(roomCode: string, teamId: string) {
  const priv = getPrivate(roomCode);
  const state = getSession(roomCode);
  if (!priv || !state) return null;
  const sheet = priv.sheets.get(teamId);
  if (!sheet) return null;
  const round = priv.quiz.rounds[state.roundIndex];
  const unlocked =
    ['locked', 'reveal', 'scoring', 'leaderboard', 'finished'].includes(state.phase);
  const shown = new Set(
    unlocked
      ? (round?.questions ?? []).map((_, i) => i)
      : (state.shownQuestionIndexes ?? []),
  );
  // Public question meta for type-aware team UI — never include accepted answers / spoiler titles
  const questions = (round?.questions ?? [])
    .map((q, index) => ({
      index,
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      points: q.points,
      choices: normalizeChoices(q.choices),
      connectionClues: q.connectionClues,
      musicFields: q.musicFields,
      hasMedia: !!(
        q.media?.deezerTrackId
        || q.media?.spotifyTrackId
        || q.media?.previewUrl
        || q.media?.youtubeId
        || q.media?.url
      ),
      mediaKind: q.media?.kind,
      /** Spoiler-safe logo/image URL for phone (no brand title); proxied for remote logos */
      mediaUrl: (() => {
        if (!(q.type === 'brand_logo' || q.type === 'image') || !q.media?.url) return undefined;
        if (q.type === 'brand_logo' || q.media.brandKey || q.media.domain) {
          return toClientLogoUrl(q.media.url) ?? q.media.url;
        }
        return q.media.url;
      })(),
    }))
    .filter((q) => shown.has(q.index));
  // Own reveal only — never expose other teams' answers
  let ownReveal: {
    index: number;
    revealedAnswer: string;
    pointsAwarded: number;
    roundPointsSoFar: number;
  } | null = null;
  if (state.phase === 'reveal') {
    const idx = state.revealIndex;
    const grades = priv.grades.get(teamId) ?? [];
    let roundPointsSoFar = 0;
    for (let i = 0; i <= idx; i++) roundPointsSoFar += grades[i]?.pointsAwarded ?? 0;
    const q = round?.questions[idx];
    ownReveal = {
      index: idx,
      revealedAnswer: q?.acceptedAnswers[0] ?? '',
      pointsAwarded: grades[idx]?.pointsAwarded ?? 0,
      roundPointsSoFar,
    };
  }

  return {
    answers: sheet.answers,
    submitted: state.teams.find((t) => t.id === teamId)?.submitted ?? false,
    locked: unlocked,
    questionsInRound: state.questionsInRound,
    shownQuestionIndexes: [...shown].sort((a, b) => a - b),
    questions,
    ownReveal,
  };
}

export function setPaperAnswers(roomCode: string, teamId: string, answers: string[]): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  const priv = getPrivate(roomCode);
  if (!state || !priv) return { ok: false, error: 'Room not found' };
  const sheet = priv.sheets.get(teamId);
  if (!sheet) return { ok: false, error: 'No sheet' };
  sheet.answers = Array(state.questionsInRound)
    .fill('')
    .map((_, i) => String(answers[i] ?? '').slice(0, 200));
  touch(roomCode);
  return { ok: true };
}

export function adjustScore(roomCode: string, teamId: string, delta: number): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  if (!state) return { ok: false, error: 'Room not found' };
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return { ok: false, error: 'Team not found' };
  team.score += delta;
  touch(roomCode);
  return { ok: true };
}

export function setScore(roomCode: string, teamId: string, score: number): { ok: boolean; error?: string } {
  const state = getSession(roomCode);
  if (!state) return { ok: false, error: 'Room not found' };
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return { ok: false, error: 'Team not found' };
  team.score = score;
  touch(roomCode);
  return { ok: true };
}
