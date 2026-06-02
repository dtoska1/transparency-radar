import type { MunicipalitySlug } from '@tra/shared';
import { db } from '../connection.js';
import { municipalities, sources } from '../schema/index.js';

type VerticalValue = 'vendime' | 'konsultime' | 'prokurime';

type SourceDef = {
  slug: MunicipalitySlug;
  vertical: VerticalValue;
  source_origin: string;
  source_page_url: string;
  is_unofficial_proxy?: boolean;
  label_override?: string;
  notes?: string;
};

// Verified May 2026 content audit — 5 municipalities × 3 verticals = 15 sources.
// APP rows share source_origin; contracting-authority filter string lives in notes.
const SOURCE_DEFINITIONS: SourceDef[] = [
  // ── Tiranë ────────────────────────────────────────────────────────────────
  {
    slug: 'tirana',
    vertical: 'vendime',
    source_origin: 'tirana.al',
    source_page_url: 'https://tirana.al/kategoria-e-publikimit/vendime-keshilli-bashkiak',
    notes: 'Bot detection — requires Playwright with stealth',
  },
  {
    slug: 'tirana',
    vertical: 'konsultime',
    source_origin: 'tirana.al',
    source_page_url: 'https://tirana.al/kategori/konsultimi-publik',
    notes: 'Bot detection (same domain) — requires Playwright',
  },
  {
    slug: 'tirana',
    vertical: 'prokurime',
    source_origin: 'openprocurement.al',
    source_page_url: 'https://openprocurement.al/en/tender/list/inst_id/20',
    is_unofficial_proxy: true,
    notes:
      'AIS / Open Data Albania aggregator; open-data licensed; permission obtained. inst_id=20 confirmed from dropdown.',
  },
  // ── Shkodër ───────────────────────────────────────────────────────────────
  {
    slug: 'shkoder',
    vertical: 'vendime',
    source_origin: 'bashkiashkoder.gov.al',
    source_page_url: 'https://bashkiashkoder.gov.al/pjesemarrja-qytetare-ne-vendimmarrje',
    notes: 'Multiple candidate listing pages — confirm canonical URL during scraper build',
  },
  {
    // Exact listing path TBC — konsultimivendor.al is external/unofficial, do NOT use
    slug: 'shkoder',
    vertical: 'konsultime',
    source_origin: 'bashkiashkoder.gov.al',
    source_page_url: 'https://bashkiashkoder.gov.al',
    notes:
      'Listing URL TBC — update source_page_url once confirmed; konsultimivendor.al is external/unofficial',
  },
  {
    slug: 'shkoder',
    vertical: 'prokurime',
    source_origin: 'openprocurement.al',
    source_page_url: 'https://openprocurement.al/en/tender/list/inst_id/2',
    is_unofficial_proxy: true,
    notes:
      'AIS / Open Data Albania aggregator; open-data licensed; permission obtained. inst_id=2 confirmed from dropdown.',
  },
  // ── Durrës ────────────────────────────────────────────────────────────────
  {
    slug: 'durres',
    vertical: 'vendime',
    source_origin: 'durres.gov.al',
    source_page_url: 'https://durres.gov.al/vendime-te-keshillit-bashkiak-2',
    notes: 'PDF handling required — decision numbers inside PDFs, use pdf-parse',
  },
  {
    slug: 'durres',
    vertical: 'konsultime',
    source_origin: 'durres.gov.al',
    source_page_url: 'https://durres.gov.al/konsultimet-publike',
    notes: 'Also covers projekt-akte register — confirm latest-published date before enabling',
  },
  {
    slug: 'durres',
    vertical: 'prokurime',
    source_origin: 'openprocurement.al',
    source_page_url: 'https://openprocurement.al/en/tender/list/inst_id/16',
    is_unofficial_proxy: true,
    notes:
      'AIS / Open Data Albania aggregator; open-data licensed; permission obtained. inst_id=16 confirmed from dropdown.',
  },
  // ── Vlorë ─────────────────────────────────────────────────────────────────
  {
    // Official vlora.gov.al/transparenca/vendimet-e-keshillit/ just redirects here
    slug: 'vlore',
    vertical: 'vendime',
    source_origin: 'vendime.al',
    source_page_url: 'https://www.vendime.al/vlore',
    is_unofficial_proxy: true,
    label_override: 'Source: vendime.al',
    notes: 'Official site has no real feed — redirects to vendime.al; only proxy in v1',
  },
  {
    // Not a clean open-consultation feed: draft acts + public hearings interleaved
    slug: 'vlore',
    vertical: 'konsultime',
    source_origin: 'vlora.gov.al',
    source_page_url:
      'https://vlora.gov.al/regjistri-i-projekt-akteve-per-konsultim-publik-te-keshillit-bashkiak',
    notes: 'Contains draft acts and public hearings — set kind per row (draft_act / hearing)',
  },
  {
    slug: 'vlore',
    vertical: 'prokurime',
    source_origin: 'openprocurement.al',
    source_page_url: 'https://openprocurement.al/en/tender/list/inst_id/50',
    is_unofficial_proxy: true,
    notes:
      'AIS / Open Data Albania aggregator; open-data licensed; permission obtained. inst_id=50 confirmed from dropdown.',
  },
  // ── Pogradec ──────────────────────────────────────────────────────────────
  {
    // Per-meeting PDF bundles; decision numbers inside PDFs — Brief #3 target
    slug: 'pogradec',
    vertical: 'vendime',
    source_origin: 'bashkiapogradec.gov.al',
    source_page_url: 'https://bashkiapogradec.gov.al/publikime-kategori/vendime-te-keshillit-2',
    notes:
      'Per-meeting PDF bundles — decision numbers inside PDFs, pdf-parse required for dedup key',
  },
  {
    slug: 'pogradec',
    vertical: 'konsultime',
    source_origin: 'bashkiapogradec.gov.al',
    source_page_url:
      'https://bashkiapogradec.gov.al/publikime-kategori/njoftime-te-keshillit-bashkiak-12',
    notes:
      'Council notices listing — filter by keyword "konsultim publik"; exclude dead Bashkitë e Forta link',
  },
  {
    slug: 'pogradec',
    vertical: 'prokurime',
    source_origin: 'openprocurement.al',
    source_page_url: 'https://openprocurement.al/en/tender/list/inst_id/31',
    is_unofficial_proxy: true,
    notes:
      'AIS / Open Data Albania aggregator; open-data licensed; permission obtained. inst_id=31 confirmed from dropdown.',
  },
];

async function seed() {
  const muniRows = await db
    .select({ id: municipalities.id, slug: municipalities.slug })
    .from(municipalities);
  const muniMap = new Map(muniRows.map((m) => [m.slug, m.id]));

  const existingRows = await db
    .select({ municipality_id: sources.municipality_id, vertical: sources.vertical })
    .from(sources);
  const existingSet = new Set(existingRows.map((r) => `${r.municipality_id}:${r.vertical}`));

  const toInsert: (typeof sources.$inferInsert)[] = [];

  for (const def of SOURCE_DEFINITIONS) {
    const municipality_id = muniMap.get(def.slug);
    if (!municipality_id) {
      console.warn(`Municipality not found for slug: ${def.slug} — run municipalities seed first`);
      continue;
    }
    if (existingSet.has(`${municipality_id}:${def.vertical}`)) continue;

    toInsert.push({
      municipality_id,
      vertical: def.vertical,
      source_origin: def.source_origin,
      source_page_url: def.source_page_url,
      is_unofficial_proxy: def.is_unofficial_proxy ?? false,
      label_override: def.label_override ?? null,
      notes: def.notes ?? null,
    });
  }

  if (toInsert.length === 0) {
    console.log('Sources already seeded, nothing to insert.');
    process.exit(0);
  }

  await db.insert(sources).values(toInsert);
  console.log(`Seeded ${toInsert.length.toString()} sources.`);
  process.exit(0);
}

seed().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
