/**
 * Injects the desktop HOST_PASSCODE into the renderer so hostFetch never
 * calls window.prompt (unsupported / hanging in Electron).
 */
const { contextBridge } = require('electron');

function passcodeFromArgv() {
  const prefix = '--trivia-host-passcode=';
  const hit = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

const hostPasscode =
  process.env.HOST_PASSCODE ||
  passcodeFromArgv() ||
  'trivia-local';

contextBridge.exposeInMainWorld('triviaDesktop', {
  hostPasscode,
  isDesktop: true,
});
