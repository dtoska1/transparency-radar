import { describe, expect, it } from 'vitest';
import { isAllowedAdminEmail, isCsdgDomainEmail } from './googleGate.js';

describe('isCsdgDomainEmail', () => {
  it('allows an exact @csdgalbania.org email', () => {
    expect(isCsdgDomainEmail('dt@csdgalbania.org')).toBe(true);
  });

  it('allows mixed-case domains case-insensitively', () => {
    expect(isCsdgDomainEmail('DT@CSDGAlbania.ORG')).toBe(true);
  });

  it('rejects a lookalike domain that merely contains csdgalbania.org', () => {
    expect(isCsdgDomainEmail('dt@csdgalbania.org.evil.com')).toBe(false);
  });

  it('rejects unrelated domains', () => {
    expect(isCsdgDomainEmail('dt@gmail.com')).toBe(false);
  });
});

describe('isAllowedAdminEmail', () => {
  const allowlist = new Set(['external-dev@gmail.com']);

  it('allows a csdg domain email regardless of allowlist contents', () => {
    expect(isAllowedAdminEmail('dt@csdgalbania.org', allowlist)).toBe(true);
  });

  it('allows a csdg domain email with different casing', () => {
    expect(isAllowedAdminEmail('DT@CSDGAlbania.ORG', allowlist)).toBe(true);
  });

  it('rejects a non-csdg email not on the allowlist', () => {
    expect(isAllowedAdminEmail('random@gmail.com', allowlist)).toBe(false);
  });

  it('allows a non-csdg email that is on the allowlist', () => {
    expect(isAllowedAdminEmail('external-dev@gmail.com', allowlist)).toBe(true);
  });

  it('rejects a lookalike domain not on the allowlist', () => {
    expect(isAllowedAdminEmail('dt@csdgalbania.org.evil.com', allowlist)).toBe(false);
  });
});
