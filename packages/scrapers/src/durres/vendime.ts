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

const LISTING_URL = 'https://durres.gov.al/vendime-te-keshillit-bashkiak-2/';
const SOURCE_ORIGIN = 'durres.gov.al';
const ALLOWED_HOST = 'durres.gov.al';
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

interface DecisionEntry {
  pdfUrl: string;
  number: string;
  date: string; // ISO YYYY-MM-DD
  title: string;
}

interface ProcessResult {
  seen: number;
  created: number;
}

export class DurresVendimeScraper extends BaseScraper {
  private readonly storage: LocalDiskAdapter;
  private readonly firstRunLimit: number; // max decisions, not pages

  constructor(opts: { firstRunLimit?: number } = {}) {
    super('durres', 'vendime');
    this.storage = new LocalDiskAdapter(process.env.STORAGE_LOCAL_PATH ?? './uploads');
    this.firstRunLimit = opts.firstRunLimit ?? 10;
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
      const decisions = await this.fetchDecisions();
      const limited = decisions.slice(0, this.firstRunLimit);
      this.logger.info({ total: decisions.length, processing: limited.length }, 'Decisions found');

      for (const entry of limited) {
        await this.delay(1000 + Math.random() * 500);

        let docVersionId: string | null = null;

        const pdfRes = await fetch(entry.pdfUrl, {
          headers: { ...HTTP_HEADERS, Accept: 'application/pdf' },
        });
        if (!pdfRes.ok) {
          this.logger.warn(
            { url: entry.pdfUrl, status: pdfRes.status },
            'PDF download failed — inserting row without document',
          );
        } else {
          const buffer = Buffer.from(await pdfRes.arrayBuffer());
          const sha256 = createHash('sha256').update(buffer).digest('hex');
          const { ext, mime } = deriveDocFormat(entry.pdfUrl);
          if (ext === 'bin') {
            this.logger.warn({ url: entry.pdfUrl }, 'unknown document format — storing as .bin');
          }
          const storageKey = `durres/vendime/${sha256}.${ext}`;
          await this.storage.upload(storageKey, buffer, mime);
          const doc = await this.upsertDocument(sha256, storageKey, buffer.length, mime);
          if (doc.isNew) void stampDocument(doc.id, sha256, this.logger);
          const docVersion = await this.upsertDocumentVersion(doc.id, entry.pdfUrl);
          docVersionId = docVersion.id;
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
      .where(and(eq(municipalities.slug, 'durres'), eq(sources.vertical, 'vendime')))
      .limit(1);

    if (!found) throw new Error('Source not found for durres/vendime — run db:seed:sources first');
    return { sourceId: found.sourceId, municipalityId: found.municipalityId };
  }

  private async fetchDecisions(): Promise<DecisionEntry[]> {
    const res = await fetch(LISTING_URL, { headers: HTTP_HEADERS });
    if (!res.ok) throw new Error(`Listing fetch failed: ${res.status}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const entries: DecisionEntry[] = [];

    $('a[href*="/wp-content/uploads/"][href$=".pdf"]').each((_i, el) => {
      const $a = $(el);
      const href = $a.attr('href') ?? '';
      if (!href) return;

      const pdfUrl = href.startsWith('http') ? href : new URL(href, LISTING_URL).toString();

      try {
        if (new URL(pdfUrl).hostname !== ALLOWED_HOST) {
          this.logger.warn({ pdfUrl }, 'Off-domain PDF — skipping');
          return;
        }
      } catch {
        this.logger.warn({ href }, 'Invalid PDF href — skipping');
        return;
      }

      // Dedup: each decision is rendered twice on the page
      if (seen.has(pdfUrl)) return;
      seen.add(pdfUrl);

      // Number: link text first, filename fallback
      const linkText = $a.text().trim();
      const filename = new URL(pdfUrl).pathname.split('/').pop() ?? '';
      const number =
        linkText.match(/nr\.?\s*-?\s*(\d+)/i)?.[1] ??
        filename.match(/nr[\.\-]?(\d+)/i)?.[1] ??
        null;
      if (!number) return; // not a decision PDF (emërtimi index, transparency doc, etc.)

      // Date: link text first, filename fallback
      const dateFromText = parseMeetingDate(linkText);
      const dateFromFile = parseMeetingDate(filename.replace(/-/g, '.'));
      const date =
        dateFromText && isValidYear(dateFromText)
          ? dateFromText
          : dateFromFile && isValidYear(dateFromFile)
            ? dateFromFile
            : null;
      if (!date || date < MANDATE_START) return;

      // Title: 2026 table row → Publikimi cell (index 2); older years → fallback
      const $tr = $a.closest('tr');
      const title =
        ($tr.length > 0 ? $tr.find('td').eq(2).text().trim() : '') ||
        `VKB nr ${number} datë ${date}`;

      entries.push({ pdfUrl, number, date, title });
    });

    if (entries.length === 0) {
      this.logger.error(
        { htmlSnippet: html.slice(0, 2000) },
        'items_seen=0: no decision PDFs found — inspect htmlSnippet and update selector',
      );
    }

    return entries;
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
    entry: DecisionEntry,
    docVersionId: string | null,
    sourceId: string,
    municipalityId: string,
  ): Promise<ProcessResult> {
    const yearSigned = Number.parseInt(entry.date.slice(0, 4), 10);
    const dedupKey = `vendime:durres:${entry.number}:${yearSigned}`;

    const [inserted] = await db
      .insert(vendime)
      .values({
        municipality_id: municipalityId,
        source_id: sourceId,
        source_origin: SOURCE_ORIGIN,
        source_page_url: LISTING_URL,
        source_url: LISTING_URL, // no per-decision human page; listing is canonical
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
