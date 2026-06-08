import { db } from '@tra/db';
import {
  audit_log,
  document_checks,
  document_versions,
  documents,
  konsultim_documents,
  konsultime,
  prokurim_documents,
  prokurime,
  vendim_documents,
  vendime,
} from '@tra/db';
import {
  type IStorageAdapter,
  LocalDiskAdapter,
  hashBytes,
  validateTimestampToken,
} from '@tra/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DefaultSourceVerifier, type SourceVerifier } from './source-verifier.js';
import type {
  DocumentCheckRecord,
  DocumentCheckResultDetail,
  DocumentCheckStatus,
  DocumentSourceSlot,
  SourceVerificationSummary,
  StoredDocument,
} from './types.js';

interface SourceSlotRow {
  [key: string]: unknown;
  version_id: string;
  slot_ref: string;
  is_current: boolean;
  vertical: 'vendime' | 'konsultime' | 'prokurime' | null;
  item_id: string | null;
  source_origin: string | null;
  app_id: string | null;
  published_date: string | null;
  manually_created: boolean | null;
}

export interface ReverificationRepository {
  findCheck(documentId: string, runId: string): Promise<DocumentCheckRecord | null>;
  findDocument(documentId: string): Promise<StoredDocument | null>;
  findSourceSlots(documentId: string): Promise<DocumentSourceSlot[]>;
  insertCheck(input: {
    documentId: string;
    runId: string;
    checkedAt: Date;
    status: DocumentCheckStatus;
    resultDetail: DocumentCheckResultDetail;
  }): Promise<DocumentCheckRecord | null>;
}

export interface DocumentReverifierDependencies {
  repository: ReverificationRepository;
  storage: Pick<IStorageAdapter, 'download'>;
  sourceVerifier: SourceVerifier;
  hash: typeof hashBytes;
  validateToken: typeof validateTimestampToken;
  now: () => Date;
}

function toCheckRecord(row: typeof document_checks.$inferSelect): DocumentCheckRecord {
  return {
    ...row,
    status: row.status as DocumentCheckStatus,
    result_detail: row.result_detail as DocumentCheckResultDetail,
  };
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function classifySourceSlotRows(
  rows: SourceSlotRow[],
  documentId: string,
): DocumentSourceSlot[] {
  const currentRows = rows.filter((row) => row.is_current);
  if (currentRows.length === 0) {
    const historicalRefs = [...new Set(rows.map((row) => row.slot_ref))].sort();
    if (historicalRefs.length === 0) {
      return [
        {
          slotRef: `document:${documentId}`,
          sourceType: 'historical',
          reason: 'document has no current source slot',
        },
      ];
    }
    return historicalRefs.map((slotRef) => ({
      slotRef,
      sourceType: 'historical',
      reason: 'document is referenced only by a historical slot version',
    }));
  }

  const bySlot = new Map<string, SourceSlotRow[]>();
  for (const row of currentRows) {
    const slotRows = bySlot.get(row.slot_ref) ?? [];
    slotRows.push(row);
    bySlot.set(row.slot_ref, slotRows);
  }

  const slots: DocumentSourceSlot[] = [];
  for (const [slotRef, slotRows] of [...bySlot.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const linkedRows = slotRows.filter((row) => row.item_id !== null);
    if (linkedRows.length === 0) {
      slots.push({
        slotRef,
        sourceType: 'historical',
        reason: 'current document slot has no linked item',
      });
      continue;
    }

    if (linkedRows.every((row) => row.manually_created === true)) {
      slots.push({
        slotRef,
        sourceType: 'manual',
        reason: 'manual upload source is not safe to re-fetch',
      });
      continue;
    }

    const appRows = linkedRows.filter(
      (row) => row.vertical === 'prokurime' && row.source_origin === 'app.gov.al',
    );
    if (appRows.length > 0) {
      const identities = new Set(
        appRows.map((row) => `${row.app_id ?? ''}\u0000${row.published_date ?? ''}`),
      );
      if (
        identities.size !== 1 ||
        !appRows[0].app_id ||
        !appRows[0].published_date ||
        !/^\d{4}-\d{2}-\d{2}$/.test(appRows[0].published_date)
      ) {
        throw new Error(`APP slot ${slotRef} has inconsistent source metadata`);
      }
      slots.push({
        slotRef,
        sourceType: 'app_export',
        appId: appRows[0].app_id,
        year: Number.parseInt(appRows[0].published_date.slice(0, 4), 10),
      });
      continue;
    }

    if (isSafeHttpUrl(slotRef)) {
      slots.push({ slotRef, sourceType: 'url', url: slotRef });
      continue;
    }

    slots.push({
      slotRef,
      sourceType: 'historical',
      reason: 'current slot has no supported source resolver',
    });
  }

  return slots;
}

class DrizzleReverificationRepository implements ReverificationRepository {
  async findCheck(documentId: string, runId: string): Promise<DocumentCheckRecord | null> {
    const [row] = await db
      .select()
      .from(document_checks)
      .where(and(eq(document_checks.document_id, documentId), eq(document_checks.run_id, runId)))
      .limit(1);
    return row ? toCheckRecord(row) : null;
  }

  async findDocument(documentId: string): Promise<StoredDocument | null> {
    const [row] = await db
      .select({
        id: documents.id,
        sha256: documents.sha256,
        storage_uri: documents.storage_uri,
        tsr_token: documents.tsr_token,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    return row ?? null;
  }

  async findSourceSlots(documentId: string): Promise<DocumentSourceSlot[]> {
    const rows = await db.execute<SourceSlotRow>(sql`
      with ranked_versions as (
        select
          ${document_versions.id} as version_id,
          ${document_versions.document_id} as document_id,
          ${document_versions.slot_ref} as slot_ref,
          row_number() over (
            partition by ${document_versions.slot_ref}
            order by
              ${document_versions.version_no} desc,
              ${document_versions.created_at} desc,
              ${document_versions.id} desc
          ) as version_rank
        from ${document_versions}
      ),
      item_links as (
        select
          ${vendim_documents.document_version_id} as document_version_id,
          'vendime'::text as vertical,
          ${vendime.id} as item_id,
          ${vendime.source_origin} as source_origin,
          null::text as app_id,
          ${vendime.published_date}::text as published_date,
          exists (
            select 1
            from ${audit_log}
            where ${audit_log.action} = 'manual_create'
              and ${audit_log.table_name} = 'vendime'
              and ${audit_log.record_id} = ${vendime.id}
          ) as manually_created
        from ${vendim_documents}
        inner join ${vendime} on ${vendime.id} = ${vendim_documents.vendim_id}

        union all

        select
          ${konsultim_documents.document_version_id},
          'konsultime'::text,
          ${konsultime.id},
          ${konsultime.source_origin},
          null::text,
          ${konsultime.published_date}::text,
          exists (
            select 1
            from ${audit_log}
            where ${audit_log.action} = 'manual_create'
              and ${audit_log.table_name} = 'konsultime'
              and ${audit_log.record_id} = ${konsultime.id}
          )
        from ${konsultim_documents}
        inner join ${konsultime} on ${konsultime.id} = ${konsultim_documents.konsultim_id}

        union all

        select
          ${prokurim_documents.document_version_id},
          'prokurime'::text,
          ${prokurime.id},
          ${prokurime.source_origin},
          ${prokurime.app_id},
          ${prokurime.published_date}::text,
          exists (
            select 1
            from ${audit_log}
            where ${audit_log.action} = 'manual_create'
              and ${audit_log.table_name} = 'prokurime'
              and ${audit_log.record_id} = ${prokurime.id}
          )
        from ${prokurim_documents}
        inner join ${prokurime} on ${prokurime.id} = ${prokurim_documents.prokurim_id}
      )
      select
        ranked_versions.version_id,
        ranked_versions.slot_ref,
        ranked_versions.version_rank = 1 as is_current,
        item_links.vertical,
        item_links.item_id,
        item_links.source_origin,
        item_links.app_id,
        item_links.published_date,
        item_links.manually_created
      from ranked_versions
      left join item_links on item_links.document_version_id = ranked_versions.version_id
      where ranked_versions.document_id = ${documentId}
      order by ranked_versions.slot_ref, ranked_versions.version_id, item_links.item_id
    `);
    return classifySourceSlotRows(Array.from(rows), documentId);
  }

  async insertCheck(input: {
    documentId: string;
    runId: string;
    checkedAt: Date;
    status: DocumentCheckStatus;
    resultDetail: DocumentCheckResultDetail;
  }): Promise<DocumentCheckRecord | null> {
    const [row] = await db
      .insert(document_checks)
      .values({
        document_id: input.documentId,
        run_id: input.runId,
        checked_at: input.checkedAt,
        status: input.status,
        result_detail: input.resultDetail,
      })
      .onConflictDoNothing({
        target: [document_checks.run_id, document_checks.document_id],
      })
      .returning();
    return row ? toCheckRecord(row) : null;
  }
}

function emptySourceSummary(): SourceVerificationSummary {
  return {
    sourceOk: null,
    changed: false,
    unreachable: false,
    notApplicableOnly: true,
    results: [],
  };
}

function selectStatus(input: {
  storedOk: boolean | null;
  tokenValid: boolean | null;
  tokenMissing: boolean;
  source: SourceVerificationSummary;
  internalErrors: string[];
}): DocumentCheckStatus {
  if (input.storedOk === false) return 'stored_mismatch';
  if (input.tokenValid === false) return 'token_invalid';
  if (input.source.changed) return 'source_changed';
  if (input.internalErrors.length > 0) return 'error';
  if (input.tokenMissing) return 'token_missing';
  if (input.source.unreachable) return 'source_unreachable';
  if (input.source.notApplicableOnly) return 'source_not_applicable';
  return 'verified';
}

export function createDocumentReverifier(
  dependencies: DocumentReverifierDependencies,
): (documentId: string, runId: string) => Promise<DocumentCheckRecord> {
  return async (documentId: string, runId: string): Promise<DocumentCheckRecord> => {
    if (!documentId.trim()) throw new Error('documentId is required');
    if (!runId.trim()) throw new Error('runId is required');

    const existing = await dependencies.repository.findCheck(documentId, runId);
    if (existing) return existing;

    const document = await dependencies.repository.findDocument(documentId);
    if (!document) throw new Error(`Document ${documentId} not found`);

    const internalErrors: string[] = [];
    let storedOk: boolean | null = null;
    try {
      const storedBytes = await dependencies.storage.download(document.storage_uri);
      storedOk = dependencies.hash(storedBytes) === document.sha256;
    } catch (error) {
      internalErrors.push(
        `stored document read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let source = emptySourceSummary();
    try {
      const slots = await dependencies.repository.findSourceSlots(document.id);
      source = await dependencies.sourceVerifier.verify(slots, document.sha256, runId);
    } catch (error) {
      internalErrors.push(
        `source verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let tokenValid: boolean | null = null;
    let tsaTime: Date | null = null;
    let tokenValidationReason: string | undefined;
    if (document.tsr_token) {
      try {
        const validation = await dependencies.validateToken(document.tsr_token, document.sha256);
        tokenValid = validation.valid;
        tsaTime = validation.valid ? validation.tsaTime : null;
        if (!validation.valid) tokenValidationReason = validation.reason;
      } catch (error) {
        internalErrors.push(
          `timestamp validation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const detailErrors = [
      ...internalErrors,
      ...(tokenValidationReason ? [`timestamp token invalid: ${tokenValidationReason}`] : []),
    ];
    const resultDetail: DocumentCheckResultDetail = {
      stored_ok: storedOk,
      source_ok: source.sourceOk,
      token_valid: tokenValid,
      ...(source.observedSourceSha256
        ? { observed_source_sha256: source.observedSourceSha256 }
        : {}),
      ...(tsaTime ? { tsa_time: tsaTime.toISOString() } : {}),
      ...(detailErrors.length > 0 ? { error: detailErrors.join('; ') } : {}),
      source_results: source.results,
    };
    const status = selectStatus({
      storedOk,
      tokenValid,
      tokenMissing: document.tsr_token === null,
      source,
      internalErrors,
    });

    const inserted = await dependencies.repository.insertCheck({
      documentId: document.id,
      runId,
      checkedAt: dependencies.now(),
      status,
      resultDetail,
    });
    if (inserted) return inserted;

    const concurrent = await dependencies.repository.findCheck(document.id, runId);
    if (concurrent) return concurrent;
    throw new Error(`Failed to persist document check for ${document.id} in run ${runId}`);
  };
}

const defaultRepository = new DrizzleReverificationRepository();
const defaultStorage = new LocalDiskAdapter(process.env.STORAGE_LOCAL_PATH ?? './uploads');
const defaultSourceVerifier = new DefaultSourceVerifier();

export const reverifyDocument = createDocumentReverifier({
  repository: defaultRepository,
  storage: defaultStorage,
  sourceVerifier: defaultSourceVerifier,
  hash: hashBytes,
  validateToken: validateTimestampToken,
  now: () => new Date(),
});
