import { describe, expect, it } from 'vitest';
import { assertMicrosoftOAuthConfig, createMicrosoftAuthorizationURL } from './microsoft.js';

const validEnv = {
  MICROSOFT_TENANT_ID: '11111111-2222-3333-4444-555555555555',
  MICROSOFT_CLIENT_ID: 'client-id-123',
  MICROSOFT_CLIENT_SECRET: 'client-secret-456',
  MICROSOFT_OAUTH_REDIRECT_URI: 'https://api.radarvendor.com/api/admin/auth/microsoft/callback',
};

describe('assertMicrosoftOAuthConfig', () => {
  it('returns the config when all values are present', () => {
    expect(assertMicrosoftOAuthConfig(validEnv)).toEqual({
      tenantId: '11111111-2222-3333-4444-555555555555',
      clientId: 'client-id-123',
      clientSecret: 'client-secret-456',
      redirectUri: 'https://api.radarvendor.com/api/admin/auth/microsoft/callback',
    });
  });

  it.each([
    'MICROSOFT_TENANT_ID',
    'MICROSOFT_CLIENT_ID',
    'MICROSOFT_CLIENT_SECRET',
    'MICROSOFT_OAUTH_REDIRECT_URI',
  ] as const)('throws when %s is missing', (name) => {
    const env = { ...validEnv };
    delete env[name];
    expect(() => assertMicrosoftOAuthConfig(env)).toThrow();
  });
});

describe('createMicrosoftAuthorizationURL', () => {
  it('builds a tenant-scoped Microsoft authorization URL with state and PKCE params', () => {
    const { url, state, codeVerifier } = createMicrosoftAuthorizationURL(validEnv);

    expect(url.host).toBe('login.microsoftonline.com');
    expect(url.pathname).toBe('/11111111-2222-3333-4444-555555555555/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id-123');
    expect(url.searchParams.get('redirect_uri')).toBe(validEnv.MICROSOFT_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('email');
    expect(url.searchParams.get('scope')).not.toContain('profile');
    expect(state.length).toBeGreaterThan(10);
    expect(codeVerifier.length).toBeGreaterThan(10);
  });

  it('does not use the multi-tenant common/organizations endpoint', () => {
    const { url } = createMicrosoftAuthorizationURL(validEnv);

    expect(url.pathname).not.toContain('/common/');
    expect(url.pathname).not.toContain('/organizations/');
  });

  it('generates a fresh state and codeVerifier on each call', () => {
    const first = createMicrosoftAuthorizationURL(validEnv);
    const second = createMicrosoftAuthorizationURL(validEnv);

    expect(first.state).not.toBe(second.state);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });
});
