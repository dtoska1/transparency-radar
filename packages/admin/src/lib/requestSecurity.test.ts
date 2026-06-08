import { describe, expect, it } from 'vitest';
import { isAllowedPostOrigin } from './requestSecurity';

describe('Astro BFF POST origin validation', () => {
  it('allows absent and same-origin Origin headers', () => {
    expect(isAllowedPostOrigin(new Request('http://localhost:4321/api/login'))).toBe(true);
    expect(
      isAllowedPostOrigin(
        new Request('http://localhost:4321/api/login', {
          headers: { Origin: 'http://localhost:4321' },
        }),
      ),
    ).toBe(true);
  });

  it('rejects a present cross-origin Origin header', () => {
    expect(
      isAllowedPostOrigin(
        new Request('http://localhost:4321/api/login', {
          headers: { Origin: 'https://evil.example' },
        }),
      ),
    ).toBe(false);
  });

  it('accepts the exact HTTPS production origin reconstructed through App Service', () => {
    expect(
      isAllowedPostOrigin(
        new Request('http://localhost:8080/api/login', {
          headers: {
            Host: 'admin.radarivendor.com',
            Origin: 'https://admin.radarivendor.com',
            'X-Forwarded-Host': 'admin.radarivendor.com',
            'X-Forwarded-Proto': 'https',
          },
        }),
      ),
    ).toBe(true);
  });

  it('rejects spoofed forwarded protocol, host, or origin values', () => {
    const headers = {
      Host: 'admin.radarivendor.com',
      Origin: 'https://admin.radarivendor.com',
      'X-Forwarded-Host': 'admin.radarivendor.com',
      'X-Forwarded-Proto': 'https',
    };

    for (const override of [
      { 'X-Forwarded-Proto': 'http' },
      { 'X-Forwarded-Host': 'evil.example' },
      { Origin: 'https://evil.example' },
    ]) {
      expect(
        isAllowedPostOrigin(
          new Request('http://localhost:8080/api/login', {
            headers: { ...headers, ...override },
          }),
        ),
      ).toBe(false);
    }
  });
});
