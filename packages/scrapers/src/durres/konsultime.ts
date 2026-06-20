import { db } from '@tra/db';
import { konsultime, municipalities, scrape_runs, sources } from '@tra/db';
import { toSlug } from '@tra/shared';
import * as cheerio from 'cheerio';
import { and, eq } from 'drizzle-orm';
import { fetch } from 'undici';
import { BaseScraper } from '../base-scraper.js';

const LISTING_URL = 'https://durres.gov.al/konsultimet-publike/';
const SOURCE_ORIGIN = 'durres.gov.al';
const YEAR_FLOOR = 2023;
const YEAR_FLOOR_DATE = `${YEAR_FLOOR}-01-01`;
const DETAIL_PATH_RE = /^\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/;
const DOCUMENT_EXT_RE = /\.(pdf|doc|docx|xls|xlsx|zip)$/i;

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

export type DurresKonsultimeKind = 'hearing' | 'consultation_notice';

export interface DurresKonsultimeItem {
  title: string;
  sourceUrl: string;
  publishedDate: string; // ISO YYYY-MM-DD
  kind: DurresKonsultimeKind;
}

interface JsonLdMetadata {
  datePublished: string | null;
  title: string | null;
}

export function parseDurresKonsultimeListingHtml(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const urls: string[] = [];

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const detailUrl = normalizeDetailUrl(href);
    if (!detailUrl || seen.has(detailUrl)) return;
    seen.add(detailUrl);
    urls.push(detailUrl);
  });

  return urls;
}

export function parseDurresKonsultimeDetailHtml(
  html: string,
  finalUrl: string,
): DurresKonsultimeItem | null {
  const sourceUrl = normalizeFinalUrl(finalUrl);
  if (!sourceUrl) return null;

  const $ = cheerio.load(html);
  const jsonLd = extractJsonLdMetadata($);
  const title =
    normalizeText($('h1.entry-title, h1.elementor-heading-title, .entry-title h1, h1').first().text()) ||
    jsonLd.title;
  if (!title) return null;

  const visibleDateText = [
    $('time').first().text(),
    $('.elementor-post-info__item--type-date').first().text(),
    $('.posted-on, .entry-date, .post-date').first().text(),
    $('body').text(),
  ].join(' ');
  const publishedDate =
    jsonLd.datePublished ??
    parseVisibleAlbanianDate(visibleDateText) ??
    parsePermalinkDate(sourceUrl);
  if (!publishedDate || publishedDate < YEAR_FLOOR_DATE) return null;

  return {
    title,
    sourceUrl,
    publishedDate,
    kind: classifyKind(title, $('body').text()),
  };
}

export function parseIsoPublishedDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (!match) return null;
  const [, yyyy, mm, dd] = match as [string, string, string, string];
  return `${yyyy}-${mm}-${dd}`;
}

export function parseVisibleAlbanianDate(raw: string): string | null {
  const match = normalizeText(raw).match(/\b(\d{1,2})\s+([\p{L}]+),\s*(\d{4})\b/u);
  if (!match) return null;

  const [, dayRaw, monthRaw, year] = match as [string, string, string, string];
  const day = Number.parseInt(dayRaw, 10);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  const month = MONTHS.get(foldText(monthRaw));
  if (!month) return null;

  return `${year}-${month}-${dayRaw.padStart(2, '0')}`;
}

export function classifyKind(title: string, metadataText = ''): DurresKonsultimeKind {
  const text = foldText(`${title} ${metadataText}`);
  if (text.includes('degjes')) return 'hearing';
  return 'consultation_notice';
}

function normalizeDetailUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, LISTING_URL);
  } catch {
    return null;
  }

  if (url.hostname !== SOURCE_ORIGIN) return null;
  if (url.pathname.includes('/wp-content/uploads/')) return null;
  if (DOCUMENT_EXT_RE.test(url.pathname)) return null;
  if (!DETAIL_PATH_RE.test(url.pathname)) return null;
  return url.toString();
}

function normalizeFinalUrl(value: string): string | null {
  try {
    return new URL(value, LISTING_URL).toString();
  } catch {
    return null;
  }
}

function parsePermalinkDate(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const match = url.pathname.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (!match) return null;
  const [, yyyy, mm, dd] = match as [string, string, string, string];
  return `${yyyy}-${mm}-${dd}`;
}

function extractJsonLdMetadata($: cheerio.CheerioAPI): JsonLdMetadata {
  const metadata: JsonLdMetadata = { datePublished: null, title: null };
  let fallbackTitle: string | null = null;

  $('script[type="application/ld+json"]').each((_i, el) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse($(el).text());
    } catch {
      return;
    }

    for (const node of flattenJsonLd(parsed)) {
      const title =
        typeof node.headline === 'string'
          ? normalizeText(node.headline)
          : typeof node.name === 'string'
            ? normalizeText(node.name)
            : '';
      if (!fallbackTitle && title) fallbackTitle = title;

      if (typeof node.datePublished === 'string') {
        const datePublished = parseIsoPublishedDate(node.datePublished);
        if (datePublished) {
          metadata.datePublished ??= datePublished;
          if (title) {
            metadata.datePublished = datePublished;
            metadata.title = title;
            return false;
          }
        }
      }
    }

    return undefined;
  });

  metadata.title ??= fallbackTitle;
  return metadata;
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((item) => flattenJsonLd(item));
  if (!isRecord(value)) return [];

  const nodes: Record<string, unknown>[] = [value];
  const graph = value['@graph'];
  if (Array.isArray(graph)) nodes.push(...graph.flatMap((item) => flattenJsonLd(item)));
  else if (isRecord(graph)) nodes.push(...flattenJsonLd(graph));

  return nodes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ── Scraper ───────────────────────────────────────────────────────────────────

interface ProcessResult {
  seen: number;
  created: number;
}

export class DurresKonsultimeScraper extends BaseScraper {
  constructor() {
    super('durres', 'konsultime');
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
      .where(and(eq(municipalities.slug, 'durres'), eq(sources.vertical, 'konsultime')))
      .limit(1);

    if (!found)
      throw new Error(
        'Source not found for durres/konsultime — run pnpm --filter @tra/db db:seed:sources first',
      );
    return { sourceId: found.sourceId, municipalityId: found.municipalityId };
  }

  private async fetchListingCards(): Promise<DurresKonsultimeItem[]> {
    const res = await fetch(LISTING_URL, {
      headers: HTTP_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Listing fetch failed: ${res.status} ${LISTING_URL}`);
    const html = await res.text();

    const detailUrls = parseDurresKonsultimeListingHtml(html);
    if (detailUrls.length === 0) {
      this.logger.error(
        { htmlSnippet: html.slice(0, 2000) },
        'No detail-post URLs found — inspect htmlSnippet and verify selector',
      );
    }

    const items: DurresKonsultimeItem[] = [];
    const seen = new Set<string>();
    for (const detailUrl of detailUrls) {
      await this.delay(500 + Math.random() * 500);
      const item = await this.fetchDetailItem(detailUrl);
      if (!item || seen.has(item.sourceUrl)) continue;
      seen.add(item.sourceUrl);
      items.push(item);
    }

    return items;
  }

  private async fetchDetailItem(detailUrl: string): Promise<DurresKonsultimeItem | null> {
    const res = await fetch(detailUrl, {
      headers: HTTP_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      this.logger.warn({ detailUrl, status: res.status }, 'Detail fetch failed — skipping');
      return null;
    }

    const html = await res.text();
    const finalUrl = normalizeFinalUrl(res.url || detailUrl) ?? detailUrl;
    return parseDurresKonsultimeDetailHtml(html, finalUrl);
  }

  private async insertKonsultim(
    card: DurresKonsultimeItem,
    sourceId: string,
    municipalityId: string,
  ): Promise<ProcessResult> {
    const titleSlug = toSlug(card.title);
    const dedupKey = `konsultime:durres:${titleSlug}:${card.publishedDate}`;

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
        summary: null,
        published_date: card.publishedDate,
        kind: card.kind,
        is_unofficial_proxy: false,
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function foldText(value: string): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
