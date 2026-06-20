import { describe, expect, it } from 'vitest';
import { redactSensitiveQueryParams } from './logger.js';

describe('redactSensitiveQueryParams', () => {
  it('redacts both the Microsoft OAuth authorization code and the CSRF state param', () => {
    expect(
      redactSensitiveQueryParams(
        '/api/admin/auth/microsoft/callback?state=secret-state&code=secret-code',
      ),
    ).toBe('/api/admin/auth/microsoft/callback?state=%5Bredacted%5D&code=%5Bredacted%5D');
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
