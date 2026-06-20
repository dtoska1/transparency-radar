import { admin_users, db } from '@tra/db';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { assertAdminSessionSecret } from '../auth/config.js';
import {
  getSessionCookie,
  serializeClearSessionCookie,
  serializeSessionCookie,
} from '../auth/cookies.js';
import { DUMMY_ARGON2ID_HASH, DUMMY_LOGIN_PASSWORD, verifyPasswordHash } from '../auth/password.js';
import { createSession, invalidateSession } from '../auth/session.js';
import { handleMicrosoftCallback, handleMicrosoftStart } from './adminAuthMicrosoft.js';

const LoginBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    password: z.string().min(1).max(1024),
  })
  .strict();

const DUMMY_LOGIN_EMAIL = 'missing-admin@example.invalid';
const UNAUTHORIZED_BODY = { error: 'Unauthorized' };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getStringField(body: unknown, field: 'email' | 'password'): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

function sendUnauthorized(res: Parameters<RequestHandler>[1]): void {
  res.status(401).json(UNAUTHORIZED_BODY);
}

export const handleAdminLogin: RequestHandler = async (req, res) => {
  const bodyParse = LoginBodySchema.safeParse(req.body);

  const timingEmail = normalizeEmail(
    bodyParse.success
      ? bodyParse.data.email
      : (getStringField(req.body, 'email') ?? DUMMY_LOGIN_EMAIL),
  );
  const timingPassword = bodyParse.success
    ? bodyParse.data.password
    : (getStringField(req.body, 'password') ?? DUMMY_LOGIN_PASSWORD);

  const [user] = await db
    .select({
      id: admin_users.id,
      email: admin_users.email,
      password_hash: admin_users.password_hash,
      disabled_at: admin_users.disabled_at,
    })
    .from(admin_users)
    .where(eq(admin_users.email, timingEmail))
    .limit(1);

  const passwordHash = user?.password_hash ?? DUMMY_ARGON2ID_HASH;
  const passwordMatches = await verifyPasswordHash(passwordHash, timingPassword);

  if (!bodyParse.success || !user || user.disabled_at !== null || !passwordMatches) {
    sendUnauthorized(res);
    return;
  }

  const session = await createSession(user.id);
  res.setHeader('Set-Cookie', serializeSessionCookie(session.token, session.expiresAt));
  res.json({ ok: true });
};

export const handleAdminLogout: RequestHandler = async (req, res) => {
  const token = getSessionCookie(req.headers.cookie);
  await invalidateSession(token);
  res.setHeader('Set-Cookie', serializeClearSessionCookie());
  res.json({ ok: true });
};

export function createAdminAuthRouter(): Router {
  assertAdminSessionSecret();

  const router = Router();
  router.post('/login', handleAdminLogin);
  router.post('/logout', handleAdminLogout);
  router.get('/microsoft', handleMicrosoftStart);
  router.get('/microsoft/callback', handleMicrosoftCallback);
  return router;
}
