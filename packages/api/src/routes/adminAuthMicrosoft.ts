import { randomBytes } from 'node:crypto';
import { admin_allowlist, admin_users, db } from '@tra/db';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { isAllowedAdminEmail } from '../auth/adminEmailGate.js';
import { serializeSessionCookie } from '../auth/cookies.js';
import {
  assertMicrosoftOAuthConfig,
  createMicrosoftAuthorizationURL,
  exchangeMicrosoftCode,
} from '../auth/microsoft.js';
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

// The browser is on the API's origin when this completes (Microsoft redirected here
// directly), but the admin UI lives on a different origin — build an absolute URL
// from the first configured admin origin so the redirect lands on the right host.
function resolveAdminUiRedirect(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const [origin] = getAllowedOrigins(env);
  return origin ? new URL(path, origin).toString() : path;
}

export const handleMicrosoftStart: RequestHandler = (_req, res) => {
  let authRequest: ReturnType<typeof createMicrosoftAuthorizationURL>;
  try {
    authRequest = createMicrosoftAuthorizationURL();
  } catch {
    res.status(500).json({ error: 'Microsoft sign-in is not configured' });
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

function rejectMicrosoftLogin(res: Parameters<RequestHandler>[1]): void {
  res.setHeader('Set-Cookie', serializeClearOAuthStateCookie());
  res.redirect(resolveAdminUiRedirect(LOGIN_FAILURE_REDIRECT));
}

export const handleMicrosoftCallback: RequestHandler = async (req, res) => {
  const stored = getOAuthStateCookie(req.headers.cookie);
  const queryState = typeof req.query.state === 'string' ? req.query.state : undefined;
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;

  if (!stored || !queryState || !code || stored.state !== queryState) {
    rejectMicrosoftLogin(res);
    return;
  }

  let claims: Awaited<ReturnType<typeof exchangeMicrosoftCode>>;
  try {
    claims = await exchangeMicrosoftCode(code, stored.codeVerifier);
  } catch {
    rejectMicrosoftLogin(res);
    return;
  }

  const { tenantId } = assertMicrosoftOAuthConfig();
  if (claims.tid !== tenantId) {
    rejectMicrosoftLogin(res);
    return;
  }

  // `email_verified` (per OIDC) attests to the `email` claim specifically, not to
  // `preferred_username`. We require it === true here, then fall back to
  // preferred_username only when `email` is absent. On that fallback path the
  // verified flag did not cover the value we use — but the single-tenant `tid`
  // check above plus the @csdgalbania.org domain gate below guarantee the UPN is a
  // verified-directory CSDG identity, so the residual risk is acceptable for this
  // internal admin tool. Do not relax the tenant or domain checks on the assumption
  // that email_verified alone is sufficient.
  if (claims.email_verified !== true) {
    rejectMicrosoftLogin(res);
    return;
  }

  const rawEmail = claims.email ?? claims.preferred_username;
  if (!rawEmail || !rawEmail.includes('@')) {
    rejectMicrosoftLogin(res);
    return;
  }
  const email = rawEmail.toLowerCase();

  const allowlist = await findAllowlistedEmails();
  if (!isAllowedAdminEmail(email, allowlist)) {
    rejectMicrosoftLogin(res);
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
