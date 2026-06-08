export type DocumentCheckStatus =
  | 'verified'
  | 'source_changed'
  | 'stored_mismatch'
  | 'token_invalid'
  | 'token_missing'
  | 'source_unreachable'
  | 'source_not_applicable'
  | 'error';

export type SourceType = 'url' | 'app_export' | 'manual' | 'historical';

export interface SourceResult {
  slot_ref: string;
  source_type: SourceType;
  ok: boolean | null;
  observed_sha256?: string;
  reason?: string;
}

export interface DocumentCheckResultDetail {
  stored_ok: boolean | null;
  source_ok: boolean | null;
  token_valid: boolean | null;
  observed_source_sha256?: string;
  tsa_time?: string;
  error?: string;
  source_results: SourceResult[];
}

export interface StoredDocument {
  id: string;
  sha256: string;
  storage_uri: string;
  tsr_token: string | null;
}

export type DocumentSourceSlot =
  | {
      slotRef: string;
      sourceType: 'url';
      url: string;
    }
  | {
      slotRef: string;
      sourceType: 'app_export';
      appId: string;
      year: number;
    }
  | {
      slotRef: string;
      sourceType: 'manual';
      reason: string;
    }
  | {
      slotRef: string;
      sourceType: 'historical';
      reason: string;
    };

export interface DocumentCheckRecord {
  id: string;
  document_id: string;
  run_id: string;
  checked_at: Date;
  status: DocumentCheckStatus;
  result_detail: DocumentCheckResultDetail;
  created_at: Date;
}

export interface SourceVerificationSummary {
  sourceOk: boolean | null;
  changed: boolean;
  unreachable: boolean;
  notApplicableOnly: boolean;
  observedSourceSha256?: string;
  results: SourceResult[];
}
