const STORAGE_KEY = 'trivia-night:hostPasscode';
const FETCH_TIMEOUT_MS = 20_000;

declare global {
  interface Window {
    triviaDesktop?: {
      hostPasscode?: string;
      isDesktop?: boolean;
    };
  }
}

function getDesktopPasscode(): string | null {
  const fromBridge = window.triviaDesktop?.hostPasscode?.trim();
  if (fromBridge) return fromBridge;
  return null;
}

function isElectronRuntime(): boolean {
  if (window.triviaDesktop?.isDesktop) return true;
  const ua = navigator.userAgent || '';
  return /\bElectron\b/i.test(ua);
}

function getStoredPasscode(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function setStoredPasscode(value: string) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* ignore */ }
}

function clearStoredPasscode() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** In-DOM modal — Electron does not support window.prompt. */
function promptForPasscodeModal(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.55)', 'padding:1rem',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:#16142a', 'color:#f5f2e8', 'border-radius:12px',
      'padding:1.25rem 1.5rem', 'max-width:22rem', 'width:100%',
      'box-shadow:0 12px 40px rgba(0,0,0,0.45)',
      'font-family:system-ui,sans-serif',
    ].join(';');

    const title = document.createElement('p');
    title.textContent = 'Enter the host passcode';
    title.style.cssText = 'margin:0 0 0.75rem;font-weight:600';

    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.style.cssText = [
      'width:100%', 'box-sizing:border-box', 'padding:0.55rem 0.7rem',
      'border-radius:8px', 'border:1px solid #3a3658',
      'background:#0b0a1a', 'color:#f5f2e8', 'margin-bottom:0.85rem',
    ].join(';');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:0.5rem;justify-content:flex-end';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'padding:0.4rem 0.8rem;border-radius:8px;border:none;background:#2a2740;color:#f5f2e8;cursor:pointer';

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    ok.style.cssText = 'padding:0.4rem 0.8rem;border-radius:8px;border:none;background:#c9a227;color:#0b0a1a;cursor:pointer;font-weight:600';

    const finish = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };

    cancel.onclick = () => finish(null);
    ok.onclick = () => {
      const value = input.value.trim();
      if (value) setStoredPasscode(value);
      finish(value || null);
    };
    input.onkeydown = (ev) => {
      if (ev.key === 'Enter') ok.click();
      if (ev.key === 'Escape') cancel.click();
    };

    row.append(cancel, ok);
    panel.append(title, input, row);
    overlay.append(panel);
    document.body.append(overlay);
    input.focus();
  });
}

async function resolvePasscode(forcePrompt: boolean): Promise<string | null> {
  if (!forcePrompt) {
    const desktop = getDesktopPasscode();
    if (desktop) return desktop;
    const stored = getStoredPasscode();
    if (stored) return stored;
    // Electron without preload still needs a non-hanging default for local desktop.
    if (isElectronRuntime()) {
      const fallback = 'trivia-local';
      setStoredPasscode(fallback);
      return fallback;
    }
  } else {
    clearStoredPasscode();
  }

  if (typeof window.prompt === 'function' && !isElectronRuntime() && !window.triviaDesktop) {
    try {
      const value = window.prompt('Enter the host passcode:');
      if (value) {
        setStoredPasscode(value);
        return value;
      }
      return null;
    } catch {
      /* fall through to modal */
    }
  }

  return promptForPasscodeModal();
}

export async function hostFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let passcode = await resolvePasscode(false);

  const headers = new Headers(init.headers);
  if (passcode) headers.set('X-Host-Passcode', passcode);

  const controller = new AbortController();
  const outerSignal = init.signal;
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let res = await fetch(input, { ...init, headers, signal: controller.signal });

    if (res.status === 401) {
      const retry = await resolvePasscode(true);
      if (retry) {
        headers.set('X-Host-Passcode', retry);
        res = await fetch(input, { ...init, headers, signal: controller.signal });
      }
    }

    return res;
  } finally {
    clearTimeout(timer);
  }
}
