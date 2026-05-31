import { createHash } from 'node:crypto';
import { db } from '@tra/db';
import {
  document_versions,
  documents,
  municipalities,
  scrape_runs,
  sources,
  vendim_documents,
  vendime,
} from '@tra/db';
import { LocalDiskAdapter, deriveDocFormat } from '@tra/shared';
import * as cheerio from 'cheerio';
import { and, desc, eq } from 'drizzle-orm';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { fetch } from 'undici';
import { BaseScraper } from '../base-scraper.js';

const LISTING_URL = 'https://bashkiapogradec.gov.al/publikime-kategori/vendime-te-keshillit-2';
const SOURCE_ORIGIN = 'bashkiapogradec.gov.al';
const ALLOWED_HOST = 'bashkiapogradec.gov.al';
const MANDATE_START = '2023-01-01';

const HTTP_HEADERS = {
  'User-Agent': 'TransparencyRadar/0.1 (+contact@transparency-radar.al)',
  'Accept-Language': 'sq-AL,sq;q=0.9,en;q=0.8',
};

// ── TSQ builder (RFC-3161 SHA-256, 59 bytes, no external lib) ─────────────────

const TSQ_PREFIX = Buffer.from('303902010130313' + '00d060960864801650304020105000420', 'hex');
const TSQ_SUFFIX = Buffer.from('0101ff', 'hex');

function buildTsq(sha256Hex: string): Buffer {
  const hashBytes = Buffer.from(sha256Hex, 'hex');
  return Buffer.concat([TSQ_PREFIX, hashBytes, TSQ_SUFFIX]);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseMeetingDate(raw: string): string | null {
  const normalized = raw.replace(/[-/]/g, '.').trim();
  const match = normalized.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,5})/);
  if (!match) return null;

  let [, dd, mm, yyyy] = match as [string, string, string, string];

  if (yyyy.length === 2) {
    const y = Number.parseInt(yyyy, 10);
    yyyy = y <= 30 ? `20${yyyy.padStart(2, '0')}` : `19${yyyy.padStart(2, '0')}`;
  } else if (yyyy.length === 5 && yyyy.startsWith('20')) {
    yyyy = yyyy.slice(0, 4);
  }

  const isoDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;

  return isoDate;
}

// ── FreeTSA (async, fire-and-forget) ─────────────────────────────────────────

async function stampDocument(
  docId: string,
  sha256Hex: string,
  logger: import('pino').Logger,
): Promise<void> {
  try {
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
    await db
      .update(documents)
      .set({ tsr_token: tsr.toString('base64'), tsr_timestamp_at: new Date() })
      .where(eq(documents.id, docId));
  } catch (err) {
    logger.warn({ err, docId }, 'FreeTSA timestamp failed — tsr_token left null');
  }
}

// ── Number from PDF filename ──────────────────────────────────────────────────

function numberFromFilename(pdfUrl: string): string | null {
  const filename = new URL(pdfUrl).pathname.split('/').pop() ?? '';
  // longest alternation first; optional nr|ne marker; captures decision number not date
  return filename.match(/(?:vkbr?|vendimi?|vend|ven)[-_ ]?(?:n[re]\.?[-_ ]?)?(\d+)/i)?.[1] ?? null;
}

// ── Year validation ───────────────────────────────────────────────────────────

function isValidYear(isoDate: string): boolean {
  const year = Number.parseInt(isoDate.slice(0, 4), 10);
  return year >= 2018 && year <= 2027;
}

// ── PDF enrichment (best-effort, non-fatal) ───────────────────────────────────

async function extractTitleFromPdf(
  buffer: Buffer,
): Promise<{ title: string | null; number: string | null }> {
  try {
    const { text } = await pdfParse(buffer);
    const firstLine = text.trim().split('\n')[0]?.trim() ?? '';
    const numMatch = text.match(/(?:VKB|Vendim|Vend)\s+nr\.?\s*(\d+)/i);
    return {
      title: firstLine.length > 5 ? firstLine : null,
      number: numMatch?.[1] ?? null,
    };
  } catch {
    return { title: null, number: null };
  }
}

// ── Scraper ───────────────────────────────────────────────────────────────────

interface DetailEntry {
  detailUrl: string;
  dateFromSlug: string | null;
}

interface DetailPage {
  date: string;
  pdfUrls: string[];
  detailUrl: string;
}

interface Meeting {
  date: string;
  pdfUrl: string;
}

interface Decision {
  number: string;
  signedDate: string | null;
}

interface ProcessResult {
  seen: number;
  created: number;
}

export class PogradecVendimeScraper extends BaseScraper {
  private readonly storage: LocalDiskAdapter;
  private readonly firstRunLimit: number;

  constructor(opts: { firstRunLimit?: number } = {}) {
    super('pogradec', 'vendime');
    this.storage = new LocalDiskAdapter(process.env.STORAGE_LOCAL_PATH ?? './uploads');
    this.firstRunLimit = opts.firstRunLimit ?? 1;
  }

  async run(): Promise<void> {
    const { sourceId, municipalityId } = await this.lookupSource();

    const [runRow] = await db
      .insert(scrape_runs)
      .values({
        source_id: sourceId,
        municipality_id: municipalityId,
        vertical: 'vendime',
        started_at: new Date(),
        status: 'running',
      })
      .returning({ id: scrape_runs.id });

    if (!runRow) throw new Error('Failed to insert scrape_run row');
    const runId = runRow.id;
    let totalSeen = 0;
    let totalNew = 0;

    try {
      const entries = await this.fetchListingEntries();
      this.logger.info({ kept: entries.length }, 'Listing fetched');

      for (const entry of entries) {
        await this.delay(1000 + Math.random() * 500);
        const detail = await this.fetchDetailPage(entry.detailUrl);
        if (!detail) continue;
        const result = await this.processDetailPage(detail, sourceId, municipalityId);
        totalSeen += result.seen;
        totalNew += result.created;
      }

      await db
        .update(scrape_runs)
        .set({
          finished_at: new Date(),
          status: 'success',
          items_seen: totalSeen,
          items_new: totalNew,
          items_updated: 0,
        })
        .where(eq(scrape_runs.id, runId));

      this.logger.info({ runId, totalSeen, totalNew }, 'Scrape run complete');
    } catch (err) {
      await db
        .update(scrape_runs)
        .set({
          finished_at: new Date(),
          status: 'error',
          items_seen: totalSeen,
          items_new: totalNew,
          items_updated: 0,
          error_message: String(err),
        })
        .where(eq(scrape_runs.id, runId));
      throw err;
    }
  }

  private async lookupSource(): Promise<{ sourceId: string; municipalityId: string }> {
    const [found] = await db
      .select({ sourceId: sources.id, municipalityId: sources.municipality_id })
      .from(sources)
      .innerJoin(municipalities, eq(sources.municipality_id, municipalities.id))
      .where(and(eq(municipalities.slug, 'pogradec'), eq(sources.vertical, 'vendime')))
      .limit(1);

    if (!found)
      throw new Error('Source not found for pogradec/vendime — run db:seed:sources first');
    return { sourceId: found.sourceId, municipalityId: found.municipalityId };
  }

  private async fetchListingEntries(): Promise<DetailEntry[]> {
    const res = await fetch(LISTING_URL, { headers: HTTP_HEADERS });
    if (!res.ok) throw new Error(`Listing fetch failed: ${res.status}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const entries: DetailEntry[] = [];
    const seen = new Set<string>();

    $('a[href*="/publikime/vendime-te-keshillit-2/"]').each((_i, el) => {
      const href = $(el).attr('href') ?? '';
      if (!href || href.includes('/publikime-kategori/')) return;
      const detailUrl = href.startsWith('http') ? href : new URL(href, LISTING_URL).toString();
      if (seen.has(detailUrl)) return;
      seen.add(detailUrl);

      // Date from URL slug: …-dates-30-03-2026-856/
      const dateFromSlug = parseMeetingDate(detailUrl);
      entries.push({ detailUrl, dateFromSlug });
    });

    if (entries.length === 0) {
      this.logger.error(
        { htmlSnippet: html.slice(0, 2000) },
        'items_seen=0: no detail-page links found — inspect htmlSnippet and update selector',
      );
      return [];
    }

    return entries
      .filter(
        (e): e is DetailEntry & { dateFromSlug: string } =>
          e.dateFromSlug !== null && isValidYear(e.dateFromSlug) && e.dateFromSlug >= MANDATE_START,
      )
      .sort((a, b) => b.dateFromSlug.localeCompare(a.dateFromSlug))
      .slice(0, this.firstRunLimit);
  }

  private async fetchDetailPage(detailUrl: string): Promise<DetailPage | null> {
    let html: string;
    try {
      const res = await this.fetchWithRetry(detailUrl, { headers: HTTP_HEADERS });
      if (!res.ok) {
        this.logger.warn(
          { detailUrl, status: res.status },
          'Detail page fetch failed — skipping meeting',
        );
        return null;
      }
      html = await res.text();
    } catch (err) {
      this.logger.warn(
        { detailUrl, err: String(err) },
        'Detail page fetch failed — skipping meeting',
      );
      return null;
    }

    const $ = cheerio.load(html);

    // Attempt 1: H1 text ("Vendimet e Mbledhjes së datës DD.MM.YYYY")
    const h1Candidate = parseMeetingDate($('h1').first().text());
    const dateFromH1 = h1Candidate && isValidYear(h1Candidate) ? h1Candidate : null;

    // Collect PDF URLs (needed for attempt 2 — must happen before date resolution)
    const pdfUrls: string[] = [];
    $('a[href$=".pdf"]').each((_i, el) => {
      const href = $(el).attr('href') ?? '';
      if (!href) return;
      const pdfUrl = href.startsWith('http') ? href : new URL(href, detailUrl).toString();
      try {
        if (new URL(pdfUrl).hostname === ALLOWED_HOST) {
          pdfUrls.push(pdfUrl);
        } else {
          this.logger.warn({ pdfUrl }, 'Off-domain PDF — skipping');
        }
      } catch {
        this.logger.warn({ href }, 'Invalid PDF href — skipping');
      }
    });

    // Attempt 2: date token in first PDF filename (reliable even when slug is corrupt)
    let dateFromPdf: string | null = null;
    for (const pdfUrl of pdfUrls) {
      const filename = new URL(pdfUrl).pathname.split('/').pop() ?? '';
      const m = filename.match(/(\d{2})[-.](\d{2})[-.](20\d{2})/);
      if (m) {
        const candidate = parseMeetingDate(`${m[1]}.${m[2]}.${m[3]}`);
        if (candidate && isValidYear(candidate)) {
          dateFromPdf = candidate;
          break;
        }
      }
    }

    // Attempt 3: URL slug
    const slugCandidate = parseMeetingDate(detailUrl);
    const dateFromSlug = slugCandidate && isValidYear(slugCandidate) ? slugCandidate : null;

    const date = dateFromH1 ?? dateFromPdf ?? dateFromSlug;
    if (!date) {
      this.logger.warn({ detailUrl }, 'no valid meeting date — skipping');
      return null;
    }

    if (pdfUrls.length === 0) {
      this.logger.error(
        { htmlSnippet: html.slice(0, 2000), detailUrl },
        'No PDFs on detail page — inspect htmlSnippet and update selector',
      );
    }

    this.logger.info({ date, pdfCount: pdfUrls.length, detailUrl }, 'Detail page fetched');
    return { date, pdfUrls, detailUrl };
  }

  private async processDetailPage(
    detail: DetailPage,
    sourceId: string,
    municipalityId: string,
  ): Promise<ProcessResult> {
    let seen = 0;
    let created = 0;
    for (const pdfUrl of detail.pdfUrls) {
      await this.delay(500 + Math.random() * 500);
      const result = await this.processPdf(pdfUrl, detail.date, sourceId, municipalityId);
      seen += result.seen;
      created += result.created;
    }
    return { seen, created };
  }

  private async processPdf(
    pdfUrl: string,
    meetingDate: string,
    sourceId: string,
    municipalityId: string,
  ): Promise<ProcessResult> {
    this.logger.debug({ pdfUrl }, 'Processing PDF');

    // Download
    let buffer: Buffer;
    try {
      const pdfRes = await this.fetchWithRetry(pdfUrl, {
        headers: { ...HTTP_HEADERS, Accept: 'application/pdf' },
      });
      if (!pdfRes.ok) {
        this.logger.warn({ url: pdfUrl, status: pdfRes.status }, 'PDF download failed — skipping');
        return { seen: 0, created: 0 };
      }
      buffer = Buffer.from(await pdfRes.arrayBuffer());
    } catch (err) {
      this.logger.warn({ pdfUrl, err: String(err) }, 'fetch failed — skipping document');
      return { seen: 0, created: 0 };
    }

    // SHA-256
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    // Storage (key = hash-derived, never remote filename)
    const { ext, mime } = deriveDocFormat(pdfUrl);
    if (ext === 'bin') {
      this.logger.warn({ url: pdfUrl }, 'unknown document format — storing as .bin');
    }
    const storageKey = `pogradec/vendime/${sha256}.${ext}`;
    await this.storage.upload(storageKey, buffer, mime);

    // Document dedup + version
    const doc = await this.upsertDocument(sha256, storageKey, buffer.length, mime);
    if (doc.isNew) {
      void stampDocument(doc.id, sha256, this.logger);
    }
    const docVersion = await this.upsertDocumentVersion(doc.id, pdfUrl);

    // Number: filename first, pdf-parse fallback
    const numFromFile = numberFromFilename(pdfUrl);
    let number: string;
    let titleFromPdf: string | null = null;

    if (numFromFile) {
      number = numFromFile;
      // Best-effort title enrichment from PDF text (non-fatal)
      const enriched = await extractTitleFromPdf(buffer);
      titleFromPdf = enriched.title;
    } else {
      const enriched = await extractTitleFromPdf(buffer);
      titleFromPdf = enriched.title;
      if (enriched.number) {
        number = enriched.number;
      } else {
        number = `PLACEHOLDER-${sha256.slice(0, 8)}`;
        this.logger.warn({ pdfUrl }, 'No decision number from filename or PDF — using placeholder');
      }
    }

    const titleOverride = number.startsWith('PLACEHOLDER-')
      ? `[PLACEHOLDER] Vendime Keshillit – ${meetingDate} (PDF kërkon rishikim manual)`
      : titleFromPdf;

    return this.insertVendim(
      { number, signedDate: null },
      { date: meetingDate, pdfUrl },
      sourceId,
      municipalityId,
      docVersion.id,
      titleOverride,
    );
  }

  private async upsertDocument(
    sha256: string,
    storageKey: string,
    byteSize: number,
    mime = 'application/pdf',
  ): Promise<{ id: string; isNew: boolean }> {
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
      .returning({ id: documents.id });

    if (inserted) return { id: inserted.id, isNew: true };

    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.sha256, sha256))
      .limit(1);

    if (!existing) throw new Error(`Document with sha256 ${sha256} not found after conflict`);
    return { id: existing.id, isNew: false };
  }

  private async upsertDocumentVersion(
    documentId: string,
    slotRef: string,
  ): Promise<{ id: string }> {
    const [latest] = await db
      .select()
      .from(document_versions)
      .where(eq(document_versions.slot_ref, slotRef))
      .orderBy(desc(document_versions.version_no))
      .limit(1);

    if (!latest) {
      const [v] = await db
        .insert(document_versions)
        .values({ document_id: documentId, slot_ref: slotRef, version_no: 1 })
        .returning({ id: document_versions.id });
      if (!v) throw new Error('document_versions insert returned nothing');
      return { id: v.id };
    }

    if (latest.document_id === documentId) {
      return { id: latest.id };
    }

    // Content changed at same URL — tamper signal
    this.logger.warn(
      { slotRef, oldDocId: latest.document_id, newDocId: documentId },
      'Content-change detected for slot_ref — inserting new version',
    );
    const [v] = await db
      .insert(document_versions)
      .values({ document_id: documentId, slot_ref: slotRef, version_no: latest.version_no + 1 })
      .returning({ id: document_versions.id });
    if (!v) throw new Error('document_versions insert returned nothing');
    return { id: v.id };
  }

  private async insertVendim(
    decision: Decision,
    meeting: Meeting,
    sourceId: string,
    municipalityId: string,
    documentVersionId: string,
    titleOverride: string | null,
  ): Promise<ProcessResult> {
    const yearSigned = decision.signedDate
      ? Number.parseInt(decision.signedDate.slice(0, 4), 10)
      : Number.parseInt(meeting.date.slice(0, 4), 10);

    const dedupKey = `vendime:pogradec:${decision.number}:${yearSigned}`;
    const title = titleOverride ?? `VKB nr ${decision.number} datë ${meeting.date}`;

    const [inserted] = await db
      .insert(vendime)
      .values({
        municipality_id: municipalityId,
        source_id: sourceId,
        source_origin: SOURCE_ORIGIN,
        source_page_url: LISTING_URL,
        source_url: meeting.pdfUrl,
        dedup_key: dedupKey,
        number_normalized: decision.number,
        year_signed: yearSigned,
        title,
        published_date: meeting.date,
        review_status: 'pending',
        collected_at: new Date(),
      })
      .onConflictDoNothing({ target: vendime.dedup_key })
      .returning({ id: vendime.id });

    if (!inserted) {
      this.logger.warn({ dedupKey, pdfUrl: meeting.pdfUrl }, 'dedup conflict — skipped');
      return { seen: 1, created: 0 };
    }

    await db.insert(vendim_documents).values({
      vendim_id: inserted.id,
      document_version_id: documentVersionId,
    });

    return { seen: 1, created: 1 };
  }

  private async fetchWithRetry(
    url: string,
    opts: Parameters<typeof fetch>[1] = {},
    maxRetries = 2,
  ) {
    const backoffs = [2_000, 4_000];
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await this.delay(backoffs[attempt - 1] ?? 4_000);
        this.logger.warn({ url, attempt }, 'retrying after network error');
      }
      try {
        return await fetch(url, { ...opts, signal: AbortSignal.timeout(30_000) });
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
