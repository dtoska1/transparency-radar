export const ADMIN_SESSION_COOKIE_NAME = 'tra_admin_session';
export const ADMIN_SESSION_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
export const ADMIN_SESSION_ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const MIN_ADMIN_SESSION_SECRET_LENGTH = 32;

export function isAdminSessionCookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'development';
}

export function assertAdminSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < MIN_ADMIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `ADMIN_SESSION_SECRET is required and must be at least ${MIN_ADMIN_SESSION_SECRET_LENGTH.toString()} characters`,
    );
  }
  return secret;
}
