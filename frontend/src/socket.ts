import { io } from 'socket.io-client';

function getBackendUrl(): string {
  if (import.meta.env.VITE_BACKEND_URL) return import.meta.env.VITE_BACKEND_URL;
  if (import.meta.env.PROD) return window.location.origin;
  return `${window.location.protocol}//${window.location.hostname}:43128`;
}

export const socket = io(getBackendUrl(), {
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10,
});
