import { db } from '@tra/db';
import {
  audit_log,
  document_versions,
  documents,
  konsultim_documents,
  konsultime,
  municipalities,
} from '@tra/db';
import {
  type AllowedDocumentExt,
  LocalDiskAdapter,
  assertDevDatabase,
  buildContentAddressedStorageKey,
  deriveDocFormat,
  hashBytes,
  requestTimestamp,
  resolveVersionDecision,
  validateDocumentBytes,
} from '@tra/shared';
import * as cheerio from 'cheerio';
import { and, desc, eq } from 'drizzle-orm';
import { fetch } from 'undici';
import { BaseScraper } from '../base-scraper.js';

const SOURCE_ORIGIN = 'bashkiashkoder.gov.al';
const DETAIL_URL_PATH_PREFIX = '/k%C3%ABshillim_m_publikun/';
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

const HTTP_HEADERS = {
  'User-Agent': 'TransparencyRadar/0.1 (+contact@transparency-radar.al)',
  'Accept-Language': 'sq-AL,sq;q=0.9,en;q=0.8',
};

interface DocumentFormat {
  ext: AllowedDocumentExt;
  mime: string;
}

export interface KonsultimDocumentRow {
  id: string;
  sourceUrl: string;
  title: string;
}

export interface DetailDocumentLink {
  label: string;
  originalFilename: string;
  url: string;
}

export interface EnrichmentStats {
  auditEntriesCreated: number;
  documentVersionsCreated: number;
  documentsFailed: number;
  documentsLinked: number;
  documentsSeen: number;
  documentsSkipped: number;
  documentsStored: number;
  rowsSeen: number;
  rowsSkipped: number;
  rowsWithDocuments: number;
}

interface DocumentRecord {
  created: boolean;
  id: string;
  tsrToken: string | null;
}

interface VersionRecord {
  created: boolean;
  id: string;
}

export interface LinkAuditInput {
  byteSize: number;
  documentId: string;
  documentUrl: string;
  konsultimId: string;
  label: string;
  mimeType: string;
  originalFilename: string;
  sha256: string;
  storageKey: string;
  versionId: string;
}

export interface EnrichmentRepository {
  findDocumentTsrToken(documentId: string): Promise<string | null>;
  linkDocumentAndAudit(input: LinkAuditInput): Promise<boolean>;
  loadKonsultimeRows(): Promise<KonsultimDocumentRow[]>;
  updateDocumentTimestamp(documentId: string, tsrToken: string): Promise<void>;
  upsertDocument(
    sha256: string,
    storageKey: string,
    byteSize: number,
    mimeType: string,
  ): Promise<DocumentRecord>;
  upsertDocumentVersion(documentId: string, slotRef: string): Promise<VersionRecord>;
}

export interface StorageLike {
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
}

export type FetchLike = typeof fetch;
type HashLike = typeof hashBytes;
type TimestampLike = typeof requestTimestamp;

export interface EnricherDependencies {
  delay?: (ms: number) => Promise<void>;
  fetchImpl?: FetchLike;
  hash?: HashLike;
  repository?: EnrichmentRepository;
  storage?: StorageLike;
  timestamp?: TimestampLike;
}

interface DocumentProcessResult {
  auditCreated: boolean;
  linked: boolean;
  skipped: boolean;
  stored: boolean;
  versionCreated: boolean;
}

export function isOfficialShkoderKonsultimeDetailUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://bashkiashkoder.gov.al' &&
      url.pathname.includes(DETAIL_URL_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}

export function extractShkoderKonsultimeDocumentLinks(
  html: string,
  detailUrl: string,
): DetailDocumentLink[] {
  const $ = cheerio.load(html);
  const links: DetailDocumentLink[] = [];
  const seen = new Set<string>();

  $('a[data-type="attachment"]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    if (!href) return;

    let url: URL;
    try {
      url = new URL(href, detailUrl);
    } catch {
      return;
    }

    if (url.origin !== 'https://bashkiashkoder.gov.al') return;
    if (!url.pathname.startsWith('/wp-content/uploads/')) return;
    const absoluteUrl = url.toString();
    if (seen.has(absoluteUrl)) return;
    seen.add(absoluteUrl);

    const label = normalizeText($(el).text()) || 'Dokumenti';
    const originalFilename = decodeURIComponent(url.pathname.split('/').pop() ?? 'document');
    links.push({ label, originalFilename, url: absoluteUrl });
  });

  return links;
}

export function getAllowedDocumentFormat(sourceUrl: string): DocumentFormat | null {
  const format = deriveDocFormat(sourceUrl);
  if (format.ext !== 'pdf' && format.ext !== 'doc' && format.ext !== 'docx') return null;
  return { ext: format.ext, mime: format.mime };
}

export class ShkoderKonsultimeDocumentEnricher extends BaseScraper {
  private readonly delayFn: (ms: number) => Promise<void>;
  private readonly fetchImpl: FetchLike;
  private readonly hash: HashLike;
  private readonly repository: EnrichmentRepository;
  private readonly storage: StorageLike;
  private readonly timestamp: TimestampLike;

  constructor(dependencies: EnricherDependencies = {}) {
    super('shkoder', 'konsultime');
    this.delayFn = dependencies.delay ?? delay;
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.hash = dependencies.hash ?? hashBytes;
    this.repository = dependencies.repository ?? new DrizzleEnrichmentRepository();
    this.storage =
      dependencies.storage ?? new LocalDiskAdapter(process.env.STORAGE_LOCAL_PATH ?? './uploads');
    this.timestamp = dependencies.timestamp ?? requestTimestamp;
  }

  async run(): Promise<void> {
    await this.runWithStats();
  }

  async runWithStats(): Promise<EnrichmentStats> {
    assertDevDatabase(undefined, 'Shkodër konsultime document enrichment');

    const rows = await this.repository.loadKonsultimeRows();
    const totals = emptyStats();
    totals.rowsSeen = rows.length;

    for (const row of rows) {
      const stats = await this.enrichKonsultim(row);
      addStats(totals, stats);
    }

    this.logger.info(totals, 'Shkodër konsultime document enrichment complete');
    return totals;
  }

  async enrichKonsultim(row: KonsultimDocumentRow): Promise<EnrichmentStats> {
    const stats = emptyStats();

    if (!isOfficialShkoderKonsultimeDetailUrl(row.sourceUrl)) {
      stats.rowsSkipped += 1;
      this.logger.warn(
        { konsultimId: row.id, sourceUrl: row.sourceUrl },
        'Skipping non-official detail URL',
      );
      return stats;
    }

    let html: string;
    try {
      html = await this.fetchText(row.sourceUrl);
    } catch (err) {
      stats.rowsSkipped += 1;
      this.logger.warn(
        { err, konsultimId: row.id, sourceUrl: row.sourceUrl },
        'Detail page fetch failed',
      );
      return stats;
    }

    const links = extractShkoderKonsultimeDocumentLinks(html, row.sourceUrl);
    if (links.length === 0) {
      this.logger.info(
        { konsultimId: row.id, sourceUrl: row.sourceUrl },
        'No consultation documents found',
      );
      return stats;
    }

    stats.rowsWithDocuments += 1;
    stats.documentsSeen += links.length;

    for (const link of links) {
      await this.delayFn(500 + Math.random() * 500);
      try {
        const result = await this.enrichDocument(row, link);
        if (result.skipped) {
          stats.documentsSkipped += 1;
          continue;
        }
        if (result.stored) stats.documentsStored += 1;
        if (result.versionCreated) stats.documentVersionsCreated += 1;
        if (result.linked) stats.documentsLinked += 1;
        if (result.auditCreated) stats.auditEntriesCreated += 1;
      } catch (err) {
        stats.documentsFailed += 1;
        this.logger.warn(
          { err, konsultimId: row.id, label: link.label, documentUrl: link.url },
          'Document enrichment failed — skipping document',
        );
      }
    }

    return stats;
  }

  async enrichDocument(
    row: KonsultimDocumentRow,
    link: DetailDocumentLink,
  ): Promise<DocumentProcessResult> {
    const format = getAllowedDocumentFormat(link.url);
    if (!format) {
      this.logger.warn({ documentUrl: link.url }, 'Unsupported document extension — skipping');
      return emptyDocumentResult({ skipped: true });
    }

    const bytes = await this.fetchDocumentBytes(link.url);
    validateDocumentBytes(bytes, format.ext);

    const sha256 = this.hash(bytes);
    const storageKey = buildContentAddressedStorageKey('shkoder', 'konsultime', sha256, format.ext);
    await this.storage.upload(storageKey, bytes, format.mime);

    const document = await this.repository.upsertDocument(
      sha256,
      storageKey,
      bytes.length,
      format.mime,
    );
    await this.ensureDocumentStamped(document.id, sha256);

    const version = await this.repository.upsertDocumentVersion(document.id, link.url);
    const linkCreated = await this.repository.linkDocumentAndAudit({
      byteSize: bytes.length,
      documentId: document.id,
      documentUrl: link.url,
      konsultimId: row.id,
      label: link.label,
      mimeType: format.mime,
      originalFilename: link.originalFilename,
      sha256,
      storageKey,
      versionId: version.id,
    });

    return {
      auditCreated: linkCreated,
      linked: linkCreated,
      skipped: false,
      stored: true,
      versionCreated: version.created,
    };
  }

  private async ensureDocumentStamped(documentId: string, sha256: string): Promise<void> {
    const tsrToken = await this.repository.findDocumentTsrToken(documentId);
    if (tsrToken) return;

    try {
      const token = await this.timestamp(sha256, this.fetchImpl);
      if (!token) throw new Error('FreeTSA returned an empty timestamp reply');
      await this.repository.updateDocumentTimestamp(documentId, token);
    } catch (err) {
      this.logger.warn({ err, documentId }, 'FreeTSA timestamp failed — tsr_token left null');
    }
  }

  private async fetchText(url: string): Promise<string> {
    const res = await this.fetchImpl(url, {
      headers: HTTP_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Detail fetch failed: ${res.status.toString()} ${url}`);
    return res.text();
  }

  private async fetchDocumentBytes(url: string): Promise<Buffer> {
    const res = await this.fetchImpl(url, {
      headers: { ...HTTP_HEADERS, Accept: '*/*' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Document fetch failed: ${res.status.toString()} ${url}`);
    return readResponseBodyWithLimit(res, MAX_DOCUMENT_BYTES);
  }
}

class DrizzleEnrichmentRepository implements EnrichmentRepository {
  async loadKonsultimeRows(): Promise<KonsultimDocumentRow[]> {
    return db
      .select({
        id: konsultime.id,
        sourceUrl: konsultime.source_url,
        title: konsultime.title,
      })
      .from(konsultime)
      .innerJoin(municipalities, eq(konsultime.municipality_id, municipalities.id))
      .where(and(eq(municipalities.slug, 'shkoder'), eq(konsultime.source_origin, SOURCE_ORIGIN)));
  }

  async upsertDocument(
    sha256: string,
    storageKey: string,
    byteSize: number,
    mimeType: string,
  ): Promise<DocumentRecord> {
    const [inserted] = await db
      .insert(documents)
      .values({
        sha256,
        storage_uri: storageKey,
        mime_type: mimeType,
        byte_size: byteSize,
        first_seen_at: new Date(),
      })
      .onConflictDoNothing({ target: documents.sha256 })
      .returning({ id: documents.id, tsrToken: documents.tsr_token });

    if (inserted) return { id: inserted.id, created: true, tsrToken: inserted.tsrToken };

    const [existing] = await db
      .select({ id: documents.id, tsrToken: documents.tsr_token })
      .from(documents)
      .where(eq(documents.sha256, sha256))
      .limit(1);

    if (!existing) throw new Error(`Document with sha256 ${sha256} not found after conflict`);
    return { id: existing.id, created: false, tsrToken: existing.tsrToken };
  }

  async findDocumentTsrToken(documentId: string): Promise<string | null> {
    const [existing] = await db
      .select({ tsrToken: documents.tsr_token })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!existing) throw new Error(`Document ${documentId} not found before timestamping`);
    return existing.tsrToken;
  }

  async updateDocumentTimestamp(documentId: string, tsrToken: string): Promise<void> {
    await db
      .update(documents)
      .set({ tsr_token: tsrToken, tsr_timestamp_at: new Date() })
      .where(eq(documents.id, documentId));
  }

  async upsertDocumentVersion(documentId: string, slotRef: string): Promise<VersionRecord> {
    const [latest] = await db
      .select()
      .from(document_versions)
      .where(eq(document_versions.slot_ref, slotRef))
      .orderBy(desc(document_versions.version_no))
      .limit(1);

    const decision = resolveVersionDecision(latest, documentId);
    if (decision.action === 'reuse') return { id: decision.id, created: false };

    const [version] = await db
      .insert(document_versions)
      .values({ document_id: documentId, slot_ref: slotRef, version_no: decision.versionNo })
      .returning({ id: document_versions.id });
    if (!version) throw new Error('document_versions insert returned nothing');
    return { id: version.id, created: true };
  }

  async linkDocumentAndAudit(input: LinkAuditInput): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [linked] = await tx
        .insert(konsultim_documents)
        .values({
          konsultim_id: input.konsultimId,
          document_version_id: input.versionId,
        })
        .onConflictDoNothing()
        .returning({ konsultimId: konsultim_documents.konsultim_id });

      if (!linked) return false;

      await tx.insert(audit_log).values({
        action: 'document_enrich',
        table_name: 'konsultime',
        record_id: input.konsultimId,
        actor_id: 'scraper:shkoder:konsultime-documents',
        payload: {
          byte_size: input.byteSize,
          document_id: input.documentId,
          document_version_id: input.versionId,
          label: input.label,
          mime_type: input.mimeType,
          original_filename: input.originalFilename,
          sha256: input.sha256,
          source_url: input.documentUrl,
          storage_uri: input.storageKey,
        },
      });

      return true;
    });
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function readResponseBodyWithLimit(res: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(res.headers.get('content-length') ?? 0);
  if (contentLength > maxBytes) throw new Error('Document exceeds max size of 50 MB');

  if (!res.body) {
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('Document exceeds max size of 50 MB');
    return buffer;
  }

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Document exceeds max size of 50 MB');
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }

  return Buffer.concat(chunks);
}

function emptyStats(): EnrichmentStats {
  return {
    auditEntriesCreated: 0,
    documentVersionsCreated: 0,
    documentsFailed: 0,
    documentsLinked: 0,
    documentsSeen: 0,
    documentsSkipped: 0,
    documentsStored: 0,
    rowsSeen: 0,
    rowsSkipped: 0,
    rowsWithDocuments: 0,
  };
}

function addStats(target: EnrichmentStats, source: EnrichmentStats): void {
  target.auditEntriesCreated += source.auditEntriesCreated;
  target.documentVersionsCreated += source.documentVersionsCreated;
  target.documentsFailed += source.documentsFailed;
  target.documentsLinked += source.documentsLinked;
  target.documentsSeen += source.documentsSeen;
  target.documentsSkipped += source.documentsSkipped;
  target.documentsStored += source.documentsStored;
  target.rowsSkipped += source.rowsSkipped;
  target.rowsWithDocuments += source.rowsWithDocuments;
}

function emptyDocumentResult(
  overrides: Partial<DocumentProcessResult> = {},
): DocumentProcessResult {
  return {
    auditCreated: false,
    linked: false,
    skipped: false,
    stored: false,
    versionCreated: false,
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
