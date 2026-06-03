import { db } from '@tra/db';
import { municipalities, prokurime, scrape_runs, sources } from '@tra/db';
import * as cheerio from 'cheerio';
import { and, eq } from 'drizzle-orm';
import pino from 'pino';
import { fetch } from 'undici';

const BASE = 'https://openprocurement.al';
const SOURCE_ORIGIN = 'openprocurement.al';
const MAX_PAGES = 200;

// inst_ids confirmed from dropdown on 2026-06-02
const INST_IDS: Record<string, number> = {
  tirana: 20,
  durres: 16,
  shkoder: 2,
  vlore: 50,
  pogradec: 31,
};

const HTTP_HEADERS = {
  'User-Agent':
    'TransparencyRadarBot/1.0 (+https://github.com/dtoska1/transparency-radar; CSDG; dtoska@csdgalbania.org)',
  'Accept-Language': 'sq-AL,sq;q=0.9,en;q=0.8',
};

const logger = pino({ name: 'importer:prokurime:openprocurement' });

// ── Helpers ───────────────────────────────────────────────────────────────────

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

// ── DB helpers ────────────────────────────────────────────────────────────────

async function lookupSource(slug: string): Promise<{ sourceId: string; municipalityId: string }> {
  const [found] = await db
    .select({ sourceId: sources.id, municipalityId: sources.municipality_id })
    .from(sources)
    .innerJoin(municipalities, eq(sources.municipality_id, municipalities.id))
    .where(and(eq(municipalities.slug, slug), eq(sources.vertical, 'prokurime')))
    .limit(1);
  if (!found) throw new Error(`Source not found for ${slug}/prokurime — run db:seed:sources first`);
  return found;
}

// ── Row parser ────────────────────────────────────────────────────────────────

interface TenderRow {
  tenderId: string;
  contractingAuthority: string;
  procurementObject: string;
  sourceUrl: string;
}

function parseTableRow(row: ReturnType<cheerio.CheerioAPI>): TenderRow | null {
  const cells = row.find('td');
  if (cells.length < 2) return null;

  const authority = cells.eq(0).text().trim().replace(/\s+/g, ' ');
  const objectCell = cells.eq(1);
  const objectText = objectCell.text().trim().replace(/\s+/g, ' ');
  const href = objectCell.find('a').attr('href') ?? '';

  const idMatch = href.match(/\/tender\/view\/id\/(\d+)/);
  const tenderId = idMatch?.[1];
  if (!tenderId) return null;
  const sourceUrl = `${BASE}/en/tender/view/id/${tenderId}`;

  return { tenderId, contractingAuthority: authority, procurementObject: objectText, sourceUrl };
}

// ── Insert ────────────────────────────────────────────────────────────────────

async function insertProkurim(
  row: TenderRow,
  instId: number,
  sourceId: string,
  municipalityId: string,
): Promise<{ seen: number; created: number }> {
  const dedupKey = `prokurime:app:${row.tenderId}`;
  const pageUrl = `${BASE}/en/tender/list/inst_id/${instId}`;
  // published_date is NOT NULL in schema; list page has no dates — use collection date as v1 placeholder
  const today = new Date().toISOString().slice(0, 10);

  const [inserted] = await db
    .insert(prokurime)
    .values({
      municipality_id: municipalityId,
      source_id: sourceId,
      source_origin: SOURCE_ORIGIN,
      is_unofficial_proxy: true,
      source_page_url: pageUrl,
      source_url: row.sourceUrl,
      dedup_key: dedupKey,
      app_id: row.tenderId,
      title: row.procurementObject,
      contracting_authority: row.contractingAuthority,
      procurement_object: row.procurementObject,
      published_date: today,
      review_status: 'pending',
      collected_at: new Date(),
    })
    .onConflictDoNothing({ target: prokurime.dedup_key })
    .returning({ id: prokurime.id });

  if (!inserted) {
    logger.debug({ dedupKey }, 'dedup conflict — skipped');
    return { seen: 1, created: 0 };
  }
  return { seen: 1, created: 1 };
}

// ── Per-municipality run ──────────────────────────────────────────────────────

async function runForMunicipality(
  slug: string,
  instId: number,
  firstRunLimit: number,
): Promise<void> {
  const { sourceId, municipalityId } = await lookupSource(slug);

  const [runRow] = await db
    .insert(scrape_runs)
    .values({
      source_id: sourceId,
      municipality_id: municipalityId,
      vertical: 'prokurime',
      started_at: new Date(),
      status: 'running',
    })
    .returning({ id: scrape_runs.id });
  if (!runRow) throw new Error('Failed to insert scrape_run row');
  const runId = runRow.id;

  let totalSeen = 0;
  let totalNew = 0;
  let prevPageIds: string[] | null = null;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        page === 1
          ? `${BASE}/en/tender/list/inst_id/${instId}`
          : `${BASE}/en/tender/list/faqe/${page}/inst_id/${instId}`;

      logger.info({ slug, page, url }, 'fetching page');
      const res = await fetchWithRetry(url);

      if (!res.ok) {
        logger.warn({ slug, page, status: res.status }, 'non-200 response — stopping pagination');
        break;
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      const rows = $('#results_table tbody tr').toArray();
      const parsed = rows.map((tr) => parseTableRow($(tr)));
      const pageIds = parsed.flatMap((p) => (p ? [p.tenderId] : []));

      if (pageIds.length === 0) {
        logger.info({ slug, page }, 'empty page — stopping');
        break;
      }
      if (
        prevPageIds !== null &&
        pageIds.length === prevPageIds.length &&
        pageIds.every((id, i) => id === prevPageIds?.[i])
      ) {
        logger.info(
          { slug, page },
          'page identical to previous (site re-serve) — stopping at end of data',
        );
        break;
      }
      prevPageIds = pageIds;

      for (const p of parsed) {
        if (!p) {
          totalSeen += 1;
          continue;
        }
        const r = await insertProkurim(p, instId, sourceId, municipalityId);
        totalSeen += r.seen;
        totalNew += r.created;

        if (totalNew >= firstRunLimit) break;
      }

      logger.info({ slug, page, totalSeen, totalNew }, 'page done');

      if (totalNew >= firstRunLimit) {
        logger.info({ slug, firstRunLimit }, 'firstRunLimit reached — stopping');
        break;
      }

      await delay(2000 + Math.random() * 1000);
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

    logger.info({ slug, totalSeen, totalNew }, 'municipality done');
  } catch (err) {
    logger.error({ slug, err }, 'municipality run failed');
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
  }
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

export async function run(opts: { firstRunLimit: number }): Promise<void> {
  for (const [slug, instId] of Object.entries(INST_IDS)) {
    logger.info({ slug, instId }, 'starting municipality');
    await runForMunicipality(slug, instId, opts.firstRunLimit);
    await delay(3000);
  }
  logger.info('all municipalities done');
}
