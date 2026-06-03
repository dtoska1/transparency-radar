import { describe, expect, it } from 'vitest';
import {
  type MunicipalityContext,
  buildMunicipalityTermSet,
  matchAuthorityToMunicipalityAcrossContexts,
} from './prokurime-authority-match.js';

const municipalityContexts = [
  {
    nameKey: 'tirana',
    municipalityTerms: buildMunicipalityTermSet({
      nameKey: 'tirana',
      nameSq: 'Tiranë',
      aliasKeys: ['tirane'],
    }),
  },
  {
    nameKey: 'shkoder',
    municipalityTerms: buildMunicipalityTermSet({
      nameKey: 'shkoder',
      nameSq: 'Shkodër',
      aliasKeys: ['shkodra'],
    }),
  },
] satisfies MunicipalityContext[];

describe('prokurime authority matcher', () => {
  it('matches BASHKIA TIRANE through the primary marker path', () => {
    const result = matchAuthorityToMunicipalityAcrossContexts({
      authority: 'BASHKIA TIRANE',
      municipalityContexts,
    });

    expect(result.matched).toBe(true);
    expect(result.match_mode).toBe('primary');
    expect(result.reason).toBe('matched_bashkia');
    expect(result.municipalityContext?.nameKey).toBe('tirana');
  });

  it('matches BASHKIA TIRANES through genitive municipality variants', () => {
    const result = matchAuthorityToMunicipalityAcrossContexts({
      authority: 'BASHKIA TIRANES',
      municipalityContexts,
    });

    expect(result.matched).toBe(true);
    expect(result.match_mode).toBe('primary');
    expect(result.reason).toBe('matched_bashkia');
    expect(result.municipalityContext?.nameKey).toBe('tirana');
  });

  it('matches local operator prefixes through the fallback suffix path', () => {
    const result = matchAuthorityToMunicipalityAcrossContexts({
      authority: 'UJESJELLES KANALIZIME TIRANE',
      municipalityContexts,
    });

    expect(result.matched).toBe(true);
    expect(result.match_mode).toBe('fallback_local_operator');
    expect(result.reason).toBe('matched_fallback_local_operator');
    expect(result.matched_prefix).toBe('UJESJELLES KANALIZIME');
    expect(result.municipalityContext?.nameKey).toBe('tirana');
  });

  it('rejects non-municipal central service authorities', () => {
    const result = matchAuthorityToMunicipalityAcrossContexts({
      authority: 'Drejtoria e Sherbimeve Qeveritare',
      municipalityContexts,
    });

    expect(result.matched).toBe(false);
    expect(result.reason).toBe('missing_municipality_marker');
    expect(result.municipalityContext).toBeNull();
  });

  it('rejects company names without a municipality marker or local operator prefix', () => {
    const result = matchAuthorityToMunicipalityAcrossContexts({
      authority: 'SKODRINON SH.A',
      municipalityContexts,
    });

    expect(result.matched).toBe(false);
    expect(result.reason).toBe('missing_municipality_marker');
    expect(result.municipalityContext).toBeNull();
  });
});
