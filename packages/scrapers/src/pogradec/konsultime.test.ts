import { describe, expect, it, vi } from 'vitest';

vi.mock('@tra/db', () => ({ db: {}, konsultime: {}, municipalities: {}, scrape_runs: {}, sources: {} }));

import { classifyKind, parseListingDate } from './konsultime.js';

describe('parseListingDate', () => {
  it('converts DD-MM-YYYY to ISO YYYY-MM-DD', () => {
    expect(parseListingDate('15-03-2024')).toBe('2024-03-15');
  });

  it('converts single-digit day and month', () => {
    expect(parseListingDate('05-06-2023')).toBe('2023-06-05');
  });

  it('returns null for non-matching text', () => {
    expect(parseListingDate('invalid')).toBeNull();
  });

  it('extracts date from text containing extra characters', () => {
    expect(parseListingDate(' 20-11-2025 ')).toBe('2025-11-20');
  });
});

describe('classifyKind', () => {
  it('returns hearing when title contains dëgjes', () => {
    expect(classifyKind('Dëgjesë Publike 2024', '')).toBe('hearing');
  });

  it('returns hearing when excerpt contains degjes (unaccented)', () => {
    expect(classifyKind('Konsultim', 'degjes publike')).toBe('hearing');
  });

  it('returns draft_act when title contains projekt and akt', () => {
    expect(classifyKind('Projekt-Akt për Buxhetin', '')).toBe('draft_act');
  });

  it('returns draft_act when title contains projekt and vendim', () => {
    expect(classifyKind('Projektvendim nr.5', '')).toBe('draft_act');
  });

  it('returns consultation_notice as default', () => {
    expect(classifyKind('Konsultim Publik mbi Planin', '')).toBe('consultation_notice');
  });
});
