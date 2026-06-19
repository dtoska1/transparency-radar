import { describe, expect, it } from 'vitest';
import { redactSensitiveQueryParams } from './logger.js';

describe('redactSensitiveQueryParams', () => {
  it('redacts both the Google OAuth authorization code and the CSRF state param', () => {
    expect(
      redactSensitiveQueryParams(
        '/api/admin/auth/google/callback?state=secret-state&code=secret-code',
      ),
    ).toBe('/api/admin/auth/google/callback?state=%5Bredacted%5D&code=%5Bredacted%5D');
  });

  it('leaves URLs without sensitive params untouched', () => {
    expect(redactSensitiveQueryParams('/api/admin/pending?limit=20')).toBe(
      '/api/admin/pending?limit=20',
    );
  });

  it('leaves URLs without any query string untouched', () => {
    expect(redactSensitiveQueryParams('/api/v1/health')).toBe('/api/v1/health');
  });
});
