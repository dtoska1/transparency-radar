export const LOCAL_OPERATOR_PREFIXES = [
  'NDERMARRJA E SHERBIMEVE PUBLIKE',
  'NDERMARRJA E PASURIVE PUBLIKE',
  'NDERMARRJA E PASTRIMIT',
  'AGJENCIA E SHERBIMEVE PUBLIKE',
  'AGJENCIA E SHERBIMEVE PUBLIKE RURALE',
  'NDERMARRJA RRUGA',
  'QENDRA EKONOMIKE E ARSIMIT',
  'QENDRA E ARTIT DHE E KULTURES',
  'SHOQERIA RAJONALE UJESJELLES KANALIZIME',
  'UJESJELLES KANALIZIME',
  'NDERMARRJA E SHERBIMEVE KOMUNALE',
  'NDERMARRJA E GJELBERIMIT',
  'NDERMARRJA E MIREMBAJTJES SE RRUGEVE',
] as const;

export const EXACT_AUTHORITY_MUNICIPALITY_OVERRIDES = new Map<string, string>([
  ['QENDRA E ARTIT DHE E KULTURES KORCE', 'korce'],
  ['QENDRA EKONOMIKE E ARSIMIT BASHKIA KUCOVE', 'kucove'],
  ['SHKOLLA E MESME TREGTARE VLORE', 'vlore'],
]);

export type AuthorityMatchMode = 'primary' | 'exact_override' | 'fallback_local_operator';

export type AuthorityMatchReason =
  | 'missing_authority'
  | 'missing_municipality_marker'
  | 'matched_bashkia'
  | 'matched_municipality_of'
  | 'unclear_authority_name'
  | 'matched_exact_override'
  | 'ambiguous_fallback_municipality_suffix'
  | 'fallback_suffix_not_unique'
  | 'matched_fallback_local_operator';

export interface MunicipalityTermInput {
  nameKey?: string | null;
  nameSq?: string | null;
  aliasKeys?: readonly (string | null | undefined)[] | null;
}

export interface MunicipalityContext {
  nameKey?: string | null;
  municipalityTerms?: readonly (string | null | undefined)[] | null;
}

export interface AuthorityMunicipalityMatch {
  matched: boolean;
  match_mode: AuthorityMatchMode | null;
  matched_prefix: string | null;
  reason: AuthorityMatchReason;
  matched_term: string | null;
}

export interface AuthorityMunicipalityContextMatch<TContext extends MunicipalityContext>
  extends AuthorityMunicipalityMatch {
  municipalityContext: TContext | null;
}

type Stringish = string | number | null | undefined;

function stripCombiningMarks(value: string): string {
  let result = '';
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint >= 0x0300 && codePoint <= 0x036f) continue;
    result += char;
  }
  return result;
}

export function normalizeText(value: Stringish): string {
  return stripCombiningMarks(String(value || '').normalize('NFKD'))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value: Stringish): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTermWithGenitiveVariants(term: Stringish): string[] {
  const normalized = normalizeText(term);
  if (!normalized) return [];

  const parts = normalized.split(' ').filter(Boolean);
  if (!parts.length) return [];

  const variants = new Set([normalized]);
  const last = parts[parts.length - 1];
  if (last.length >= 4) {
    for (const suffix of ['S', 'SE', 'IT', 'UT']) {
      const alt = [...parts];
      alt[alt.length - 1] = `${last}${suffix}`;
      variants.add(alt.join(' '));
    }
  }

  return Array.from(variants.values());
}

function containsTermSequence(text: string, termVariant: string): boolean {
  if (!text || !termVariant) return false;
  const escaped = escapeRegex(termVariant);
  const re = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`);
  return re.test(text);
}

function hasTermSuffix(text: string, termVariant: string): boolean {
  if (!text || !termVariant) return false;
  const escaped = escapeRegex(termVariant);
  const re = new RegExp(`(?:^|\\s)${escaped}$`);
  return re.test(text);
}

export function buildMunicipalityTermSet({
  nameKey,
  nameSq,
  aliasKeys = [],
}: MunicipalityTermInput): string[] {
  const terms = new Set<string>();

  const addTerm = (value: Stringish) => {
    for (const variant of buildTermWithGenitiveVariants(value)) {
      if (!variant) continue;
      terms.add(variant);
    }
  };

  addTerm(nameSq);
  addTerm(String(nameKey || '').replace(/-/g, ' '));
  for (const alias of aliasKeys || []) {
    addTerm(String(alias || '').replace(/-/g, ' '));
  }

  return Array.from(terms.values()).sort((a, b) => b.length - a.length);
}

export function matchAuthorityToMunicipality({
  authority,
  municipalityTerms,
}: {
  authority?: Stringish;
  municipalityTerms?: readonly (string | null | undefined)[] | null;
}): AuthorityMunicipalityMatch {
  const normalizedAuthority = normalizeText(authority);
  if (!normalizedAuthority) {
    return {
      matched: false,
      match_mode: null,
      matched_prefix: null,
      reason: 'missing_authority',
      matched_term: null,
    };
  }

  const hasBashkiaMarker = /\bBASHKIA\b/.test(normalizedAuthority);
  const hasMunicipalityOfMarker = /\bMUNICIPALITY\s+OF\b/.test(normalizedAuthority);
  if (!hasBashkiaMarker && !hasMunicipalityOfMarker) {
    return {
      matched: false,
      match_mode: null,
      matched_prefix: null,
      reason: 'missing_municipality_marker',
      matched_term: null,
    };
  }

  const authorityAfterBashkia = (() => {
    const m = normalizedAuthority.match(/\bBASHKIA\b/);
    if (!m || m.index === undefined) return '';
    const tail = normalizedAuthority.slice(m.index + m[0].length).trim();
    return tail.replace(/^E\s+/, '').trim();
  })();

  const authorityAfterMunicipalityOf = (() => {
    const m = normalizedAuthority.match(/\bMUNICIPALITY\s+OF\b/);
    if (!m || m.index === undefined) return '';
    return normalizedAuthority.slice(m.index + m[0].length).trim();
  })();

  const terms = Array.isArray(municipalityTerms) ? municipalityTerms : [];
  for (const term of terms) {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) continue;

    const matchedByBashkia =
      authorityAfterBashkia && containsTermSequence(authorityAfterBashkia, normalizedTerm);
    const matchedByMunicipalityOf =
      authorityAfterMunicipalityOf &&
      containsTermSequence(authorityAfterMunicipalityOf, normalizedTerm);
    if (matchedByBashkia || matchedByMunicipalityOf) {
      return {
        matched: true,
        match_mode: 'primary',
        matched_prefix: null,
        reason: matchedByBashkia ? 'matched_bashkia' : 'matched_municipality_of',
        matched_term: normalizedTerm,
      };
    }
  }

  return {
    matched: false,
    match_mode: null,
    matched_prefix: null,
    reason: 'unclear_authority_name',
    matched_term: null,
  };
}

function getAllowedLocalOperatorPrefix(normalizedAuthority: string): string | null {
  if (!normalizedAuthority) return null;
  for (const prefix of LOCAL_OPERATOR_PREFIXES) {
    if (normalizedAuthority === prefix || normalizedAuthority.startsWith(`${prefix} `)) {
      return prefix;
    }
  }
  return null;
}

function findMunicipalityContextByNameKey<TContext extends MunicipalityContext>(
  municipalityContexts: readonly TContext[] | null | undefined,
  targetNameKey: Stringish,
): TContext | null {
  const key = String(targetNameKey || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  for (const municipalityContext of municipalityContexts || []) {
    const nameKey = String(municipalityContext?.nameKey || '')
      .trim()
      .toLowerCase();
    if (nameKey === key) return municipalityContext;
  }
  return null;
}

export function matchAuthorityToMunicipalityAcrossContexts<TContext extends MunicipalityContext>({
  authority,
  municipalityContexts,
}: {
  authority?: Stringish;
  municipalityContexts?: readonly TContext[] | null;
}): AuthorityMunicipalityContextMatch<TContext> {
  const contexts = Array.isArray(municipalityContexts) ? municipalityContexts : [];
  const normalizedAuthority = normalizeText(authority);
  if (!normalizedAuthority) {
    return {
      matched: false,
      municipalityContext: null,
      match_mode: null,
      matched_prefix: null,
      reason: 'missing_authority',
      matched_term: null,
    };
  }

  const overrideMunicipalityKey =
    EXACT_AUTHORITY_MUNICIPALITY_OVERRIDES.get(normalizedAuthority) || null;
  if (overrideMunicipalityKey) {
    const municipalityContext = findMunicipalityContextByNameKey(contexts, overrideMunicipalityKey);
    if (municipalityContext) {
      return {
        matched: true,
        municipalityContext,
        match_mode: 'exact_override',
        matched_prefix: null,
        reason: 'matched_exact_override',
        matched_term: overrideMunicipalityKey,
      };
    }
  }

  const hasBashkiaMarker = /\bBASHKIA\b/.test(normalizedAuthority);
  const hasMunicipalityOfMarker = /\bMUNICIPALITY\s+OF\b/.test(normalizedAuthority);

  for (const municipalityContext of contexts) {
    const primaryMatch = matchAuthorityToMunicipality({
      authority,
      municipalityTerms: municipalityContext?.municipalityTerms,
    });
    if (!primaryMatch.matched) continue;
    return {
      ...primaryMatch,
      municipalityContext,
    };
  }

  const matchedPrefix = getAllowedLocalOperatorPrefix(normalizedAuthority);
  if (!matchedPrefix) {
    return {
      matched: false,
      municipalityContext: null,
      match_mode: null,
      matched_prefix: null,
      reason:
        hasBashkiaMarker || hasMunicipalityOfMarker
          ? 'unclear_authority_name'
          : 'missing_municipality_marker',
      matched_term: null,
    };
  }

  const fallbackCandidates: { municipalityContext: TContext; matchedTerm: string }[] = [];
  for (const municipalityContext of contexts) {
    const terms = Array.isArray(municipalityContext?.municipalityTerms)
      ? municipalityContext.municipalityTerms
      : [];
    let matchedTerm = null;
    for (const term of terms) {
      const normalizedTerm = normalizeText(term);
      if (!normalizedTerm) continue;
      if (!hasTermSuffix(normalizedAuthority, normalizedTerm)) continue;
      matchedTerm = normalizedTerm;
      break;
    }
    if (!matchedTerm) continue;
    fallbackCandidates.push({
      municipalityContext,
      matchedTerm,
    });
    if (fallbackCandidates.length > 1) {
      return {
        matched: false,
        municipalityContext: null,
        match_mode: null,
        matched_prefix: null,
        reason: 'ambiguous_fallback_municipality_suffix',
        matched_term: null,
      };
    }
  }

  if (!fallbackCandidates.length) {
    return {
      matched: false,
      municipalityContext: null,
      match_mode: null,
      matched_prefix: null,
      reason: 'fallback_suffix_not_unique',
      matched_term: null,
    };
  }

  return {
    matched: true,
    municipalityContext: fallbackCandidates[0].municipalityContext,
    match_mode: 'fallback_local_operator',
    matched_prefix: matchedPrefix,
    reason: 'matched_fallback_local_operator',
    matched_term: fallbackCandidates[0].matchedTerm,
  };
}
