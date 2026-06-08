export { BaseScraper } from './base-scraper.js';
export { createDocumentReverifier, reverifyDocument } from './reverification/reverifyDocument.js';
export type {
  DocumentReverifierDependencies,
  ReverificationRepository,
} from './reverification/reverifyDocument.js';
export { DefaultSourceVerifier } from './reverification/source-verifier.js';
export type {
  DocumentCheckRecord,
  DocumentCheckResultDetail,
  DocumentCheckStatus,
  DocumentSourceSlot,
  SourceResult,
  SourceVerificationSummary,
  SourceType,
} from './reverification/types.js';
