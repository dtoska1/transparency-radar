import { hashBytes } from '@tra/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  type DocumentReverifierDependencies,
  type ReverificationRepository,
  classifySourceSlotRows,
  createDocumentReverifier,
} from './reverifyDocument.js';
import type {
  DocumentCheckRecord,
  DocumentCheckResultDetail,
  DocumentCheckStatus,
  SourceVerificationSummary,
  StoredDocument,
} from './types.js';

vi.mock('@tra/db', () => ({
  db: {},
  audit_log: {},
  document_checks: {},
  document_versions: {},
  documents: {},
  konsultim_documents: {},
  konsultime: {},
  prokurim_documents: {},
  prokurime: {},
  vendim_documents: {},
  vendime: {},
}));

const DOCUMENT_ID = 'document-1';
const RUN_ID = 'run-1';
const STORED_BYTES = Buffer.from('captured bytes');
const SHA256 = hashBytes(STORED_BYTES);
const CHECKED_AT = new Date('2026-06-08T10:00:00.000Z');

function sourceSummary(
  overrides: Partial<SourceVerificationSummary> = {},
): SourceVerificationSummary {
  return {
    sourceOk: true,
    changed: false,
    unreachable: false,
    notApplicableOnly: false,
    results: [
      {
        slot_ref: 'https://example.test/document.pdf',
        source_type: 'url',
        ok: true,
        observed_sha256: SHA256,
      },
    ],
    ...overrides,
  };
}

function checkRecord(
  status: DocumentCheckStatus,
  detail: DocumentCheckResultDetail,
): DocumentCheckRecord {
  return {
    id: 'check-1',
    document_id: DOCUMENT_ID,
    run_id: RUN_ID,
    checked_at: CHECKED_AT,
    status,
    result_detail: detail,
    created_at: CHECKED_AT,
  };
}

class FakeRepository implements ReverificationRepository {
  existing: DocumentCheckRecord | null = null;
  document: StoredDocument | null = {
    id: DOCUMENT_ID,
    sha256: SHA256,
    storage_uri: 'test/document.pdf',
    tsr_token: 'timestamp-token',
  };
  slots = [
    {
      slotRef: 'https://example.test/document.pdf',
      sourceType: 'url' as const,
      url: 'https://example.test/document.pdf',
    },
  ];
  insertCount = 0;
  lastInsert:
    | {
        documentId: string;
        runId: string;
        checkedAt: Date;
        status: DocumentCheckStatus;
        resultDetail: DocumentCheckResultDetail;
      }
    | undefined;
  conflictRecord: DocumentCheckRecord | null = null;

  async findCheck(): Promise<DocumentCheckRecord | null> {
    return this.existing ?? (this.insertCount > 0 ? this.conflictRecord : null);
  }

  async findDocument(): Promise<StoredDocument | null> {
    return this.document;
  }

  async findSourceSlots() {
    return this.slots;
  }

  async insertCheck(input: {
    documentId: string;
    runId: string;
    checkedAt: Date;
    status: DocumentCheckStatus;
    resultDetail: DocumentCheckResultDetail;
  }): Promise<DocumentCheckRecord | null> {
    this.insertCount += 1;
    this.lastInsert = input;
    if (this.conflictRecord) return null;
    this.existing = checkRecord(input.status, input.resultDetail);
    return this.existing;
  }
}

function setup(options?: {
  storedBytes?: Buffer | Error;
  source?: SourceVerificationSummary | Error;
  token?: { valid: boolean; tsaTime: Date | null } | Error;
  tokenMissing?: boolean;
}) {
  const repository = new FakeRepository();
  if (options?.tokenMissing && repository.document) {
    repository.document = { ...repository.document, tsr_token: null };
  }
  const sourceVerifier = {
    verify: vi.fn(async () => {
      if (options?.source instanceof Error) throw options.source;
      return options?.source ?? sourceSummary();
    }),
  };
  const storage = {
    download: vi.fn(async () => {
      if (options?.storedBytes instanceof Error) throw options.storedBytes;
      return options?.storedBytes ?? STORED_BYTES;
    }),
  };
  const validateToken = vi.fn(async () => {
    if (options?.token instanceof Error) throw options.token;
    return (
      options?.token ?? {
        valid: true,
        tsaTime: new Date('2026-06-03T16:58:02.000Z'),
      }
    );
  });
  const dependencies: DocumentReverifierDependencies = {
    repository,
    storage,
    sourceVerifier,
    hash: hashBytes,
    validateToken,
    now: () => CHECKED_AT,
  };
  return {
    repository,
    sourceVerifier,
    storage,
    validateToken,
    reverify: createDocumentReverifier(dependencies),
  };
}

describe('reverifyDocument status contract', () => {
  it('records verified when stored, source, and timestamp signals are valid', async () => {
    const { repository, reverify } = setup();

    await expect(reverify(DOCUMENT_ID, RUN_ID)).resolves.toMatchObject({
      status: 'verified',
      result_detail: {
        stored_ok: true,
        source_ok: true,
        token_valid: true,
        tsa_time: '2026-06-03T16:58:02.000Z',
      },
    });
    expect(repository.insertCount).toBe(1);
  });

  it('gives stored_mismatch the highest normal-signal priority', async () => {
    const { reverify } = setup({
      storedBytes: Buffer.from('corrupted'),
      source: sourceSummary({ changed: true, sourceOk: false }),
      token: { valid: false, tsaTime: null },
    });

    await expect(reverify(DOCUMENT_ID, RUN_ID)).resolves.toMatchObject({
      status: 'stored_mismatch',
      result_detail: { stored_ok: false },
    });
  });

  it.each([
    {
      name: 'token_invalid',
      options: { token: { valid: false, tsaTime: null } },
      status: 'token_invalid',
    },
    {
      name: 'source_changed',
      options: { source: sourceSummary({ changed: true, sourceOk: false }) },
      status: 'source_changed',
    },
    {
      name: 'token_missing',
      options: { tokenMissing: true },
      status: 'token_missing',
    },
    {
      name: 'source_unreachable',
      options: {
        source: sourceSummary({ sourceOk: null, unreachable: true }),
      },
      status: 'source_unreachable',
    },
    {
      name: 'source_not_applicable',
      options: {
        source: sourceSummary({
          sourceOk: null,
          notApplicableOnly: true,
          results: [
            {
              slot_ref: 'manual:item',
              source_type: 'manual',
              ok: null,
              reason: 'manual upload source is not safe to re-fetch',
            },
          ],
        }),
      },
      status: 'source_not_applicable',
    },
  ] as const)('records $name', async ({ options, status }) => {
    const { reverify } = setup(options);
    await expect(reverify(DOCUMENT_ID, RUN_ID)).resolves.toMatchObject({ status });
  });

  it('records error when a required storage read fails', async () => {
    const { reverify } = setup({ storedBytes: new Error('ENOENT') });

    await expect(reverify(DOCUMENT_ID, RUN_ID)).resolves.toMatchObject({
      status: 'error',
      result_detail: {
        stored_ok: null,
        error: 'stored document read failed: ENOENT',
      },
    });
  });

  it('returns the existing check without repeating any signal work', async () => {
    const harness = setup();
    const first = await harness.reverify(DOCUMENT_ID, RUN_ID);
    const second = await harness.reverify(DOCUMENT_ID, RUN_ID);

    expect(second).toBe(first);
    expect(harness.repository.insertCount).toBe(1);
    expect(harness.storage.download).toHaveBeenCalledTimes(1);
    expect(harness.sourceVerifier.verify).toHaveBeenCalledTimes(1);
    expect(harness.validateToken).toHaveBeenCalledTimes(1);
  });

  it('returns a concurrently inserted check after ON CONFLICT inserts nothing', async () => {
    const harness = setup();
    const detail: DocumentCheckResultDetail = {
      stored_ok: true,
      source_ok: true,
      token_valid: true,
      source_results: [],
    };
    harness.repository.conflictRecord = checkRecord('verified', detail);

    await expect(harness.reverify(DOCUMENT_ID, RUN_ID)).resolves.toBe(
      harness.repository.conflictRecord,
    );
    expect(harness.repository.insertCount).toBe(1);
  });
});

describe('source slot classification', () => {
  it('classifies an audit-logged manual upload as non-fetchable even with a URL slot', () => {
    const [slot] = classifySourceSlotRows(
      [
        {
          version_id: 'version-1',
          slot_ref: 'https://user.example/untrusted.pdf',
          is_current: true,
          vertical: 'vendime',
          item_id: 'item-1',
          source_origin: 'tirana.al',
          app_id: null,
          published_date: '2026-06-01',
          manually_created: true,
        },
      ],
      DOCUMENT_ID,
    );

    expect(slot).toEqual({
      slotRef: 'https://user.example/untrusted.pdf',
      sourceType: 'manual',
      reason: 'manual upload source is not safe to re-fetch',
    });
  });

  it('classifies a document with no current slot as historical', () => {
    const [slot] = classifySourceSlotRows(
      [
        {
          version_id: 'version-1',
          slot_ref: 'https://example.test/old.pdf',
          is_current: false,
          vertical: 'vendime',
          item_id: 'item-1',
          source_origin: 'tirana.al',
          app_id: null,
          published_date: '2025-06-01',
          manually_created: false,
        },
      ],
      DOCUMENT_ID,
    );

    expect(slot).toMatchObject({
      sourceType: 'historical',
      reason: 'document is referenced only by a historical slot version',
    });
  });

  it('classifies consistent APP metadata into a year export lookup', () => {
    const [slot] = classifySourceSlotRows(
      [
        {
          version_id: 'version-1',
          slot_ref: 'prokurime:app:REF-1:source-row',
          is_current: true,
          vertical: 'prokurime',
          item_id: 'item-1',
          source_origin: 'app.gov.al',
          app_id: 'REF-1',
          published_date: '2025-06-01',
          manually_created: false,
        },
      ],
      DOCUMENT_ID,
    );

    expect(slot).toEqual({
      slotRef: 'prokurime:app:REF-1:source-row',
      sourceType: 'app_export',
      appId: 'REF-1',
      year: 2025,
    });
  });
});
