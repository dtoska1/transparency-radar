import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdminSessionCookieSecure } from './config.js';
import { serializeClearSessionCookie, serializeSessionCookie } from './cookies.js';

const EXPIRES_AT = new Date('2026-06-06T12:00:00.000Z');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('admin session cookie security', () => {
  it('is fail-closed outside explicit development', () => {
    expect(isAdminSessionCookieSecure({})).toBe(true);
    expect(isAdminSessionCookieSecure({ NODE_ENV: 'test' })).toBe(true);
    expect(isAdminSessionCookieSecure({ NODE_ENV: 'production' })).toBe(true);
    expect(isAdminSessionCookieSecure({ NODE_ENV: 'staging' })).toBe(true);
    expect(isAdminSessionCookieSecure({ NODE_ENV: 'development' })).toBe(false);
  });

  it('keeps strict live and clearing cookies secure by default', () => {
    vi.stubEnv('NODE_ENV', 'test');

    expect(serializeSessionCookie('raw token', EXPIRES_AT)).toBe(
      'tra_admin_session=raw%20token; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=Sat, 06 Jun 2026 12:00:00 GMT',
    );
    expect(serializeClearSessionCookie()).toBe(
      'tra_admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0',
    );
  });

  it('omits only Secure from live and clearing cookies in development', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(serializeSessionCookie('raw token', EXPIRES_AT)).toBe(
      'tra_admin_session=raw%20token; Path=/; HttpOnly; SameSite=Strict; Expires=Sat, 06 Jun 2026 12:00:00 GMT',
    );
    expect(serializeClearSessionCookie()).toBe(
      'tra_admin_session=; Path=/; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0',
    );
  });
});
