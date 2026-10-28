import type { NextFunction, Request, Response } from 'express';

function hostPasscode(): string | undefined {
  return process.env.HOST_PASSCODE || undefined;
}

// Fail fast at module load if production starts with open write access.
if (!hostPasscode() && process.env.NODE_ENV === 'production') {
  throw new Error('HOST_PASSCODE must be set in production — refusing to start with open write access');
}

// Gates mutating board/media routes behind a shared passcode so a stranger
// on the LAN (or internet, once deployed) can't edit or delete a game in
// progress. Left permissive when HOST_PASSCODE is unset in dev for convenience.
// Read env per request so desktop can set HOST_PASSCODE before spawning workers.
export function requireHostPasscode(req: Request, res: Response, next: NextFunction) {
  const expected = hostPasscode();
  if (!expected) return next();
  const provided = req.header('X-Host-Passcode');
  if (provided === expected) return next();
  res.status(401).json({ error: 'Invalid or missing host passcode' });
}
