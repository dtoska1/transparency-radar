import { db } from '@tra/db';
import { konsultime, municipalities, scrape_runs, sources } from '@tra/db';
import { toSlug } from '@tra/shared';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { and, eq } from 'drizzle-orm';
import { fetch } from 'undici';
import { BaseScraper } from '../base-scraper.js';

const CATEGORY_URL =
  'https://tirana.al/kategoria-e-publikimit/regjistri-i-projekt-akteve-per-konsultim';
const SOURCE_ORIGIN = 'tirana.al';
const FALLBACK_TITLE = 'Regjistri i projektakteve për konsultim publik';
const YEAR_FLOOR_DATE = '2023-01-01';
const REGISTER_PATTERN = 'regjistri-i-projektakteve-per-konsultim';

const HTTP_HEADERS = {
  'User-Agent': 'TransparencyRadar/0.1 (+contact@transparency-radar.al)',
  'Accept-Language': 'sq-AL,sq;q=0.9,en;q=0.8',
};

export interface TiranaKonsultimeItem {
  title: string;
  sourceUrl: string;
  sourceOrigin: typeof SOURCE_ORIGIN;
  sourcePageUrl: typeof CATEGORY_URL;
  publishedDate: string; // ISO YYYY-MM-DD
  kind: 'draft_act';
  isUnofficialProxy: false;
}

interface ProcessResult {
  seen: number;
  created: number;
}

export function parseTiranaKonsultimeHtml(html: string): TiranaKonsultimeItem[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const items: TiranaKonsultimeItem[] = [];

  $('a[href]').each((_i, el) => {
    const sourceUrl = normalizeRegisterUrl($(el).attr('href') ?? '');
    if (!sourceUrl || seen.has(sourceUrl)) return;

    const publishedDate = parseAdjacentDate($, el) ?? parseFilenameTimestamp(sourceUrl);
    if (!publishedDate || publishedDate < YEAR_FLOOR_DATE) return;

    const title = deriveTitle($(el).text());
    seen.add(sourceUrl);
    items.push({
      title,
      sourceUrl,
      sourceOrigin: SOURCE_ORIGIN,
      sourcePageUrl: CATEGORY_URL,
      publishedDate,
      kind: 'draft_act',
      isUnofficialProxy: false,
    });
  });

  return items;
}

export function parseFilenameTimestamp(sourceUrl: string): string | null {
  let filename: string;
  try {
    const url = new URL(sourceUrl, CATEGORY_URL);
    filename = url.pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    return null;
  }

  const match = filename.match(/^(\d{4})(\d{2})(\d{2})\d{6}_/);
  if (!match) return null;

  const [, yyyy, mm, dd] = match as [string, string, string, string];
  if (!isValidDateParts(yyyy, mm, dd)) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export function parseVisibleDate(raw: string): string | null {
  const normalized = normalizeText(raw);
  const numeric = normalized.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
  if (numeric) {
    const [, dayRaw, monthRaw, year] = numeric as [string, string, string, string];
    const dd = dayRaw.padStart(2, '0');
    const mm = monthRaw.padStart(2, '0');
    if (!isValidDateParts(year, mm, dd)) return null;
    return `${year}-${mm}-${dd}`;
  }

  const iso = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (!iso) return null;

  const [, yyyy, mm, dd] = iso as [string, string, string, string];
  if (!isValidDateParts(yyyy, mm, dd)) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export class TiranaKonsultimeScraper extends BaseScraper {
  constructor() {
    super('tirana', 'konsultime');
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
      this.logger.info({ total: cards.length }, 'Register documents fetched from category');

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
      .where(and(eq(municipalities.slug, 'tirana'), eq(sources.vertical, 'konsultime')))
      .limit(1);

    if (!found)
      throw new Error(
        'Source not found for tirana/konsultime — run pnpm --filter @tra/db db:seed:sources first',
      );
    return { sourceId: found.sourceId, municipalityId: found.municipalityId };
  }

  private async fetchListingCards(): Promise<TiranaKonsultimeItem[]> {
    const res = await fetch(CATEGORY_URL, {
      headers: HTTP_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Category fetch failed: ${res.status} ${CATEGORY_URL}`);

    const html = await res.text();
    const cards = parseTiranaKonsultimeHtml(html);
    if (cards.length === 0) {
      this.logger.error(
        { htmlSnippet: html.slice(0, 2000) },
        'No Tiranë register document found — inspect htmlSnippet and verify register link pattern',
      );
    }

    return cards;
  }

  private async insertKonsultim(
    card: TiranaKonsultimeItem,
    sourceId: string,
    municipalityId: string,
  ): Promise<ProcessResult> {
    const titleSlug = toSlug(card.title);
    const dedupKey = `konsultime:tirana:${titleSlug}:${card.publishedDate}`;

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

function normalizeRegisterUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, CATEGORY_URL);
  } catch {
    return null;
  }

  if (url.hostname !== SOURCE_ORIGIN) return null;
  if (!url.pathname.startsWith('/uploads/')) return null;
  if (!url.pathname.toLowerCase().includes(REGISTER_PATTERN)) return null;
  return url.toString();
}

function parseAdjacentDate($: cheerio.CheerioAPI, el: Element): string | null {
  const link = $(el);
  const candidates = [
    link.attr('title') ?? '',
    link.parent().text(),
    link.closest('li, article, section, div, tr').first().text(),
  ];

  for (const candidate of candidates) {
    const date = parseVisibleDate(candidate);
    if (date) return date;
  }

  return null;
}

function deriveTitle(linkText: string): string {
  const title = normalizeText(linkText);
  if (isUsableTitle(title)) return title;
  return FALLBACK_TITLE;
}

function isUsableTitle(value: string): boolean {
  const normalized = normalizeText(value);
  if (normalized.length < 4) return false;
  return !/^(shkarko|download|publikimi)$/i.test(normalized);
}

function isValidDateParts(year: string, month: string, day: string): boolean {
  const yyyy = Number.parseInt(year, 10);
  const mm = Number.parseInt(month, 10);
  const dd = Number.parseInt(day, 10);

  if (!Number.isInteger(yyyy) || yyyy < 1900 || yyyy > 2100) return false;
  if (!Number.isInteger(mm) || mm < 1 || mm > 12) return false;
  if (!Number.isInteger(dd) || dd < 1 || dd > 31) return false;
  return true;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
