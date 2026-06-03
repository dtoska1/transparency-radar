import { createHash } from 'node:crypto';
import { db } from '@tra/db';
import {
  document_versions,
  documents,
  municipalities,
  prokurim_documents,
  prokurime,
  scrape_runs,
  sources,
} from '@tra/db';
import {
  LocalDiskAdapter,
  MUNICIPALITY_SLUGS,
  type MunicipalityContext,
  type MunicipalitySlug,
  buildMunicipalityTermSet,
  matchAuthorityToMunicipalityAcrossContexts,
  normalizeText,
} from '@tra/shared';
import { parse } from 'csv-parse/sync';
import { and, desc, eq } from 'drizzle-orm';
import pino from 'pino';
import { fetch } from 'undici';

const APP_SOURCE_ORIGIN = 'app.gov.al';
const APP_SOURCE_PAGE_URL = 'https://app.gov.al/eksportimi-i-procedurave-te-publikuara/';
const APP_EXPORT_URL = (year: number) =>
  `https://app.gov.al/GetData/ExportDocument?year=${year.toString()}`;
const YEARS = [2023, 2024, 2025, 2026] as const;
const STORAGE_MIME = 'application/json';
const STORAGE_EXT = 'json';

const HTTP_HEADERS = {
  'User-Agent':
    'TransparencyRadarBot/1.0 (+https://github.com/dtoska1/transparency-radar; CSDG; dtoska@csdgalbania.org)',
  'Accept-Language': 'sq-AL,sq;q=0.9,en;q=0.8',
};

const APP_COLUMNS = [
  'Autoriteti_kontraktues',
  'Numri_i_references',
  'Objekti_i_prokurimit',
  'Lloji_i_procedures',
  'Tipi_i_kontrates',
  'Lloji_i_marreveshjes_kuader',
  'Fondi_limit',
  'Data_e_publikimit',
  'Data_e_hapjes',
  'Data_e_mbylljes',
  'Anulluar',
  'Arsyeja_e_anullimit',
  'Pezulluar',
  'Fituesi',
  'NIPT_i_fituesit',
  'Vlera_e_fituesit',
  'Vlera_e_fituesit_ne_lidhjen_e_kontrates',
  'Lidhja_e_kontrates_me_TVSH',
  'Numri_i_ofertave_te_dorezuara',
  'Numri_i_ofertave_te_kualifikuara',
  'Kodet_CPV',
] as const;

type AppColumn = (typeof APP_COLUMNS)[number];
type AppCsvRow = Record<AppColumn, string>;

const AMOUNT_COLUMNS = new Set<AppColumn>([
  'Fondi_limit',
  'Vlera_e_fituesit',
  'Vlera_e_fituesit_ne_lidhjen_e_kontrates',
]);

const DATE_COLUMNS = new Set<AppColumn>(['Data_e_publikimit', 'Data_e_hapjes', 'Data_e_mbylljes']);

const INTEGER_COLUMNS = new Set<AppColumn>([
  'Numri_i_ofertave_te_dorezuara',
  'Numri_i_ofertave_te_kualifikuara',
]);

const MUNICIPALITY_DEFS = [
  { slug: 'tirana', nameSq: 'Tiranë', aliasKeys: ['tirane'] },
  { slug: 'shkoder', nameSq: 'Shkodër', aliasKeys: ['shkodra'] },
  { slug: 'durres', nameSq: 'Durrës', aliasKeys: [] },
  { slug: 'vlore', nameSq: 'Vlorë', aliasKeys: ['vlora'] },
  { slug: 'pogradec', nameSq: 'Pogradec', aliasKeys: [] },
] as const satisfies readonly {
  slug: MunicipalitySlug;
  nameSq: string;
  aliasKeys: readonly string[];
}[];

const logger = pino({ name: 'importer:prokurime:app-official' });

// TSQ builder copied from the vendime scrapers: RFC-3161 SHA-256 request, no external lib.
const TSQ_PREFIX = Buffer.from('303902010130313' + '00d060960864801650304020105000420', 'hex');
const TSQ_SUFFIX = Buffer.from('0101ff', 'hex');

interface SourceContext extends MunicipalityContext {
  slug: MunicipalitySlug;
  municipalityId: string;
  sourceId: string;
  sourcePageUrl: string;
  municipalityTerms: string[];
}

interface ParsedAppRow {
  appId: string;
  authorityName: string;
  procurementObject: string;
  publishedDate: string;
  canonicalBuffer: Buffer;
  sha256: string;
}

interface ProcessResult {
  seen: number;
  created: number;
  documentCreated: number;
  documentVersionCreated: number;
}

interface CoverageBucket {
  matched: number;
  created: number;
  documentVersionsCreated: number;
}

interface CoverageReport {
  byMunicipalityYear: Map<string, CoverageBucket>;
  matchedAuthoritySamples: string[];
  rejectedBashkiaAuthoritySamples: string[];
  invalidMatchedRows: number;
  totalRows: number;
  totalMatched: number;
  totalCreated: number;
  totalDocumentsCreated: number;
  totalDocumentVersionsCreated: number;
}

interface RunRow {
  id: string;
  slug: MunicipalitySlug;
}

function buildTsq(sha256Hex: string): Buffer {
  const hashBytes = Buffer.from(sha256Hex, 'hex');
  return Buffer.concat([TSQ_PREFIX, hashBytes, TSQ_SUFFIX]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertDevDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required');

  let hostname = '';
  try {
    hostname = new URL(raw).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (!['localhost', '127.0.0.1', 'postgres'].includes(hostname)) {
    throw new Error('APP official importer is DEV-only; refusing non-local DATABASE_URL host');
  }
}

function normalizeScalar(value: string): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeInteger(value: string): string {
  const normalized = normalizeScalar(value).replace(/\s/g, '');
  if (!normalized) return '';
  if (!/^-?\d+$/.test(normalized)) return normalizeScalar(value);

  const sign = normalized.startsWith('-') ? '-' : '';
  const digits = sign ? normalized.slice(1) : normalized;
  const integer = digits.replace(/^0+(?=\d)/, '');
  return integer === '0' ? '0' : `${sign}${integer}`;
}

function canonicalizeAmount(value: string): string {
  const original = normalizeScalar(value);
  let normalized = original.replace(/\s/g, '');
  if (!normalized) return '';

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');
  if (hasComma && hasDot) {
    normalized = normalized.replace(/,/g, '');
  } else if (hasComma && /^-?\d{1,3}(,\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/,/g, '');
  } else if (hasComma && /^-?\d+,\d+$/.test(normalized)) {
    normalized = normalized.replace(',', '.');
  }

  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return original;

  const [, sign, integerRaw, fractionRaw = ''] = match;
  const integer = integerRaw.replace(/^0+(?=\d)/, '');
  const fraction = fractionRaw.replace(/0+$/, '');
  const isZero = integer === '0' && !fraction;
  const prefix = sign && !isZero ? sign : '';
  return `${prefix}${integer}${fraction ? `.${fraction}` : ''}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

function parseAppDate(raw: string): string | null {
  const normalized = normalizeScalar(raw);
  if (!normalized) return null;

  const match = normalized.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw] = match;
  const day = Number.parseInt(dayRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const year = Number.parseInt(yearRaw, 10);

  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function canonicalizeColumn(column: AppColumn, value: string): string {
  if (AMOUNT_COLUMNS.has(column)) return canonicalizeAmount(value);
  if (INTEGER_COLUMNS.has(column)) return canonicalizeInteger(value);
  if (DATE_COLUMNS.has(column)) return parseAppDate(value) ?? normalizeScalar(value);
  return normalizeScalar(value);
}

function buildCanonicalSnapshot(row: AppCsvRow): Buffer {
  const fields = APP_COLUMNS.map((column) => [column, canonicalizeColumn(column, row[column])]);
  return Buffer.from(
    `${JSON.stringify({
      schema: 'app.gov.al.prokurime.export-row.v1',
      fields,
    })}\n`,
    'utf8',
  );
}

function addSample(samples: string[], value: string): void {
  const normalized = normalizeScalar(value);
  if (!normalized || samples.includes(normalized) || samples.length >= 15) return;
  samples.push(normalized);
}

function coverageKey(slug: MunicipalitySlug, year: number): string {
  return `${slug}:${year.toString()}`;
}

function getCoverageBucket(
  coverage: CoverageReport,
  slug: MunicipalitySlug,
  year: number,
): CoverageBucket {
  const key = coverageKey(slug, year);
  const existing = coverage.byMunicipalityYear.get(key);
  if (existing) return existing;

  const created = { matched: 0, created: 0, documentVersionsCreated: 0 };
  coverage.byMunicipalityYear.set(key, created);
  return created;
}

function toAppRow(record: string[]): AppCsvRow {
  const row = {} as AppCsvRow;
  for (let i = 0; i < APP_COLUMNS.length; i++) {
    const column = APP_COLUMNS[i];
    row[column] = record[i] ?? '';
  }
  return row;
}

function parseAppCsv(text: string, year: number): AppCsvRow[] {
  const records = parse(text.replace(/^\uFEFF/, ''), {
    bom: true,
    columns: false,
    delimiter: ',',
    skip_empty_lines: true,
  }) as string[][];

  const [header, ...rows] = records;
  if (!header) throw new Error(`APP CSV ${year.toString()} is empty`);

  const cleanHeader = header.map((cell) => normalizeScalar(cell));
  const headerMatches =
    cleanHeader.length === APP_COLUMNS.length &&
    APP_COLUMNS.every((column, index) => cleanHeader[index] === column);
  if (!headerMatches) {
    throw new Error(
      `APP CSV ${year.toString()} header mismatch: expected ${APP_COLUMNS.join(',')}`,
    );
  }

  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== APP_COLUMNS.length) {
      throw new Error(
        `APP CSV ${year.toString()} row ${(i + 2).toString()} has ${rows[i].length.toString()} columns`,
      );
    }
  }

  return rows.map((row) => toAppRow(row));
}

function parseMatchedRow(row: AppCsvRow): ParsedAppRow | null {
  const appId = normalizeScalar(row.Numri_i_references);
  const authorityName = normalizeScalar(row.Autoriteti_kontraktues);
  const procurementObject = normalizeScalar(row.Objekti_i_prokurimit);
  const publishedDate = parseAppDate(row.Data_e_publikimit);

  if (!appId || !authorityName || !procurementObject || !publishedDate) return null;

  const canonicalBuffer = buildCanonicalSnapshot(row);
  const sha256 = createHash('sha256').update(canonicalBuffer).digest('hex');

  return {
    appId,
    authorityName,
    procurementObject,
    publishedDate,
    canonicalBuffer,
    sha256,
  };
}

async function fetchWithRetry(url: string, maxRetries = 2): Promise<Response> {
  const backoffs = [2_000, 4_000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await delay(backoffs[attempt - 1] ?? 4_000);
      logger.warn({ url, attempt }, 'retrying after network error');
    }
    try {
      return await fetch(url, { headers: HTTP_HEADERS, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function stampDocument(docId: string, sha256Hex: string): Promise<void> {
  const tsq = buildTsq(sha256Hex);
  const res = await fetch('https://freetsa.org/tsr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/timestamp-query',
      Accept: 'application/timestamp-reply',
    },
    body: tsq,
  });
  if (!res.ok) throw new Error(`FreeTSA responded ${res.status}`);

  const tsr = Buffer.from(await res.arrayBuffer());
  if (tsr.length === 0) throw new Error('FreeTSA returned an empty timestamp reply');

  await db
    .update(documents)
    .set({ tsr_token: tsr.toString('base64'), tsr_timestamp_at: new Date() })
    .where(eq(documents.id, docId));
}

function buildMunicipalityContexts(sourceContexts: SourceContext[]): SourceContext[] {
  return sourceContexts.map((sourceContext) => {
    const def = MUNICIPALITY_DEFS.find(
      (municipalityDef) => municipalityDef.slug === sourceContext.slug,
    );
    if (!def) throw new Error(`Missing municipality definition for ${sourceContext.slug}`);

    return {
      ...sourceContext,
      nameKey: sourceContext.slug,
      municipalityTerms: buildMunicipalityTermSet({
        nameKey: sourceContext.slug,
        nameSq: def.nameSq,
        aliasKeys: def.aliasKeys,
      }),
    };
  });
}

export class AppOfficialProkurimeImporter {
  private readonly storage = new LocalDiskAdapter(process.env.STORAGE_LOCAL_PATH ?? './uploads');

  async run(): Promise<void> {
    assertDevDatabase();

    const sourceContexts = await this.loadAppSourceContexts();
    const municipalityContexts = buildMunicipalityContexts(sourceContexts);
    const runRows = await this.startScrapeRuns(sourceContexts);
    const coverage: CoverageReport = {
      byMunicipalityYear: new Map(),
      matchedAuthoritySamples: [],
      rejectedBashkiaAuthoritySamples: [],
      invalidMatchedRows: 0,
      totalRows: 0,
      totalMatched: 0,
      totalCreated: 0,
      totalDocumentsCreated: 0,
      totalDocumentVersionsCreated: 0,
    };

    try {
      for (let i = 0; i < YEARS.length; i++) {
        const year = YEARS[i];
        await this.processYear(year, municipalityContexts, coverage);
        if (i < YEARS.length - 1) await delay(3000);
      }

      await this.finishScrapeRuns(runRows, sourceContexts, coverage, 'success');
      await this.printCoverageReport(coverage);
    } catch (err) {
      await this.finishScrapeRuns(runRows, sourceContexts, coverage, 'error', String(err));
      throw err;
    }
  }

  private async loadAppSourceContexts(): Promise<SourceContext[]> {
    const rows = await db
      .select({
        slug: municipalities.slug,
        municipalityId: municipalities.id,
        sourceId: sources.id,
        sourcePageUrl: sources.source_page_url,
      })
      .from(sources)
      .innerJoin(municipalities, eq(sources.municipality_id, municipalities.id))
      .where(and(eq(sources.vertical, 'prokurime'), eq(sources.source_origin, APP_SOURCE_ORIGIN)));

    const allowedSlugs = new Set<string>(MUNICIPALITY_SLUGS);
    const bySlug = new Map<MunicipalitySlug, SourceContext[]>();

    for (const row of rows) {
      if (!allowedSlugs.has(row.slug)) continue;
      const slug = row.slug as MunicipalitySlug;
      const contexts = bySlug.get(slug) ?? [];
      contexts.push({
        slug,
        municipalityId: row.municipalityId,
        sourceId: row.sourceId,
        sourcePageUrl: row.sourcePageUrl,
        nameKey: slug,
        municipalityTerms: [],
      });
      bySlug.set(slug, contexts);
    }

    const missing = MUNICIPALITY_SLUGS.filter((slug) => !bySlug.has(slug));
    const duplicates = MUNICIPALITY_SLUGS.filter((slug) => (bySlug.get(slug)?.length ?? 0) > 1);
    const pageMismatches = MUNICIPALITY_SLUGS.filter((slug) =>
      (bySlug.get(slug) ?? []).some(
        (sourceContext) => sourceContext.sourcePageUrl !== APP_SOURCE_PAGE_URL,
      ),
    );

    if (
      rows.length !== MUNICIPALITY_SLUGS.length ||
      missing.length ||
      duplicates.length ||
      pageMismatches.length
    ) {
      logger.error(
        {
          foundRows: rows.length,
          missing,
          duplicates,
          pageMismatches,
          expectedSourceOrigin: APP_SOURCE_ORIGIN,
          expectedSourcePageUrl: APP_SOURCE_PAGE_URL,
        },
        'APP prokurime source preflight failed; no fetches or writes will be attempted',
      );
      throw new Error('Missing or invalid app.gov.al prokurime source rows');
    }

    return MUNICIPALITY_SLUGS.map((slug) => {
      const [sourceContext] = bySlug.get(slug) ?? [];
      if (!sourceContext) throw new Error(`Missing APP source context for ${slug}`);
      return sourceContext;
    });
  }

  private async startScrapeRuns(sourceContexts: SourceContext[]): Promise<RunRow[]> {
    const runRows: RunRow[] = [];
    for (const sourceContext of sourceContexts) {
      const [runRow] = await db
        .insert(scrape_runs)
        .values({
          source_id: sourceContext.sourceId,
          municipality_id: sourceContext.municipalityId,
          vertical: 'prokurime',
          started_at: new Date(),
          status: 'running',
        })
        .returning({ id: scrape_runs.id });
      if (!runRow) throw new Error(`Failed to insert scrape_run row for ${sourceContext.slug}`);
      runRows.push({ id: runRow.id, slug: sourceContext.slug });
    }
    return runRows;
  }

  private async finishScrapeRuns(
    runRows: RunRow[],
    sourceContexts: SourceContext[],
    coverage: CoverageReport,
    status: 'success' | 'error',
    errorMessage?: string,
  ): Promise<void> {
    for (const runRow of runRows) {
      const totals = YEARS.reduce(
        (acc, year) => {
          const bucket = coverage.byMunicipalityYear.get(coverageKey(runRow.slug, year));
          return {
            seen: acc.seen + (bucket?.matched ?? 0),
            created: acc.created + (bucket?.created ?? 0),
          };
        },
        { seen: 0, created: 0 },
      );

      const sourceContext = sourceContexts.find((context) => context.slug === runRow.slug);
      if (!sourceContext) throw new Error(`Missing source context for scrape run ${runRow.slug}`);

      await db
        .update(scrape_runs)
        .set({
          finished_at: new Date(),
          status,
          items_seen: totals.seen,
          items_new: totals.created,
          items_updated: 0,
          error_message: errorMessage ?? null,
        })
        .where(eq(scrape_runs.id, runRow.id));
    }
  }

  private async processYear(
    year: number,
    municipalityContexts: SourceContext[],
    coverage: CoverageReport,
  ): Promise<void> {
    const exportUrl = APP_EXPORT_URL(year);
    logger.info({ year, url: exportUrl }, 'fetching APP export');
    const res = await fetchWithRetry(exportUrl);

    if (!res.ok) throw new Error(`APP export ${year.toString()} responded ${res.status}`);
    const text = Buffer.from(await res.arrayBuffer())
      .toString('utf8')
      .replace(/^\uFEFF/, '');
    const rows = parseAppCsv(text, year);

    logger.info({ year, rows: rows.length }, 'APP export parsed');

    for (const row of rows) {
      coverage.totalRows += 1;

      const authority = row.Autoriteti_kontraktues;
      const match = matchAuthorityToMunicipalityAcrossContexts({
        authority,
        municipalityContexts,
      });

      if (!match.matched || !match.municipalityContext) {
        if (normalizeText(authority).includes('BASHKIA')) {
          addSample(coverage.rejectedBashkiaAuthoritySamples, authority);
        }
        continue;
      }

      coverage.totalMatched += 1;
      addSample(coverage.matchedAuthoritySamples, authority);
      const bucket = getCoverageBucket(coverage, match.municipalityContext.slug, year);
      bucket.matched += 1;

      const parsedRow = parseMatchedRow(row);
      if (!parsedRow) {
        coverage.invalidMatchedRows += 1;
        logger.warn({ year, authority }, 'matched APP row missing required mapped fields');
        continue;
      }

      const result = await this.processMatchedRow(parsedRow, match.municipalityContext, exportUrl);
      coverage.totalCreated += result.created;
      coverage.totalDocumentsCreated += result.documentCreated;
      coverage.totalDocumentVersionsCreated += result.documentVersionCreated;
      bucket.created += result.created;
      bucket.documentVersionsCreated += result.documentVersionCreated;
    }
  }

  private async processMatchedRow(
    row: ParsedAppRow,
    sourceContext: SourceContext,
    exportUrl: string,
  ): Promise<ProcessResult> {
    const storageKey = `${sourceContext.slug}/prokurime/${row.sha256}.${STORAGE_EXT}`;
    await this.storage.upload(storageKey, row.canonicalBuffer, STORAGE_MIME);

    const document = await this.upsertDocument(
      row.sha256,
      storageKey,
      row.canonicalBuffer.length,
      STORAGE_MIME,
    );
    await this.ensureDocumentStamped(document.id, row.sha256);

    const documentVersion = await this.upsertDocumentVersion(
      document.id,
      `prokurime:app:${row.appId}:source-row`,
    );
    const prokurim = await this.upsertProkurim(row, sourceContext, exportUrl);
    await db
      .insert(prokurim_documents)
      .values({ prokurim_id: prokurim.id, document_version_id: documentVersion.id })
      .onConflictDoNothing();

    return {
      seen: 1,
      created: prokurim.created ? 1 : 0,
      documentCreated: document.created ? 1 : 0,
      documentVersionCreated: documentVersion.created ? 1 : 0,
    };
  }

  private async upsertDocument(
    sha256: string,
    storageKey: string,
    byteSize: number,
    mime = STORAGE_MIME,
  ): Promise<{ id: string; created: boolean; tsrToken: string | null }> {
    const [inserted] = await db
      .insert(documents)
      .values({
        sha256,
        storage_uri: storageKey,
        mime_type: mime,
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

  private async ensureDocumentStamped(documentId: string, sha256: string): Promise<void> {
    const [existing] = await db
      .select({ tsrToken: documents.tsr_token })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!existing) throw new Error(`Document ${documentId} not found before timestamping`);
    if (existing.tsrToken) return;

    await stampDocument(documentId, sha256);
  }

  private async upsertDocumentVersion(
    documentId: string,
    slotRef: string,
  ): Promise<{ id: string; created: boolean }> {
    const [latest] = await db
      .select()
      .from(document_versions)
      .where(eq(document_versions.slot_ref, slotRef))
      .orderBy(desc(document_versions.version_no))
      .limit(1);

    if (!latest) {
      const [version] = await db
        .insert(document_versions)
        .values({ document_id: documentId, slot_ref: slotRef, version_no: 1 })
        .returning({ id: document_versions.id });
      if (!version) throw new Error('document_versions insert returned nothing');
      return { id: version.id, created: true };
    }

    if (latest.document_id === documentId) {
      return { id: latest.id, created: false };
    }

    const [version] = await db
      .insert(document_versions)
      .values({ document_id: documentId, slot_ref: slotRef, version_no: latest.version_no + 1 })
      .returning({ id: document_versions.id });
    if (!version) throw new Error('document_versions insert returned nothing');
    return { id: version.id, created: true };
  }

  private async upsertProkurim(
    row: ParsedAppRow,
    sourceContext: SourceContext,
    exportUrl: string,
  ): Promise<{ id: string; created: boolean }> {
    const dedupKey = `prokurime:app:${row.appId}`;
    const [inserted] = await db
      .insert(prokurime)
      .values({
        municipality_id: sourceContext.municipalityId,
        source_id: sourceContext.sourceId,
        source_origin: APP_SOURCE_ORIGIN,
        is_unofficial_proxy: false,
        source_page_url: APP_SOURCE_PAGE_URL,
        source_url: exportUrl,
        dedup_key: dedupKey,
        app_id: row.appId,
        title: row.procurementObject,
        contracting_authority: row.authorityName,
        procurement_object: row.procurementObject,
        published_date: row.publishedDate,
        review_status: 'pending',
        collected_at: new Date(),
      })
      .onConflictDoNothing({ target: prokurime.dedup_key })
      .returning({ id: prokurime.id });

    if (inserted) return { id: inserted.id, created: true };

    const [existing] = await db
      .select({ id: prokurime.id })
      .from(prokurime)
      .where(eq(prokurime.dedup_key, dedupKey))
      .limit(1);

    if (!existing) throw new Error(`Prokurim with dedup key ${dedupKey} not found after conflict`);
    return { id: existing.id, created: false };
  }

  private async printCoverageReport(coverage: CoverageReport): Promise<void> {
    const matchedByMunicipalityYear = Object.fromEntries(
      MUNICIPALITY_SLUGS.map((slug) => [
        slug,
        Object.fromEntries(
          YEARS.map((year) => {
            const bucket = coverage.byMunicipalityYear.get(coverageKey(slug, year));
            return [
              year,
              {
                matched: bucket?.matched ?? 0,
                created: bucket?.created ?? 0,
                documentVersionsCreated: bucket?.documentVersionsCreated ?? 0,
              },
            ];
          }),
        ),
      ]),
    );

    logger.info(
      {
        matchedByMunicipalityYear,
        totalRows: coverage.totalRows,
        totalMatched: coverage.totalMatched,
        totalCreated: coverage.totalCreated,
        totalDocumentsCreated: coverage.totalDocumentsCreated,
        totalDocumentVersionsCreated: coverage.totalDocumentVersionsCreated,
        invalidMatchedRows: coverage.invalidMatchedRows,
        matchedAuthoritySamples: coverage.matchedAuthoritySamples,
        rejectedBashkiaAuthoritySamples: coverage.rejectedBashkiaAuthoritySamples,
      },
      'APP official prokurime coverage report',
    );
  }
}

export async function run(): Promise<void> {
  await new AppOfficialProkurimeImporter().run();
}
