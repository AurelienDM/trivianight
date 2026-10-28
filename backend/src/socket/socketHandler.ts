import type { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../shared/socketEvents.js';
import { getQuiz } from '../storage/quizStorage.js';
import { getSettings } from '../storage/settingsStorage.js';
import { sanitizeAvatarUrl } from './sanitizeAvatar.js';
import * as gm from './gameManager.js';

const IDLE_MS = 6 * 60 * 60 * 1000;

function emitState(io: Server, roomCode: string) {
  const state = gm.getSession(roomCode);
  if (!state) return;
  io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, state);
}

function emitHostSecrets(io: Server, roomCode: string) {
  const secrets = gm.buildHostSecrets(roomCode);
  if (!secrets) return;
  io.to(`hostpanel:${roomCode}`).emit(SOCKET_EVENTS.HOST_SECRETS, secrets);
}

function emitTeamSheet(socket: Socket, roomCode: string, teamId: string) {
  const sheet = gm.getTeamSheet(roomCode, teamId);
  if (sheet) socket.emit(SOCKET_EVENTS.TEAM_SHEET, sheet);
}

function emitAllTeamSheets(io: Server, roomCode: string) {
  for (const [sid, meta] of gm.socketTeams) {
    if (meta.roomCode !== roomCode) continue;
    const s = io.sockets.sockets.get(sid);
    if (s) emitTeamSheet(s, roomCode, meta.teamId);
  }
}

/** Resolve team from socket map, or rebind via roomCode/teamId/token after reconnect. */
function resolveTeamAuth(
  socket: Socket,
  payload?: { roomCode?: string; teamId?: string; token?: string },
): { roomCode: string; teamId: string } | { error: string } {
  const existing = gm.socketTeams.get(socket.id);
  if (existing) return existing;
  const code = payload?.roomCode?.toUpperCase();
  const teamId = payload?.teamId;
  const token = payload?.token;
  if (!code || !teamId || !token) return { error: 'Not joined' };
  if (!gm.verifyToken(code, teamId, token)) return { error: 'Invalid session' };
  const state = gm.getSession(code);
  if (!state?.teams.some((t) => t.id === teamId)) return { error: 'Team not found' };
  socket.join(code);
  gm.socketTeams.set(socket.id, { roomCode: code, teamId });
  return { roomCode: code, teamId };
}

export function registerSocketHandlers(io: Server) {
  setInterval(() => {
    for (const code of gm.getIdleSessions(IDLE_MS)) {
      gm.deleteSession(code);
    }
  }, 60_000);

  io.on('connection', (socket: Socket) => {
    socket.on(SOCKET_EVENTS.HOST_CREATE, async ({ quizId }: { quizId: string }) => {
      const quiz = await getQuiz(quizId);
      if (!quiz) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Quiz not found' });
        return;
      }
      const settings = await getSettings();
      const defaultThemeId = settings.uiThemeId;
      const state = gm.createSession(quiz, { defaultThemeId });
      const priv = gm.getPrivate(state.roomCode);
      if (priv) priv.hostSocketId = socket.id;
      socket.join(state.roomCode);
      socket.join(`host:${state.roomCode}`);
      socket.join(`hostpanel:${state.roomCode}`);
      socket.emit(SOCKET_EVENTS.HOST_CREATED, { roomCode: state.roomCode, state });
      emitHostSecrets(io, state.roomCode);
    });

    socket.on(SOCKET_EVENTS.HOST_JOIN, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode?.toUpperCase();
      const state = gm.getSession(code);
      if (!state) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Room not found' });
        return;
      }
      const priv = gm.getPrivate(code);
      if (priv) priv.hostSocketId = socket.id;
      socket.join(code);
      socket.join(`host:${code}`);
      socket.join(`hostpanel:${code}`);
      socket.emit(SOCKET_EVENTS.GAME_STATE, state);
      emitHostSecrets(io, code);
    });

    socket.on(SOCKET_EVENTS.TEAM_JOIN, (
      { roomCode, name, color, pin, avatarUrl }: {
        roomCode: string;
        name: string;
        color?: string;
        pin?: string;
        avatarUrl?: string;
      },
      ack?: (r: unknown) => void,
    ) => {
      const code = roomCode?.toUpperCase();
      const state = gm.getSession(code);
      if (!state) {
        ack?.({ ok: false, error: 'Room not found' });
        return;
      }
      if (pin && pin !== state.pin) {
        ack?.({ ok: false, error: 'Invalid PIN' });
        return;
      }
      const avatar = sanitizeAvatarUrl(avatarUrl);
      const result = gm.addTeam(code, name, color, avatar);
      if ('error' in result) {
        ack?.({ ok: false, error: result.error });
        return;
      }
      socket.join(code);
      gm.socketTeams.set(socket.id, { roomCode: code, teamId: result.team.id });
      socket.emit(SOCKET_EVENTS.TEAM_JOINED, { team: result.team, token: result.token, state });
      emitTeamSheet(socket, code, result.team.id);
      emitState(io, code);
      emitHostSecrets(io, code);
      ack?.({ ok: true, team: result.team, token: result.token });
    });

    socket.on(SOCKET_EVENTS.TEAM_REJOIN, (
      { roomCode, teamId, token }: { roomCode: string; teamId: string; token: string },
      ack?: (r: unknown) => void,
    ) => {
      const code = roomCode?.toUpperCase();
      const state = gm.getSession(code);
      if (!state || !gm.verifyToken(code, teamId, token)) {
        ack?.({ ok: false, error: 'Invalid session' });
        return;
      }
      const team = state.teams.find((t) => t.id === teamId);
      if (!team) {
        ack?.({ ok: false, error: 'Team not found' });
        return;
      }
      team.connected = true;
      socket.join(code);
      gm.socketTeams.set(socket.id, { roomCode: code, teamId });
      socket.emit(SOCKET_EVENTS.TEAM_JOINED, { team, token, state });
      emitTeamSheet(socket, code, teamId);
      emitState(io, code);
      ack?.({ ok: true, team });
    });

    socket.on(SOCKET_EVENTS.TEAM_REJOIN_BY_NAME, (
      { roomCode, name, pin }: { roomCode: string; name: string; pin?: string },
      ack?: (r: unknown) => void,
    ) => {
      const code = roomCode?.toUpperCase();
      const result = gm.rejoinTeamByName(code, name, pin);
      if ('error' in result) {
        ack?.({ ok: false, error: result.error });
        return;
      }
      socket.join(code);
      gm.socketTeams.set(socket.id, { roomCode: code, teamId: result.team.id });
      socket.emit(SOCKET_EVENTS.TEAM_JOINED, {
        team: result.team,
        token: result.token,
        state: result.state,
      });
      emitTeamSheet(socket, code, result.team.id);
      emitState(io, code);
      ack?.({ ok: true, team: result.team, token: result.token });
    });

    socket.on(SOCKET_EVENTS.HOST_ADD_TEAM, ({ roomCode, name, color }: { roomCode: string; name: string; color?: string }) => {
      const code = roomCode.toUpperCase();
      const result = gm.addTeam(code, name, color);
      if ('error' in result) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: result.error });
        return;
      }
      emitState(io, code);
      emitHostSecrets(io, code);
    });

    socket.on(SOCKET_EVENTS.HOST_REMOVE_TEAM, ({ roomCode, teamId }: { roomCode: string; teamId: string }) => {
      const code = roomCode.toUpperCase();
      gm.removeTeam(code, teamId);
      emitState(io, code);
      emitHostSecrets(io, code);
    });

    socket.on(SOCKET_EVENTS.HOST_RENAME_TEAM, ({ roomCode, teamId, name }: { roomCode: string; teamId: string; name: string }) => {
      const code = roomCode.toUpperCase();
      const r = gm.renameTeam(code, teamId, name);
      if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
      else {
        emitState(io, code);
        emitHostSecrets(io, code);
      }
    });

    socket.on(SOCKET_EVENTS.HOST_START, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      const r = gm.startGame(code);
      if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
      else {
        emitState(io, code);
        emitHostSecrets(io, code);
        emitAllTeamSheets(io, code);
      }
    });

    socket.on(SOCKET_EVENTS.HOST_ROUND_INTRO, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      const state = gm.getSession(code);
      if (!state) return;
      state.phase = 'round_intro';
      state.currentQuestion = null;
      emitState(io, code);
      emitAllTeamSheets(io, code);
    });

    socket.on(SOCKET_EVENTS.HOST_SHOW_QUESTION, ({ roomCode, questionIndex }: { roomCode: string; questionIndex?: number }) => {
      const code = roomCode.toUpperCase();
      const r = gm.showQuestion(code, questionIndex);
      if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
      else {
        emitState(io, code);
        emitHostSecrets(io, code);
        emitAllTeamSheets(io, code);
      }
    });

    socket.on(SOCKET_EVENTS.HOST_NEXT_QUESTION, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      const r = gm.nextQuestion(code);
      if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
      else {
        emitState(io, code);
        emitHostSecrets(io, code);
        emitAllTeamSheets(io, code);
      }
    });

    socket.on(SOCKET_EVENTS.HOST_PREV_QUESTION, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      const r = gm.prevQuestion(code);
      if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
      else {
        emitState(io, code);
        emitHostSecrets(io, code);
        emitAllTeamSheets(io, code);
      }
    });

    socket.on(
      SOCKET_EVENTS.HOST_UPDATE_QUESTION_MEDIA,
      async ({
        roomCode,
        questionIndex,
        media,
        persist,
        roundIndex,
      }: {
        roomCode: string;
        questionIndex: number;
        media: import('../shared/types.js').MediaRef;
        persist?: boolean;
        roundIndex?: number;
      }) => {
        const code = roomCode.toUpperCase();
        const r = await gm.updateQuestionMedia(code, { questionIndex, media, persist, roundIndex });
        if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
        else {
          emitState(io, code);
          emitHostSecrets(io, code);
          emitAllTeamSheets(io, code);
        }
      },
    );

    socket.on(SOCKET_EVENTS.HOST_LOCK, async ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      const r = await gm.lockRound(code);
      if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
      else {
        emitState(io, code);
        emitHostSecrets(io, code);
        emitAllTeamSheets(io, code);
      }
    });

    socket.on(SOCKET_EVENTS.HOST_UNLOCK, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      const r = gm.unlockRound(code);
      if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
      else {
        emitState(io, code);
        emitHostSecrets(io, code);
        emitAllTeamSheets(io, code);
      }
    });

    socket.on(SOCKET_EVENTS.HOST_BEGIN_REVEAL, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      const r = gm.beginReveal(code);
      if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
      else {
        emitState(io, code);
        emitHostSecrets(io, code);
        emitAllTeamSheets(io, code);
      }
    });

    socket.on(SOCKET_EVENTS.HOST_REVEAL_NEXT, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      const r = gm.revealNext(code);
      if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
      else if (r.done) {
        gm.openScoring(code);
        gm.applyAutoScores(code);
        emitState(io, code);
        emitHostSecrets(io, code);
        emitAllTeamSheets(io, code);
      } else {
        emitState(io, code);
        emitHostSecrets(io, code);
        emitAllTeamSheets(io, code);
      }
    });

    socket.on(SOCKET_EVENTS.HOST_OPEN_SCORING, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      gm.applyAutoScores(code);
      gm.openScoring(code);
      emitState(io, code);
      emitHostSecrets(io, code);
    });

    socket.on(
      SOCKET_EVENTS.HOST_SET_GRADE,
      ({
        roomCode,
        teamId,
        questionIndex,
        verdict,
        pointsAwarded,
      }: {
        roomCode: string;
        teamId: string;
        questionIndex: number;
        verdict: 'correct' | 'incorrect' | 'review';
        pointsAwarded?: number;
      }) => {
        const code = roomCode.toUpperCase();
        const r = gm.setGrade(code, teamId, questionIndex, verdict, pointsAwarded);
        if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
        else {
          emitState(io, code);
          emitHostSecrets(io, code);
          emitAllTeamSheets(io, code);
        }
      },
    );

    socket.on(SOCKET_EVENTS.HOST_ADJUST_SCORE, ({ roomCode, teamId, delta }: { roomCode: string; teamId: string; delta: number }) => {
      const code = roomCode.toUpperCase();
      gm.adjustScore(code, teamId, delta);
      emitState(io, code);
      emitHostSecrets(io, code);
    });

    socket.on(SOCKET_EVENTS.HOST_SET_SCORE, ({ roomCode, teamId, score }: { roomCode: string; teamId: string; score: number }) => {
      const code = roomCode.toUpperCase();
      gm.setScore(code, teamId, score);
      emitState(io, code);
      emitHostSecrets(io, code);
    });

    socket.on(SOCKET_EVENTS.HOST_SHOW_LEADERBOARD, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      gm.showLeaderboard(code);
      emitState(io, code);
      emitHostSecrets(io, code);
    });

    socket.on(SOCKET_EVENTS.HOST_HIDE_LEADERBOARD, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      gm.hideLeaderboard(code);
      emitState(io, code);
    });

    socket.on(SOCKET_EVENTS.HOST_NEXT_ROUND, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      gm.nextRound(code);
      emitState(io, code);
      emitHostSecrets(io, code);
      emitAllTeamSheets(io, code);
    });

    socket.on(SOCKET_EVENTS.HOST_END_GAME, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      gm.endGame(code);
      emitState(io, code);
      emitHostSecrets(io, code);
      emitAllTeamSheets(io, code);
    });

    socket.on(SOCKET_EVENTS.HOST_CLOSE_ROOM, ({ roomCode }: { roomCode: string }) => {
      const code = roomCode.toUpperCase();
      io.to(code).emit(SOCKET_EVENTS.GAME_ENDED);
      gm.deleteSession(code);
    });

    socket.on(SOCKET_EVENTS.HOST_PAPER_ANSWERS, ({ roomCode, teamId, answers }: { roomCode: string; teamId: string; answers: string[] }) => {
      const code = roomCode.toUpperCase();
      gm.setPaperAnswers(code, teamId, answers);
      emitHostSecrets(io, code);
    });

    socket.on(SOCKET_EVENTS.HOST_SET_TIMER, ({ roomCode, seconds }: { roomCode: string; seconds: number | null }) => {
      const code = roomCode.toUpperCase();
      const r = gm.setTimer(code, seconds);
      if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
      else emitState(io, code);
    });

    socket.on(SOCKET_EVENTS.HOST_SET_THEME, ({ roomCode, themeId }: { roomCode: string; themeId: string }) => {
      const code = roomCode.toUpperCase();
      const r = gm.setTheme(code, themeId);
      if (!r.ok) socket.emit(SOCKET_EVENTS.ERROR, { message: r.error });
      else emitState(io, code);
    });

    socket.on(SOCKET_EVENTS.TEAM_UPDATE_ANSWERS, (
      payload: { answers: string[]; roomCode?: string; teamId?: string; token?: string },
      ack?: (r: unknown) => void,
    ) => {
      const meta = resolveTeamAuth(socket, payload);
      if ('error' in meta) {
        ack?.({ ok: false, error: meta.error });
        return;
      }
      const r = gm.updateAnswers(meta.roomCode, meta.teamId, payload.answers ?? []);
      if (r.ok) {
        emitHostSecrets(io, meta.roomCode);
        emitTeamSheet(socket, meta.roomCode, meta.teamId);
      }
      ack?.(r);
    });

    socket.on(SOCKET_EVENTS.TEAM_SUBMIT, (
      payload: { answers?: string[]; roomCode?: string; teamId?: string; token?: string } | undefined,
      ack?: (r: unknown) => void,
    ) => {
      const meta = resolveTeamAuth(socket, payload);
      if ('error' in meta) {
        ack?.({ ok: false, error: meta.error });
        return;
      }
      // Persist first (fail-closed) — do not mark submitted if answers cannot be saved
      if (payload?.answers) {
        const saved = gm.updateAnswers(meta.roomCode, meta.teamId, payload.answers, { allowIfSubmitted: true });
        if (!saved.ok) {
          ack?.(saved);
          return;
        }
      }
      const r = gm.submitSheet(meta.roomCode, meta.teamId, payload?.answers);
      if (r.ok) {
        emitState(io, meta.roomCode);
        emitHostSecrets(io, meta.roomCode);
        emitTeamSheet(socket, meta.roomCode, meta.teamId);
      }
      ack?.(r);
    });

    socket.on(SOCKET_EVENTS.GET_STATE, ({ roomCode }: { roomCode: string }) => {
      const state = gm.getSession(String(roomCode || '').toUpperCase());
      if (state) socket.emit(SOCKET_EVENTS.GAME_STATE, state);
    });

    socket.on('disconnect', () => {
      const meta = gm.socketTeams.get(socket.id);
      if (meta) {
        const state = gm.getSession(meta.roomCode);
        const team = state?.teams.find((t) => t.id === meta.teamId);
        if (team) team.connected = false;
        gm.socketTeams.delete(socket.id);
        if (state) emitState(io, meta.roomCode);
      }
    });
  });
}
