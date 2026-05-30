import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    res.status(503).json({ error: 'Admin access not configured' });
    return;
  }

  const authHeader = req.headers.authorization ?? '';
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const provided = authHeader.slice(prefix.length);

  // Constant-time compare: pad both to the same length so timingSafeEqual never throws,
  // then also gate on length equality so null-padded short tokens can't match.
  const tokenBuf = Buffer.from(token);
  const providedBuf = Buffer.from(provided);
  const maxLen = Math.max(tokenBuf.length, providedBuf.length);
  const a = Buffer.alloc(maxLen);
  const b = Buffer.alloc(maxLen);
  tokenBuf.copy(a);
  providedBuf.copy(b);

  if (tokenBuf.length !== providedBuf.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
