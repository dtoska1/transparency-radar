export { MUNICIPALITY_SLUGS, VERTICALS } from './constants.js';
export type { MunicipalitySlug, Vertical } from './constants.js';
export { deriveDocFormat } from './document-format.js';
export type { DocFormat } from './document-format.js';
export {
  EXACT_AUTHORITY_MUNICIPALITY_OVERRIDES,
  LOCAL_OPERATOR_PREFIXES,
  buildMunicipalityTermSet,
  matchAuthorityToMunicipality,
  matchAuthorityToMunicipalityAcrossContexts,
  normalizeText,
} from './prokurime-authority-match.js';
export type {
  AuthorityMatchMode,
  AuthorityMatchReason,
  AuthorityMunicipalityContextMatch,
  AuthorityMunicipalityMatch,
  MunicipalityContext,
  MunicipalityTermInput,
} from './prokurime-authority-match.js';
export type { IStorageAdapter, IEmailAdapter, INotificationAdapter } from './adapters.js';
export { LocalDiskAdapter } from './local-disk-adapter.js';
export { NullEmailer } from './null-emailer.js';
export { ConsoleNotifier } from './console-notifier.js';
