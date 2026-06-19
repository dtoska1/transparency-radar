import { isAdminSessionCookieSecure } from './config.js';
import { getCookieValue } from './cookies.js';

const OAUTH_STATE_COOKIE_NAME = 'tra_admin_oauth';
const OAUTH_STATE_COOKIE_MAX_AGE_SECONDS = 600;

export interface OAuthStateCookieValue {
  state: string;
  codeVerifier: string;
}

export function serializeOAuthStateCookie(state: string, codeVerifier: string): string {
  const attributes = [
    `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(`${state}.${codeVerifier}`)}`,
    'Path=/',
    'HttpOnly',
  ];
  if (isAdminSessionCookieSecure()) attributes.push('Secure');
  attributes.push('SameSite=Lax', `Max-Age=${OAUTH_STATE_COOKIE_MAX_AGE_SECONDS.toString()}`);
  return attributes.join('; ');
}

export function serializeClearOAuthStateCookie(): string {
  const attributes = [`${OAUTH_STATE_COOKIE_NAME}=`, 'Path=/', 'HttpOnly'];
  if (isAdminSessionCookieSecure()) attributes.push('Secure');
  attributes.push('SameSite=Lax', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'Max-Age=0');
  return attributes.join('; ');
}

export function getOAuthStateCookie(
  cookieHeader: string | undefined,
): OAuthStateCookieValue | undefined {
  const raw = getCookieValue(cookieHeader, OAUTH_STATE_COOKIE_NAME);
  if (!raw) return undefined;

  const separatorIndex = raw.indexOf('.');
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) return undefined;

  return {
    state: raw.slice(0, separatorIndex),
    codeVerifier: raw.slice(separatorIndex + 1),
  };
}
