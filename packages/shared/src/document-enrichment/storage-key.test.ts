import { describe, expect, it } from 'vitest';
import { buildContentAddressedStorageKey } from './storage-key.js';

const SHA256 = 'a'.repeat(64);

describe('buildContentAddressedStorageKey', () => {
  it('builds a hash-derived key namespaced by municipality and vertical', () => {
    expect(buildContentAddressedStorageKey('pogradec', 'konsultime', SHA256, 'pdf')).toBe(
      `pogradec/konsultime/${SHA256}.pdf`,
    );
  });

  it('varies the key by municipality and vertical for the same hash', () => {
    expect(buildContentAddressedStorageKey('shkoder', 'konsultime', SHA256, 'pdf')).toBe(
      `shkoder/konsultime/${SHA256}.pdf`,
    );
  });

  it('rejects unsafe sha256 input', () => {
    expect(() =>
      buildContentAddressedStorageKey('pogradec', 'konsultime', '../bad', 'pdf'),
    ).toThrow(/Invalid sha256/);
  });
});
