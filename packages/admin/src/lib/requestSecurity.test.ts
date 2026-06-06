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
});
