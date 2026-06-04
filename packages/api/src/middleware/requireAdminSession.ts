import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  getSessionCookie,
  serializeClearSessionCookie,
  serializeSessionCookie,
} from '../auth/cookies.js';
import { type ValidAdminSession, validateSession } from '../auth/session.js';

export type AdminRequestAuth = ValidAdminSession;
export type AdminSessionRequest = Request & { admin?: AdminRequestAuth };

function rejectUnauthorized(res: Response): void {
  res.setHeader('Set-Cookie', serializeClearSessionCookie());
  res.status(401).json({ error: 'Unauthorized' });
}

export const requireAdminSession: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = getSessionCookie(req.headers.cookie);
  if (!token) {
    rejectUnauthorized(res);
    return;
  }

  const auth = await validateSession(token);
  if (!auth) {
    rejectUnauthorized(res);
    return;
  }

  (req as AdminSessionRequest).admin = auth;
  res.setHeader('Set-Cookie', serializeSessionCookie(token, auth.cookieExpiresAt));
  next();
};
