import { db } from '@tra/db';
import { konsultime, municipalities, scrape_runs, sources } from '@tra/db';
import { toSlug } from '@tra/shared';
import * as cheerio from 'cheerio';
import { and, eq } from 'drizzle-orm';
import { fetch } from 'undici';
import { BaseScraper } from '../base-scraper.js';

const LISTING_URL = 'https://bashkiashkoder.gov.al/keshillim-me-publikun/';
const SOURCE_ORIGIN = 'bashkiashkoder.gov.al';
const YEAR_FLOOR = 2023;
const YEAR_FLOOR_DATE = `${YEAR_FLOOR}-01-01`;
const MAX_PAGES = 50;

const HTTP_HEADERS = {
  'User-Agent': 'TransparencyRadar/0.1 (+contact@transparency-radar.al)',
  'Accept-Language': 'sq-AL,sq;q=0.9,en;q=0.8',
};

const MONTHS = new Map([
  ['janar', '01'],
  ['shkurt', '02'],
  ['mars', '03'],
  ['prill', '04'],
  ['maj', '05'],
  ['qershor', '06'],
  ['korrik', '07'],
  ['gusht', '08'],
  ['shtator', '09'],
  ['tetor', '10'],
  ['nentor', '11'],
  ['dhjetor', '12'],
]);

// ── Pure helpers (exported for testing) ──────────────────────────────────────

export type ShkoderKonsultimeKind = 'hearing' | 'draft_act' | 'consultation_notice';

export interface ShkoderKonsultimeItem {
  title: string;
  sourceUrl: string;
  excerpt: string;
  publishedDate: string; // ISO YYYY-MM-DD
}

export function parseShkoderListingDate(raw: string): string | null {
  const match = normalizeText(raw).match(/^(\d{1,2})\s+([^,]+),\s*(\d{4})$/);
  if (!match) return null;

  const [, dayRaw, monthRaw, year] = match as [string, string, string, string];
  const day = Number.parseInt(dayRaw, 10);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  const month = MONTHS.get(foldText(monthRaw));
  if (!month) return null;

  return `${year}-${month}-${dayRaw.padStart(2, '0')}`;
}

export function classifyKind(title: string, excerpt: string): ShkoderKonsultimeKind {
  const text = foldText(`${title} ${excerpt}`);
  if (text.includes('degjes')) return 'hearing';
  return 'consultation_notice';
}

export function getShkoderKonsultimeNextPageUrl(
  html: string,
  currentUrl = LISTING_URL,
): string | null {
  const $ = cheerio.load(html);
  const href = $('div.pagination a.next.page-numbers').first().attr('href') ?? '';
  if (!href) return null;

  try {
    return new URL(href, currentUrl).toString();
  } catch {
    return null;
  }
}

export function parseShkoderKonsultimeHtml(html: string): ShkoderKonsultimeItem[] {
  const $ = cheerio.load(html);
  const items: ShkoderKonsultimeItem[] = [];
  const seen = new Set<string>();

  $('div.article-paginated').each((_i, el) => {
    const $article = $(el);
    const $link = $article.find('h4 a').first();
    const title = normalizeText($link.text());
    const href = $link.attr('href') ?? '';
    if (!title || !href) return;

    let sourceUrl: string;
    try {
      sourceUrl = new URL(href, LISTING_URL).toString();
    } catch {
      return;
    }

    if (seen.has(sourceUrl)) return;
    seen.add(sourceUrl);

    const excerpt = normalizeText($article.find('div.post-excerpt').first().text());
    const publishedDate = parseShkoderListingDate($article.find('div.post-date').first().text());
    if (!publishedDate || publishedDate < YEAR_FLOOR_DATE) return;

    items.push({ title, sourceUrl, excerpt, publishedDate });
  });

  return items;
}

function parseAllListingDates(html: string): string[] {
  const $ = cheerio.load(html);
  const dates: string[] = [];

  $('div.article-paginated div.post-date').each((_i, el) => {
    const date = parseShkoderListingDate($(el).text());
    if (date) dates.push(date);
  });

  return dates;
}

// ── Scraper ───────────────────────────────────────────────────────────────────

interface ProcessResult {
  seen: number;
  created: number;
}

export class ShkoderKonsultimeScraper extends BaseScraper {
  constructor() {
    super('shkoder', 'konsultime');
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
      .where(and(eq(municipalities.slug, 'shkoder'), eq(sources.vertical, 'konsultime')))
      .limit(1);

    if (!found)
      throw new Error(
        'Source not found for shkoder/konsultime — run pnpm --filter @tra/db db:seed:sources first',
      );
    return { sourceId: found.sourceId, municipalityId: found.municipalityId };
  }

  private async fetchListingCards(): Promise<ShkoderKonsultimeItem[]> {
    const items: ShkoderKonsultimeItem[] = [];
    const seenSourceUrls = new Set<string>();
    const visitedPageUrls = new Set<string>();
    let pageUrl: string | null = LISTING_URL;

    for (let page = 1; pageUrl && page <= MAX_PAGES; page++) {
      if (visitedPageUrls.has(pageUrl)) {
        this.logger.info({ pageUrl }, 'Pagination loop detected — stopping');
        break;
      }
      visitedPageUrls.add(pageUrl);

      const res = await fetch(pageUrl, {
        headers: HTTP_HEADERS,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Listing fetch failed: ${res.status} ${pageUrl}`);
      const html = await res.text();

      const pageItems = parseShkoderKonsultimeHtml(html);
      let newOnPage = 0;
      for (const item of pageItems) {
        if (seenSourceUrls.has(item.sourceUrl)) continue;
        seenSourceUrls.add(item.sourceUrl);
        items.push(item);
        newOnPage += 1;
      }

      if (page === 1 && pageItems.length === 0) {
        this.logger.error(
          { htmlSnippet: html.slice(0, 2000) },
          'No cards found — inspect htmlSnippet and verify selector',
        );
      }

      const listingDates = parseAllListingDates(html);
      if (listingDates.length > 0 && listingDates.every((date) => date < YEAR_FLOOR_DATE)) {
        this.logger.info({ page, pageUrl }, 'All page items are older than year floor — stopping');
        break;
      }

      const nextPageUrl = getShkoderKonsultimeNextPageUrl(html, pageUrl);
      if (!nextPageUrl) break;
      if (visitedPageUrls.has(nextPageUrl)) break;
      if (pageItems.length > 0 && newOnPage === 0) {
        this.logger.info({ page, pageUrl }, 'Page repeated known source URLs — stopping');
        break;
      }

      pageUrl = nextPageUrl;
      await this.delay(1000 + Math.random() * 500);
    }

    return items;
  }

  private async insertKonsultim(
    card: ShkoderKonsultimeItem,
    sourceId: string,
    municipalityId: string,
  ): Promise<ProcessResult> {
    const titleSlug = toSlug(card.title);
    const dedupKey = `konsultime:shkoder:${titleSlug}:${card.publishedDate}`;
    const kind = classifyKind(card.title, card.excerpt);

    const [inserted] = await db
      .insert(konsultime)
      .values({
        municipality_id: municipalityId,
        source_id: sourceId,
        source_origin: SOURCE_ORIGIN,
        source_page_url: LISTING_URL,
        source_url: card.sourceUrl,
        dedup_key: dedupKey,
        title: card.title,
        title_slug: titleSlug,
        summary: card.excerpt || null,
        published_date: card.publishedDate,
        kind,
        is_unofficial_proxy: false,
        collected_at: new Date(),
      })
      .onConflictDoNothing({ target: konsultime.dedup_key })
      .returning({ id: konsultime.id });

    if (!inserted) {
      this.logger.debug({ dedupKey }, 'dedup conflict — skipped');
      return { seen: 1, created: 0 };
    }

    this.logger.info({ dedupKey, kind }, 'Inserted konsultim');
    return { seen: 1, created: 1 };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function foldText(value: string): string {
  return normalizeText(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
