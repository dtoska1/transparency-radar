import { db } from '@tra/db';
import { konsultime, municipalities, scrape_runs, sources } from '@tra/db';
import { toSlug } from '@tra/shared';
import * as cheerio from 'cheerio';
import { and, eq } from 'drizzle-orm';
import { fetch } from 'undici';
import { BaseScraper } from '../base-scraper.js';

const LISTING_URL =
  'https://bashkiapogradec.gov.al/publikime-kategori/konsultim-publik-10/';
const SOURCE_ORIGIN = 'bashkiapogradec.gov.al';
const YEAR_FLOOR = 2023;

const HTTP_HEADERS = {
  'User-Agent': 'TransparencyRadar/0.1 (+contact@transparency-radar.al)',
  'Accept-Language': 'sq-AL,sq;q=0.9,en;q=0.8',
};

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Converts DD-MM-YYYY listing date to ISO YYYY-MM-DD without constructing a JS Date. */
export function parseListingDate(raw: string): string | null {
  const m = raw.trim().match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m as [string, string, string, string];
  return `${yyyy}-${mm}-${dd}`;
}

/** Classifies a konsultime item based on title and excerpt text. */
export function classifyKind(
  title: string,
  excerpt: string,
): 'hearing' | 'draft_act' | 'consultation_notice' {
  const text = `${title} ${excerpt}`.toLowerCase();
  if (text.includes('dëgjes') || text.includes('degjes')) return 'hearing';
  if (text.includes('projekt') && (text.includes('akt') || text.includes('vendim')))
    return 'draft_act';
  return 'consultation_notice';
}

// ── Scraper ───────────────────────────────────────────────────────────────────

interface CardEntry {
  title: string;
  sourceUrl: string;
  excerpt: string;
  publishedDate: string; // ISO YYYY-MM-DD
}

interface ProcessResult {
  seen: number;
  created: number;
}

export class PogradecKonsultimeScraper extends BaseScraper {
  constructor() {
    super('pogradec', 'konsultime');
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
      .where(and(eq(municipalities.slug, 'pogradec'), eq(sources.vertical, 'konsultime')))
      .limit(1);

    if (!found)
      throw new Error(
        'Source not found for pogradec/konsultime — run pnpm --filter @tra/db db:seed:sources first',
      );
    return { sourceId: found.sourceId, municipalityId: found.municipalityId };
  }

  private async fetchListingCards(): Promise<CardEntry[]> {
    const res = await fetch(LISTING_URL, {
      headers: HTTP_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Listing fetch failed: ${res.status} ${LISTING_URL}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const cards: CardEntry[] = [];
    const seen = new Set<string>();

    $('h3.grid-title a[href*="/publikime/konsultim-publik-10/"]').each((_i, el) => {
      const $a = $(el);
      const href = $a.attr('href') ?? '';
      if (!href) return;
      const sourceUrl = href.startsWith('http')
        ? href
        : new URL(href, LISTING_URL).toString();
      if (seen.has(sourceUrl)) return;
      seen.add(sourceUrl);

      const title = $a.text().trim();
      if (!title) return;

      const $section = $a.closest('section');
      const excerpt = $section.find('p').first().text().trim();
      const rawDate = $section.find('span').first().text().trim();
      const publishedDate = parseListingDate(rawDate);
      if (!publishedDate) {
        this.logger.warn({ rawDate, sourceUrl }, 'Could not parse date — skipping card');
        return;
      }

      const year = Number.parseInt(publishedDate.slice(0, 4), 10);
      if (year < YEAR_FLOOR) return;

      cards.push({ title, sourceUrl, excerpt, publishedDate });
    });

    if (cards.length === 0) {
      this.logger.error(
        { htmlSnippet: html.slice(0, 2000) },
        'No cards found — inspect htmlSnippet and verify selector',
      );
    }

    return cards;
  }

  private async insertKonsultim(
    card: CardEntry,
    sourceId: string,
    municipalityId: string,
  ): Promise<ProcessResult> {
    const titleSlug = toSlug(card.title);
    const dedupKey = `konsultime:pogradec:${titleSlug}:${card.publishedDate}`;
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
        review_status: 'pending',
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
}
