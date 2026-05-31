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
import { fetch } from 'undici';
import { BaseScraper } from '../base-scraper.js';

const ARCHIVE_URL = 'https://bashkiashkoder.gov.al/vendimet-e-keshillit-bashkiak-2/';
const SOURCE_ORIGIN = 'bashkiashkoder.gov.al';
const ALLOWED_HOST = 'bashkiashkoder.gov.al';
const MANDATE_START = '2023-01-01';
const MAX_PAGES = 45;

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

function isValidYear(isoDate: string): boolean {
  const year = Number.parseInt(isoDate.slice(0, 4), 10);
  return year >= 2018 && year <= 2027;
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

// ── Scraper ───────────────────────────────────────────────────────────────────

interface ListingEntry {
  postUrl: string;
  number: string;
  date: string; // ISO YYYY-MM-DD
  title: string; // listing summary; fallback: `VKB nr ${number} datë ${date}`
}

interface ProcessResult {
  seen: number;
  created: number;
}

export class ShkoderVendimeScraper extends BaseScraper {
  private readonly storage: LocalDiskAdapter;
  private readonly firstRunLimit: number; // pages, not entries

  constructor(opts: { firstRunLimit?: number } = {}) {
    super('shkoder', 'vendime');
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
      const allEntries: ListingEntry[] = [];

      for (let page = 1; page <= Math.min(this.firstRunLimit, MAX_PAGES); page++) {
        const pageEntries = await this.fetchPage(page);
        if (pageEntries.length === 0) {
          this.logger.info({ page }, 'Empty page — stopping pagination');
          break;
        }
        allEntries.push(...pageEntries);
        if (pageEntries.every((e) => e.date < MANDATE_START)) {
          this.logger.info({ page }, 'All entries pre-mandate — stopping pagination');
          break;
        }
        if (page < Math.min(this.firstRunLimit, MAX_PAGES)) {
          await this.delay(2000 + Math.random() * 1000);
        }
      }

      this.logger.info({ kept: allEntries.length }, 'Listing pages fetched');

      for (const entry of allEntries) {
        await this.delay(1000 + Math.random() * 500);

        const pdfUrl = await this.fetchPdfUrl(entry.postUrl);

        let docVersionId: string | null = null;
        if (pdfUrl) {
          try {
            const pdfRes = await this.fetchWithRetry(pdfUrl, {
              headers: { ...HTTP_HEADERS, Accept: 'application/pdf' },
            });
            if (!pdfRes.ok) {
              this.logger.warn(
                { url: pdfUrl, status: pdfRes.status },
                'PDF download failed — inserting row without document',
              );
            } else {
              const buffer = Buffer.from(await pdfRes.arrayBuffer());
              const sha256 = createHash('sha256').update(buffer).digest('hex');
              const { ext, mime } = deriveDocFormat(pdfUrl);
              if (ext === 'bin') {
                this.logger.warn({ url: pdfUrl }, 'unknown document format — storing as .bin');
              }
              const storageKey = `shkoder/vendime/${sha256}.${ext}`;
              await this.storage.upload(storageKey, buffer, mime);
              const doc = await this.upsertDocument(sha256, storageKey, buffer.length, mime);
              if (doc.isNew) void stampDocument(doc.id, sha256, this.logger);
              const docVersion = await this.upsertDocumentVersion(doc.id, pdfUrl);
              docVersionId = docVersion.id;
            }
          } catch (err) {
            this.logger.warn(
              { postUrl: entry.postUrl, err: String(err) },
              'fetch failed — skipping document',
            );
          }
        }

        const result = await this.insertVendim(entry, docVersionId, sourceId, municipalityId);
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
      .where(and(eq(municipalities.slug, 'shkoder'), eq(sources.vertical, 'vendime')))
      .limit(1);

    if (!found) throw new Error('Source not found for shkoder/vendime — run db:seed:sources first');
    return { sourceId: found.sourceId, municipalityId: found.municipalityId };
  }

  private async fetchPage(pageNum: number): Promise<ListingEntry[]> {
    const pageUrl = pageNum === 1 ? ARCHIVE_URL : `${ARCHIVE_URL}page/${pageNum}/`;

    const res = await fetch(pageUrl, { headers: HTTP_HEADERS });
    if (!res.ok) throw new Error(`Archive page fetch failed: ${res.status} ${pageUrl}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const entries: ListingEntry[] = [];
    const seen = new Set<string>();

    $('a[href*="/vendime_te_keshillit/"]').each((_i, el) => {
      const $a = $(el);
      const headingText = $a.text().trim();
      const href = $a.attr('href') ?? '';
      if (!href) return;

      const numMatch = headingText.match(/Nr\.?:?\s*(\d+)/i);
      const dateMatch = headingText.match(/Dt\.?:?\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/i);
      if (!numMatch || !dateMatch) return;

      const number = numMatch[1];
      const rawDate = `${dateMatch[1]}.${dateMatch[2]}.${dateMatch[3]}`;
      const date = parseMeetingDate(rawDate);
      if (!date || !isValidYear(date) || date < MANDATE_START) return;

      const postUrl = href.startsWith('http') ? href : new URL(href, ARCHIVE_URL).toString();
      if (seen.has(postUrl)) return;
      seen.add(postUrl);

      // Title: nearest summary paragraph; fallback to constructed string
      const $article = $a.closest('article, .elementor-post, .post, li');
      const summaryEl =
        $article.find('.entry-summary, .elementor-post__excerpt').text().trim() ||
        $article.find('p').not(':has(a[href*="/vendime_te_keshillit/"])').first().text().trim();
      const title = summaryEl || `VKB nr ${number} datë ${date}`;

      entries.push({ postUrl, number, date, title });
    });

    if (entries.length === 0 && pageNum === 1) {
      this.logger.error(
        { htmlSnippet: html.slice(0, 2000) },
        'items_seen=0: no decision links found — inspect htmlSnippet and update selector',
      );
    }

    return entries;
  }

  private async fetchPdfUrl(postUrl: string): Promise<string | null> {
    try {
      const res = await this.fetchWithRetry(postUrl, { headers: HTTP_HEADERS });
      if (!res.ok) {
        this.logger.warn({ postUrl, status: res.status }, 'Post page fetch failed');
        return null;
      }
      const html = await res.text();
      const $ = cheerio.load(html);

      let pdfUrl: string | null = null;
      $('a[href*="/wp-content/uploads/"][href$=".pdf"]').each((_i, el) => {
        if (pdfUrl) return; // take only the first
        const href = $(el).attr('href') ?? '';
        if (!href) return;
        const candidate = href.startsWith('http') ? href : new URL(href, postUrl).toString();
        try {
          if (new URL(candidate).hostname === ALLOWED_HOST) {
            pdfUrl = candidate;
          } else {
            this.logger.warn({ candidate }, 'Off-domain PDF — skipping');
          }
        } catch {
          this.logger.warn({ href }, 'Invalid PDF href — skipping');
        }
      });

      if (!pdfUrl) {
        this.logger.warn({ postUrl }, 'No PDF found on post page — inserting row without document');
      }
      return pdfUrl;
    } catch (err) {
      this.logger.warn({ postUrl, err: String(err) }, 'Post page fetch failed — skipping document');
      return null;
    }
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
    entry: ListingEntry,
    docVersionId: string | null,
    sourceId: string,
    municipalityId: string,
  ): Promise<ProcessResult> {
    const yearSigned = Number.parseInt(entry.date.slice(0, 4), 10);
    const dedupKey = `vendime:shkoder:${entry.number}:${yearSigned}`;

    const [inserted] = await db
      .insert(vendime)
      .values({
        municipality_id: municipalityId,
        source_id: sourceId,
        source_origin: SOURCE_ORIGIN,
        source_page_url: ARCHIVE_URL,
        source_url: entry.postUrl, // canonical human page, not PDF URL
        dedup_key: dedupKey,
        number_normalized: entry.number,
        year_signed: yearSigned,
        title: entry.title,
        published_date: entry.date,
        review_status: 'pending',
        collected_at: new Date(),
      })
      .onConflictDoNothing({ target: vendime.dedup_key })
      .returning({ id: vendime.id });

    if (!inserted) {
      this.logger.warn({ dedupKey }, 'dedup conflict — skipped');
      return { seen: 1, created: 0 };
    }

    if (docVersionId) {
      await db.insert(vendim_documents).values({
        vendim_id: inserted.id,
        document_version_id: docVersionId,
      });
    }

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
