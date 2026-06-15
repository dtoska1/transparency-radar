import { describe, expect, it } from 'vitest';
import { toSlug } from './slug.js';

describe('toSlug', () => {
  it('lowercases and replaces non-alphanumeric sequences with hyphens', () => {
    expect(toSlug('Konsultim Publik Projekt-Buxheti 2025')).toBe(
      'konsultim-publik-projekt-buxheti-2025',
    );
  });

  it('strips leading and trailing hyphens', () => {
    expect(toSlug('  Hello World  ')).toBe('hello-world');
  });

  it('collapses multiple non-alphanumeric characters into one hyphen', () => {
    expect(toSlug('A  --  B')).toBe('a-b');
  });

  it('handles empty string', () => {
    expect(toSlug('')).toBe('');
  });
});
