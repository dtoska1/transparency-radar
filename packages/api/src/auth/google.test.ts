import { describe, expect, it } from 'vitest';
import { assertGoogleOAuthConfig, createGoogleAuthorizationURL } from './google.js';

const validEnv = {
  GOOGLE_CLIENT_ID: 'client-id-123',
  GOOGLE_CLIENT_SECRET: 'client-secret-456',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://admin.radarvendor.com/api/admin/auth/google/callback',
};

describe('assertGoogleOAuthConfig', () => {
  it('returns the config when all values are present', () => {
    expect(assertGoogleOAuthConfig(validEnv)).toEqual({
      clientId: 'client-id-123',
      clientSecret: 'client-secret-456',
      redirectUri: 'https://admin.radarvendor.com/api/admin/auth/google/callback',
    });
  });

  it.each(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI'] as const)(
    'throws when %s is missing',
    (name) => {
      const env = { ...validEnv };
      delete env[name];
      expect(() => assertGoogleOAuthConfig(env)).toThrow();
    },
  );
});

describe('createGoogleAuthorizationURL', () => {
  it('builds a Google authorization URL with state and PKCE params', () => {
    const { url, state, codeVerifier } = createGoogleAuthorizationURL(validEnv);

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('client-id-123');
    expect(url.searchParams.get('redirect_uri')).toBe(validEnv.GOOGLE_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('email');
    expect(state.length).toBeGreaterThan(10);
    expect(codeVerifier.length).toBeGreaterThan(10);
  });

  it('generates a fresh state and codeVerifier on each call', () => {
    const first = createGoogleAuthorizationURL(validEnv);
    const second = createGoogleAuthorizationURL(validEnv);

    expect(first.state).not.toBe(second.state);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });
});
