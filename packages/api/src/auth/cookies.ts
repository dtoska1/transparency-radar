import { ADMIN_SESSION_COOKIE_NAME, isAdminSessionCookieSecure } from './config.js';

export function getCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = part.trim().split('=');
    if (rawName !== name) continue;

    const rawValue = rawValueParts.join('=');
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return undefined;
}

export function getSessionCookie(cookieHeader: string | undefined): string | undefined {
  return getCookieValue(cookieHeader, ADMIN_SESSION_COOKIE_NAME);
}

export function serializeSessionCookie(token: string, expiresAt: Date): string {
  const attributes = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
  ];
  if (isAdminSessionCookieSecure()) attributes.push('Secure');
  attributes.push('SameSite=Strict', `Expires=${expiresAt.toUTCString()}`);
  return attributes.join('; ');
}

export function serializeClearSessionCookie(): string {
  const attributes = [`${ADMIN_SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly'];
  if (isAdminSessionCookieSecure()) attributes.push('Secure');
  attributes.push('SameSite=Strict', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'Max-Age=0');
  return attributes.join('; ');
}
