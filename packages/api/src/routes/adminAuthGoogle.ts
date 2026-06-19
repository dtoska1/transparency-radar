import { randomBytes } from 'node:crypto';
import { admin_allowlist, admin_users, db } from '@tra/db';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { serializeSessionCookie } from '../auth/cookies.js';
import { createGoogleAuthorizationURL, exchangeGoogleCode } from '../auth/google.js';
import { isAllowedAdminEmail } from '../auth/googleGate.js';
import {
  getOAuthStateCookie,
  serializeClearOAuthStateCookie,
  serializeOAuthStateCookie,
} from '../auth/oauthStateCookie.js';
import { hashPassword } from '../auth/password.js';
import { createSession } from '../auth/session.js';
import { getAllowedOrigins } from '../config.js';

const LOGIN_FAILURE_REDIRECT = '/login?error=not_authorized';
const LOGIN_SUCCESS_REDIRECT = '/';

// The browser is on the API's origin when this completes (Google redirected here
// directly), but the admin UI lives on a different origin — build an absolute URL
// from the first configured admin origin so the redirect lands on the right host.
function resolveAdminUiRedirect(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const [origin] = getAllowedOrigins(env);
  return origin ? new URL(path, origin).toString() : path;
}

export const handleGoogleStart: RequestHandler = (_req, res) => {
  let authRequest: ReturnType<typeof createGoogleAuthorizationURL>;
  try {
    authRequest = createGoogleAuthorizationURL();
  } catch {
    res.status(500).json({ error: 'Google sign-in is not configured' });
    return;
  }

  res.setHeader(
    'Set-Cookie',
    serializeOAuthStateCookie(authRequest.state, authRequest.codeVerifier),
  );
  res.redirect(authRequest.url.toString());
};

async function findAllowlistedEmails(): Promise<Set<string>> {
  const rows = await db.select({ email: admin_allowlist.email }).from(admin_allowlist);
  return new Set(rows.map((row) => row.email));
}

async function findOrCreateAdminByEmail(email: string): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: admin_users.id })
    .from(admin_users)
    .where(eq(admin_users.email, email))
    .limit(1);
  if (existing) return existing;

  const id = randomBytes(16).toString('hex');
  const placeholderPasswordHash = await hashPassword(randomBytes(32).toString('hex'));
  await db.insert(admin_users).values({ id, email, password_hash: placeholderPasswordHash });
  return { id };
}

function rejectGoogleLogin(res: Parameters<RequestHandler>[1]): void {
  res.setHeader('Set-Cookie', serializeClearOAuthStateCookie());
  res.redirect(resolveAdminUiRedirect(LOGIN_FAILURE_REDIRECT));
}

export const handleGoogleCallback: RequestHandler = async (req, res) => {
  const stored = getOAuthStateCookie(req.headers.cookie);
  const queryState = typeof req.query.state === 'string' ? req.query.state : undefined;
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;

  if (!stored || !queryState || !code || stored.state !== queryState) {
    rejectGoogleLogin(res);
    return;
  }

  let claims: Awaited<ReturnType<typeof exchangeGoogleCode>>;
  try {
    claims = await exchangeGoogleCode(code, stored.codeVerifier);
  } catch {
    rejectGoogleLogin(res);
    return;
  }

  if (claims.email_verified !== true || !claims.email) {
    rejectGoogleLogin(res);
    return;
  }

  const email = claims.email.toLowerCase();
  const allowlist = await findAllowlistedEmails();
  if (!isAllowedAdminEmail(email, allowlist)) {
    rejectGoogleLogin(res);
    return;
  }

  const admin = await findOrCreateAdminByEmail(email);
  const session = await createSession(admin.id);
  res.setHeader('Set-Cookie', [
    serializeClearOAuthStateCookie(),
    serializeSessionCookie(session.token, session.expiresAt),
  ]);
  res.redirect(resolveAdminUiRedirect(LOGIN_SUCCESS_REDIRECT));
};
