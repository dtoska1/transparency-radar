import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOAuthStateCookie,
  serializeClearOAuthStateCookie,
  serializeOAuthStateCookie,
} from './oauthStateCookie.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OAuth state cookie', () => {
  it('round-trips state and codeVerifier through serialize + parse', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const setCookieHeader = serializeOAuthStateCookie('the-state', 'the-code-verifier');

    // Simulate the browser sending back only the cookie's name=value pair.
    const cookiePair = setCookieHeader.split(';')[0];
    expect(cookiePair).toBeDefined();

    const parsed = getOAuthStateCookie(cookiePair);
    expect(parsed).toEqual({ state: 'the-state', codeVerifier: 'the-code-verifier' });
  });

  it('returns undefined when no cookie header is present', () => {
    expect(getOAuthStateCookie(undefined)).toBeUndefined();
  });

  it('returns undefined when the cookie is malformed', () => {
    expect(getOAuthStateCookie('tra_admin_oauth=not-a-valid-pair')).toBeUndefined();
  });

  it('sets HttpOnly, SameSite=Lax, and a short Max-Age', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const header = serializeOAuthStateCookie('s', 'c');

    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Secure');
    expect(header).toMatch(/Max-Age=\d+/);
  });

  it('omits Secure in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const header = serializeOAuthStateCookie('s', 'c');

    expect(header).not.toContain('Secure');
  });

  it('clears the cookie with Max-Age=0', () => {
    expect(serializeClearOAuthStateCookie()).toContain('Max-Age=0');
  });
});
