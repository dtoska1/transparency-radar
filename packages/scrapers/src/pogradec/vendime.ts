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
import { LocalDiskAdapter } from '@tra/shared';
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

// ── OCR fallback ──────────────────────────────────────────────────────────────

async function ocrBuffer(buffer: Buffer): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('sqi');
  try {
    const { data } = await worker.recognize(buffer);
    return data.text;
  } finally {
    await worker.terminate();
  }
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

interface Meeting {
  title: string;
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
    this.firstRunLimit = opts.firstRunLimit ?? 3;
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
      const meetings = await this.fetchListing();
      const kept = meetings.filter((m) => m.date >= MANDATE_START).slice(0, this.firstRunLimit);

      this.logger.info({ total: meetings.length, kept: kept.length }, 'Listing fetched');

      for (const meeting of kept) {
        await this.delay(1000 + Math.random() * 500);
        const result = await this.processMeeting(meeting, sourceId, municipalityId);
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

  private async fetchListing(): Promise<Meeting[]> {
    const res = await fetch(LISTING_URL, { headers: HTTP_HEADERS });
    if (!res.ok) throw new Error(`Listing fetch failed: ${res.status}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const meetings: Meeting[] = [];

    // Try multiple selector strategies since CMS is unknown
    // Strategy 1: common list/article patterns
    const candidates = $('article, .entry, .post, li.item, .publication-item, .list-item');

    if (candidates.length > 0) {
      candidates.each((_i, el) => {
        const titleEl = $(el).find('a, h2, h3, .title').first();
        const title = titleEl.text().trim();
        const pdfLink = $(el)
          .find(
            'a[href$=".pdf"], a:contains("Shkarko"), a:contains("shkarko"), a:contains("dokumentin")',
          )
          .first();
        const href = pdfLink.attr('href') ?? titleEl.attr('href') ?? '';

        if (!href) return;

        const dateRaw = title.match(/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,5}/)?.[0] ?? '';
        const date = parseMeetingDate(dateRaw);
        if (!date) {
          this.logger.warn({ title, dateRaw }, 'Could not parse meeting date — skipping');
          return;
        }

        const pdfUrl = href.startsWith('http') ? href : new URL(href, LISTING_URL).toString();
        meetings.push({ title, date, pdfUrl });
      });
    }

    // Strategy 2: if nothing found, walk all PDF links on the page
    if (meetings.length === 0) {
      this.logger.warn('No meetings from strategy 1 — falling back to all PDF links');
      $('a[href$=".pdf"]').each((_i, el) => {
        const href = $(el).attr('href') ?? '';
        const text = $(el).text().trim() || $(el).closest('*').text().trim();
        const dateRaw = text.match(/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,5}/)?.[0] ?? '';
        const date = parseMeetingDate(dateRaw);
        if (!date) {
          this.logger.warn(
            { text, href },
            'Fallback: could not parse date for PDF link — skipping',
          );
          return;
        }
        const pdfUrl = href.startsWith('http') ? href : new URL(href, LISTING_URL).toString();
        meetings.push({ title: text, date, pdfUrl });
      });
    }

    if (meetings.length === 0) {
      this.logger.error(
        { htmlSnippet: html.slice(0, 2000) },
        'items_seen=0: selectors matched nothing — inspect htmlSnippet and update selectors',
      );
    }

    // Deduplicate by pdfUrl and sort newest first
    const seen = new Set<string>();
    const deduped = meetings.filter((m) => {
      if (seen.has(m.pdfUrl)) return false;
      seen.add(m.pdfUrl);
      return true;
    });
    deduped.sort((a, b) => b.date.localeCompare(a.date));
    return deduped;
  }

  private async processMeeting(
    meeting: Meeting,
    sourceId: string,
    municipalityId: string,
  ): Promise<ProcessResult> {
    this.logger.info({ date: meeting.date, url: meeting.pdfUrl }, 'Processing meeting');

    // Host validation
    let pdfUrlParsed: URL;
    try {
      pdfUrlParsed = new URL(meeting.pdfUrl);
    } catch {
      this.logger.warn({ url: meeting.pdfUrl }, 'Invalid PDF URL — skipping');
      return { seen: 0, created: 0 };
    }
    if (pdfUrlParsed.hostname !== ALLOWED_HOST) {
      this.logger.warn({ host: pdfUrlParsed.hostname }, 'Off-domain PDF URL — skipping');
      return { seen: 0, created: 0 };
    }

    // Download
    const pdfRes = await fetch(meeting.pdfUrl, {
      headers: { ...HTTP_HEADERS, Accept: 'application/pdf' },
    });
    if (!pdfRes.ok) {
      this.logger.warn(
        { url: meeting.pdfUrl, status: pdfRes.status },
        'PDF download failed — skipping',
      );
      return { seen: 0, created: 0 };
    }
    const buffer = Buffer.from(await pdfRes.arrayBuffer());

    // SHA-256
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    // Storage (key = hash-derived, never remote filename)
    const storageKey = `pogradec/vendime/${sha256}.pdf`;
    await this.storage.upload(storageKey, buffer, 'application/pdf');

    // Document dedup
    const isNewDoc = await this.upsertDocument(sha256, storageKey, buffer.length);
    if (isNewDoc.isNew) {
      void stampDocument(isNewDoc.id, sha256, this.logger);
    }

    // Document version
    const docVersion = await this.upsertDocumentVersion(isNewDoc.id, meeting.pdfUrl);

    // Extract decisions
    const decisions = await this.extractDecisions(buffer);

    if (decisions.length === 0) {
      // Placeholder
      const result = await this.insertVendim(
        {
          number: `PLACEHOLDER-${sha256.slice(0, 8)}`,
          signedDate: null,
        },
        meeting,
        sourceId,
        municipalityId,
        docVersion.id,
        `[PLACEHOLDER] Vendime Keshillit – ${meeting.date} (PDF kërkon rishikim manual)`,
      );
      return result;
    }

    let seen = 0;
    let created = 0;
    for (const decision of decisions) {
      const result = await this.insertVendim(
        decision,
        meeting,
        sourceId,
        municipalityId,
        docVersion.id,
        null,
      );
      seen += result.seen;
      created += result.created;
    }
    return { seen, created };
  }

  private async upsertDocument(
    sha256: string,
    storageKey: string,
    byteSize: number,
  ): Promise<{ id: string; isNew: boolean }> {
    const [inserted] = await db
      .insert(documents)
      .values({
        sha256,
        storage_uri: storageKey,
        mime_type: 'application/pdf',
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

  private async extractDecisions(buffer: Buffer): Promise<Decision[]> {
    let text = '';

    try {
      const data = await pdfParse(buffer);
      text = data.text;
    } catch (err) {
      this.logger.warn({ err }, 'pdf-parse failed');
    }

    if (text.trim().length < 100) {
      this.logger.info('Low text from pdf-parse — trying OCR');
      try {
        text = await ocrBuffer(buffer);
      } catch (err) {
        this.logger.warn({ err }, 'tesseract OCR failed');
      }
    }

    if (text.trim().length < 100) {
      this.logger.warn('Insufficient text after OCR — will use placeholder row');
      return [];
    }

    const decisions: Decision[] = [];
    const regex =
      /(?:VKB|Vendim)\s+nr\.?\s+(\d+)(?:\s+dat[ëe]\s+(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,5}))?/gi;

    for (const match of text.matchAll(regex)) {
      const number = match[1]?.trim();
      if (!number) continue;
      const signedDate = match[2] ? parseMeetingDate(match[2]) : null;
      decisions.push({ number, signedDate });
    }

    return decisions;
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
    const title = titleOverride ?? `Vendim nr. ${decision.number} (${meeting.date})`;

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
      this.logger.debug({ dedupKey }, 'Vendim already exists — skipping');
      return { seen: 1, created: 0 };
    }

    await db.insert(vendim_documents).values({
      vendim_id: inserted.id,
      document_version_id: documentVersionId,
    });

    return { seen: 1, created: 1 };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
