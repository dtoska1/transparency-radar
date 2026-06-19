import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPasswordHash } from './password.js';

describe('hashPassword', () => {
  it('produces a hash that verifies against the original password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPasswordHash(hash, 'correct horse battery staple')).toBe(true);
  });

  it('produces a hash that does not verify against an unrelated password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPasswordHash(hash, 'something else entirely')).toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const first = await hashPassword('same input');
    const second = await hashPassword('same input');
    expect(first).not.toBe(second);
  });
});
