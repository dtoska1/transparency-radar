import { db } from '@tra/db';
import { konsultime, municipalities, scrape_runs, sources } from '@tra/db';
import { toSlug } from '@tra/shared';
import * as cheerio from 'cheerio';
import { and, eq } from 'drizzle-orm';
import { fetch } from 'undici';
import { BaseScraper } from '../base-scraper.js';

const LISTING_URL =
  'https://vlora.gov.al/regjistri-i-projekt-akteve-per-konsultim-publik-te-keshillit-bashkiak/';
const SOURCE_ORIGIN = 'vlora.gov.al';
const YEAR_FLOOR = 2023;
const YEAR_FLOOR_DATE = `${YEAR_FLOOR}-01-01`;
const URL_RE = /https?:\/\/[^\s<>"')]+/i;

const HTTP_HEADERS = {
  'User-Agent': 'TransparencyRadar/0.1 (+contact@transparency-radar.al)',
  'Accept-Language': 'sq-AL,sq;q=0.9,en;q=0.8',
};

// ── Pure helpers (exported for testing) ──────────────────────────────────────

export interface VloreKonsultimeItem {
  title: string;
  sourceUrl: string;
  sourceOrigin: typeof SOURCE_ORIGIN;
  sourcePageUrl: typeof LISTING_URL;
  publishedDate: string; // ISO YYYY-MM-DD
  kind: 'draft_act';
  isUnofficialProxy: false;
}

export function parseVloreListingDate(raw: string): string | null {
  const match = raw.trim().match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  if (!match) return null;

  const [, dayRaw, monthRaw, year] = match as [string, string, string, string];
  const day = Number.parseInt(dayRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  return `${year}-${monthRaw.padStart(2, '0')}-${dayRaw.padStart(2, '0')}`;
}

export function extractVloreKonsultimeUrl(anchorHref: string | null, text: string): string | null {
  const rawUrl = normalizeText(anchorHref ?? '') || text.match(URL_RE)?.[0] || '';
  if (!rawUrl) return null;

  try {
    return new URL(stripTrailingPunctuation(rawUrl), LISTING_URL).toString();
  } catch {
    return null;
  }
}

export function parseVloreKonsultimeHtml(html: string): VloreKonsultimeItem[] {
  const $ = cheerio.load(html);
  const table = $('table#tablepress-7, table.tablepress-7, table.tablepress-id-7').first();
  if (table.length === 0) return [];

  const items: VloreKonsultimeItem[] = [];
  const seen = new Set<string>();
  const rows = table.find('tbody tr').length > 0 ? table.find('tbody tr') : table.find('tr');

  rows.each((_i, row) => {
    const cells = $(row).children('td');
    if (cells.length < 2) return;

    const sourceCell = cells.eq(0);
    const sourceUrl = extractVloreKonsultimeUrl(
      sourceCell.find('a[href]').first().attr('href') ?? null,
      sourceCell.text(),
    );
    if (!sourceUrl || seen.has(sourceUrl)) return;

    const publishedDate = parseVloreListingDate(cells.eq(1).text());
    if (!publishedDate || publishedDate < YEAR_FLOOR_DATE) return;

    const title = deriveTitle(sourceCell.text(), sourceUrl);
    if (!title) return;

    seen.add(sourceUrl);
    items.push({
      title,
      sourceUrl,
      sourceOrigin: SOURCE_ORIGIN,
      sourcePageUrl: LISTING_URL,
      publishedDate,
      kind: 'draft_act',
      isUnofficialProxy: false,
    });
  });

  return items;
}

// ── Scraper ───────────────────────────────────────────────────────────────────

interface ProcessResult {
  seen: number;
  created: number;
}

export class VloreKonsultimeScraper extends BaseScraper {
  constructor() {
    super('vlore', 'konsultime');
  }

  async run(): Promise<void> {
    const { sourceId, municipalityId } = await this.lookupSource();

    const [runRow] = await db
      .insert(scrape_runs)
      .values({
        source_id: sourceId,
        municipality_id: municipalityId,
        vertical: 'konsultime',
        started_at: new Date(),
        status: 'running',
      })
      .returning({ id: scrape_runs.id });

    if (!runRow) throw new Error('Failed to insert scrape_run row');
    const runId = runRow.id;
    let totalSeen = 0;
    let totalNew = 0;

    try {
      const cards = await this.fetchListingCards();
      this.logger.info({ total: cards.length }, 'Cards fetched from listing');

      for (const card of cards) {
        const result = await this.insertKonsultim(card, sourceId, municipalityId);
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
      .where(and(eq(municipalities.slug, 'vlore'), eq(sources.vertical, 'konsultime')))
      .limit(1);

    if (!found)
      throw new Error(
        'Source not found for vlore/konsultime — run pnpm --filter @tra/db db:seed:sources first',
      );
    return { sourceId: found.sourceId, municipalityId: found.municipalityId };
  }

  private async fetchListingCards(): Promise<VloreKonsultimeItem[]> {
    const res = await fetch(LISTING_URL, {
      headers: HTTP_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Listing fetch failed: ${res.status} ${LISTING_URL}`);
    const html = await res.text();

    const cards = parseVloreKonsultimeHtml(html);
    if (cards.length === 0) {
      this.logger.error(
        { htmlSnippet: html.slice(0, 2000) },
        'No rows found — inspect htmlSnippet and verify tablepress-7 selector',
      );
    }

    return cards;
  }

  private async insertKonsultim(
    card: VloreKonsultimeItem,
    sourceId: string,
    municipalityId: string,
  ): Promise<ProcessResult> {
    const titleSlug = toSlug(card.title);
    const dedupKey = `konsultime:vlore:${titleSlug}:${card.publishedDate}`;

    const [inserted] = await db
      .insert(konsultime)
      .values({
        municipality_id: municipalityId,
        source_id: sourceId,
        source_origin: card.sourceOrigin,
        source_page_url: card.sourcePageUrl,
        source_url: card.sourceUrl,
        dedup_key: dedupKey,
        title: card.title,
        title_slug: titleSlug,
        summary: null,
        published_date: card.publishedDate,
        kind: card.kind,
        is_unofficial_proxy: card.isUnofficialProxy,
        collected_at: new Date(),
      })
      .onConflictDoNothing({ target: konsultime.dedup_key })
      .returning({ id: konsultime.id });

    if (!inserted) {
      this.logger.debug({ dedupKey }, 'dedup conflict — skipped');
      return { seen: 1, created: 0 };
    }

    this.logger.info({ dedupKey, kind: card.kind }, 'Inserted konsultim');
    return { seen: 1, created: 1 };
  }
}

function deriveTitle(cellText: string, sourceUrl: string): string | null {
  const withoutUrls = normalizeText(cellText.replace(URL_RE, ' '));
  if (isMeaningfulTitle(withoutUrls)) return withoutUrls;

  try {
    const url = new URL(sourceUrl);
    const lastSegment = url.pathname.split('/').filter(Boolean).pop();
    if (!lastSegment) return null;

    const decoded = decodeURIComponent(lastSegment)
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[-_]+/g, ' ');
    const title = normalizeText(decoded);
    return isMeaningfulTitle(title) ? title : null;
  } catch {
    return null;
  }
}

function isMeaningfulTitle(value: string): boolean {
  const normalized = normalizeText(value);
  if (normalized.length < 4) return false;

  const folded = normalized.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (folded.startsWith('http')) return false;
  return !new Set(['link', 'shkarko', 'download', 'ketu', 'kliko ketu', 'pdf']).has(folded);
}

function stripTrailingPunctuation(value: string): string {
  return value.trim().replace(/[),.;]+$/g, '');
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
