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

const APP_PROKURIME_PAGE_URL = 'https://app.gov.al/eksportimi-i-procedurave-te-publikuara/';

// Verified May 2026 content audit — 5 municipalities × 3 base verticals plus APP prokurime sources.
// APP source rows use the official nationwide export; municipality matching happens in the importer.
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
    source_origin: 'app.gov.al',
    source_page_url: APP_PROKURIME_PAGE_URL,
    is_unofficial_proxy: false,
    notes: 'Official APP procurement export; rows filtered to municipality by authority matcher.',
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
    slug: 'shkoder',
    vertical: 'konsultime',
    source_origin: 'bashkiashkoder.gov.al',
    source_page_url: 'https://bashkiashkoder.gov.al/keshillim-me-publikun/',
    notes:
      'Confirmed official paginated Konsultime feed; konsultimivendor.al is supplemental/unofficial only',
  },
  {
    slug: 'shkoder',
    vertical: 'prokurime',
    source_origin: 'app.gov.al',
    source_page_url: APP_PROKURIME_PAGE_URL,
    is_unofficial_proxy: false,
    notes: 'Official APP procurement export; rows filtered to municipality by authority matcher.',
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
    source_page_url: 'https://durres.gov.al/konsultimet-publike/',
    notes: 'Official public consultations register — metadata v1 collects WordPress detail posts only',
  },
  {
    slug: 'durres',
    vertical: 'prokurime',
    source_origin: 'app.gov.al',
    source_page_url: APP_PROKURIME_PAGE_URL,
    is_unofficial_proxy: false,
    notes: 'Official APP procurement export; rows filtered to municipality by authority matcher.',
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
    slug: 'vlore',
    vertical: 'konsultime',
    source_origin: 'vlora.gov.al',
    source_page_url:
      'https://vlora.gov.al/regjistri-i-projekt-akteve-per-konsultim-publik-te-keshillit-bashkiak/',
    notes: 'Official project-act register for public consultation — scraper stores kind=draft_act',
  },
  {
    slug: 'vlore',
    vertical: 'prokurime',
    source_origin: 'app.gov.al',
    source_page_url: APP_PROKURIME_PAGE_URL,
    is_unofficial_proxy: false,
    notes: 'Official APP procurement export; rows filtered to municipality by authority matcher.',
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
      'https://bashkiapogradec.gov.al/publikime-kategori/konsultim-publik-10/',
    notes: 'Confirmed official single-page Konsultime listing; no pagination in v1',
  },
  {
    slug: 'pogradec',
    vertical: 'prokurime',
    source_origin: 'app.gov.al',
    source_page_url: APP_PROKURIME_PAGE_URL,
    is_unofficial_proxy: false,
    notes: 'Official APP procurement export; rows filtered to municipality by authority matcher.',
  },
];

async function seed() {
  const muniRows = await db
    .select({ id: municipalities.id, slug: municipalities.slug })
    .from(municipalities);
  const muniMap = new Map(muniRows.map((m) => [m.slug, m.id]));

  const existingRows = await db
    .select({
      municipality_id: sources.municipality_id,
      vertical: sources.vertical,
      source_origin: sources.source_origin,
    })
    .from(sources);
  const existingSet = new Set(
    existingRows.map((r) => `${r.municipality_id}:${r.vertical}:${r.source_origin}`),
  );

  const toInsert: (typeof sources.$inferInsert)[] = [];

  for (const def of SOURCE_DEFINITIONS) {
    const municipality_id = muniMap.get(def.slug);
    if (!municipality_id) {
      console.warn(`Municipality not found for slug: ${def.slug} — run municipalities seed first`);
      continue;
    }
    if (existingSet.has(`${municipality_id}:${def.vertical}:${def.source_origin}`)) continue;

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
