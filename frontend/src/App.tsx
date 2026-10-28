import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { socket } from './socket';
import { useGameStore } from './store/gameStore';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import Host from './pages/Host';
import TvView from './pages/TvView';
import Join from './pages/Join';
import TeamSheet from './pages/TeamSheet';
import Settings from './pages/Settings';
import Bank from './pages/Bank';
import type { GameState, HostSecrets, TeamPublic } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/socketEvents';

export default function App() {
  const { setGameState, setConnected, setHostSecrets, setMyTeam, setTeamSheet } = useGameStore();

  useEffect(() => {
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on(SOCKET_EVENTS.GAME_STATE, (state: GameState) => setGameState(state));
    socket.on(SOCKET_EVENTS.HOST_CREATED, ({ state }: { roomCode: string; state: GameState }) => setGameState(state));
    socket.on(SOCKET_EVENTS.HOST_SECRETS, (secrets: HostSecrets) => setHostSecrets(secrets));
    socket.on(SOCKET_EVENTS.TEAM_JOINED, ({ team, token, state }: { team: TeamPublic; token: string; state: GameState }) => {
      setMyTeam(team);
      useGameStore.getState().setTeamToken(token);
      try {
        localStorage.setItem(`trivia-night:team:${state.roomCode}`, JSON.stringify({ teamId: team.id, token }));
      } catch { /* ignore */ }
      setGameState(state);
    });
    socket.on(SOCKET_EVENTS.TEAM_SHEET, (sheet) => setTeamSheet(sheet));
    socket.connect();
    return () => { socket.disconnect(); };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/editor/:quizId" element={<Editor />} />
        <Route path="/host/:quizId" element={<Host />} />
        <Route path="/host/room/:roomCode" element={<Host />} />
        <Route path="/tv/:roomCode" element={<TvView />} />
        <Route path="/join" element={<Join />} />
        <Route path="/join/:roomCode" element={<Join />} />
        <Route path="/team/:roomCode" element={<TeamSheet />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/bank" element={<Bank />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
