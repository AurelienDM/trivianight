/**
 * Trivia Night desktop shell (Electron).
 * Starts the Express backend (serving the built SPA) and opens a BrowserWindow.
 */
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const os = require('os');
const fs = require('fs');

function resolveBackendDir() {
  const packaged = path.join(__dirname, 'backend');
  if (fs.existsSync(path.join(packaged, 'package.json'))) return packaged;
  return path.join(__dirname, '..', 'backend');
}

const BACKEND_DIR = resolveBackendDir();
const ROOT = path.resolve(BACKEND_DIR, '..');

/** Minimal .env loader (no dotenv dependency). Does not override existing env. */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));
loadEnvFile(path.join(BACKEND_DIR, '.env'));

// Desktop-only default: production servers must still set HOST_PASSCODE explicitly.
// Electron runs the backend with NODE_ENV=production, which would otherwise refuse to start.
if (!process.env.HOST_PASSCODE) {
  process.env.HOST_PASSCODE = 'trivia-local';
}

const PORT = Number(process.env.PORT || 43128);
const UI_PORT = PORT; // production: SPA served from same Express process

let serverProc = null;
let mainWindow = null;

function lanIp() {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        return iface.address;
      }
    }
  }
  return null;
}

function waitForHealth(timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else if (Date.now() - started > timeoutMs) reject(new Error('health timeout'));
        else setTimeout(tick, 400);
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('health timeout'));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

function startServer() {
  const env = {
    ...process.env,
    PORT: String(PORT),
    UI_PORT: String(UI_PORT),
    FRONTEND_PORT: String(UI_PORT),
    DATA_DIR: path.join(BACKEND_DIR, 'data'),
    NODE_ENV: process.env.NODE_ENV || 'production',
    HOST_PASSCODE: process.env.HOST_PASSCODE || 'trivia-local',
  };
  // Prefer compiled dist; fall back to tsx for dev without build
  const distEntry = path.join(BACKEND_DIR, 'dist', 'index.js');
  let cmd;
  let args;
  if (fs.existsSync(distEntry)) {
    cmd = process.execPath;
    args = [distEntry];
  } else {
    cmd = path.join(BACKEND_DIR, 'node_modules', '.bin', 'tsx');
    args = [path.join(BACKEND_DIR, 'src', 'index.ts')];
  }
  console.log(`[desktop] HOST_PASSCODE ${env.HOST_PASSCODE === 'trivia-local' ? '(default trivia-local)' : '(from env/.env)'}`);
  const childEnv = cmd === process.execPath
    ? { ...env, ELECTRON_RUN_AS_NODE: '1' }
    : env;
  serverProc = spawn(cmd, args, {
    cwd: BACKEND_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => console.log(`[server] ${d}`.trimEnd()));
  serverProc.stderr.on('data', (d) => console.error(`[server] ${d}`.trimEnd()));
  serverProc.on('exit', (code) => console.log(`[server] exited ${code}`));
}

async function createWindow() {
  const hostPasscode = process.env.HOST_PASSCODE || 'trivia-local';
  // Ensure preload can read the same value (preload inherits env; argv is backup).
  process.env.HOST_PASSCODE = hostPasscode;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Trivia Night',
    backgroundColor: '#FBF6EE',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [`--trivia-host-passcode=${hostPasscode}`],
    },
  });

  const ip = lanIp();
  console.log(`Trivia Night desktop`);
  console.log(`  Local:   http://127.0.0.1:${PORT}`);
  if (ip) console.log(`  LAN:     http://${ip}:${PORT}  ← teams scan QR / join`);

  await mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForHealth();
  } catch (err) {
    console.error(err);
  }
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
});
