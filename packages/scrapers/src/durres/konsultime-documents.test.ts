import { describe, expect, it, vi } from 'vitest';

vi.mock('@tra/db', () => ({
  audit_log: {},
  db: {},
  document_versions: {},
  documents: {},
  konsultim_documents: {},
  konsultime: {},
  municipalities: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
}));

import {
  DurresKonsultimeDocumentEnricher,
  type EnrichmentRepository,
  type FetchLike,
  type LinkAuditInput,
  type StorageLike,
  extractDurresKonsultimeDocumentLinks,
  isOfficialDurresKonsultimeDetailUrl,
} from './konsultime-documents.js';

const DETAIL_URL =
  'https://durres.gov.al/2026/04/28/miratimin-e-planit-te-masave-per-menaxhimin-e-zjarreve-ne-pyje-dhe-kullota-per-vitin-2026/';
const PDF_URL = 'https://durres.gov.al/wp-content/uploads/2026/04/Plani-i-masave-viti-2026.pdf';
const PDF_URL_2 =
  'https://durres.gov.al/wp-content/uploads/2026/04/Njoftim-per-konsultim-plani-i-masave-per-zjarret-2026.pdf';
const SITEWIDE_PDF_URL =
  'https://durres.gov.al/wp-content/uploads/2023/01/PT-2026-Bashkia-Durres-1-1.pdf';
const SHA256 = 'a'.repeat(64);

class FakeRepository implements EnrichmentRepository {
  auditInputs: LinkAuditInput[] = [];
  linkResults: boolean[] = [true];
  slotRefs: string[] = [];

  async loadKonsultimeRows() {
    return [];
  }

  async upsertDocument() {
    return { id: 'doc-1', created: true, tsrToken: null };
  }

  async findDocumentTsrToken() {
    return null;
  }

  async updateDocumentTimestamp() {}

  async upsertDocumentVersion(_documentId: string, slotRef: string) {
    this.slotRefs.push(slotRef);
    return { id: 'version-1', created: true };
  }

  async linkDocumentAndAudit(input: LinkAuditInput) {
    const created = this.linkResults.shift() ?? false;
    if (created) this.auditInputs.push(input);
    return created;
  }
}

class FakeStorage implements StorageLike {
  uploads: { key: string; contentType: string; data: Buffer }[] = [];

  async upload(key: string, data: Buffer, contentType: string) {
    this.uploads.push({ key, data, contentType });
    return key;
  }
}

function response(body: string | Buffer, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : new Uint8Array(body), init);
}

function fetchMap(entries: Record<string, Response>): FetchLike {
  return vi.fn(async (url: Parameters<FetchLike>[0]) => {
    const key = String(url);
    const found = entries[key];
    if (!found) return response('', { status: 404 });
    return found.clone();
  }) as unknown as FetchLike;
}

function validPdf(): Buffer {
  return Buffer.from('%PDF-valid fixture', 'utf8');
}

const PAGE_WITH_SITEWIDE_PDF_OUTSIDE_CONTENT = `
  <header>
    <a href="${SITEWIDE_PDF_URL}">Programi i Transparencës</a>
  </header>
  <div class="elementor-widget-theme-post-content">
    <p class="wp-block-paragraph"><a href="${PDF_URL}">Plani i masave viti 2026</a></p>
    <p class="wp-block-paragraph"><a href="${PDF_URL_2}">Njoftim per konsultim plani i masave per zjarret 2026</a></p>
  </div>
`;

describe('Durrës konsultime document extraction', () => {
  it('extracts labels and document URLs from inside the post-content widget only', () => {
    expect(
      extractDurresKonsultimeDocumentLinks(PAGE_WITH_SITEWIDE_PDF_OUTSIDE_CONTENT, DETAIL_URL),
    ).toEqual([
      {
        label: 'Plani i masave viti 2026',
        originalFilename: 'Plani-i-masave-viti-2026.pdf',
        url: PDF_URL,
      },
      {
        label: 'Njoftim per konsultim plani i masave per zjarret 2026',
        originalFilename: 'Njoftim-per-konsultim-plani-i-masave-per-zjarret-2026.pdf',
        url: PDF_URL_2,
      },
    ]);
  });

  it('excludes the sitewide Programi i Transparencës PDF linked outside the content widget', () => {
    const links = extractDurresKonsultimeDocumentLinks(
      PAGE_WITH_SITEWIDE_PDF_OUTSIDE_CONTENT,
      DETAIL_URL,
    );
    expect(links.some((link) => link.url === SITEWIDE_PDF_URL)).toBe(false);
  });

  it('returns no documents for rows with an empty post-content widget', () => {
    const html = '<div class="elementor-widget-theme-post-content"></div>';
    expect(extractDurresKonsultimeDocumentLinks(html, DETAIL_URL)).toEqual([]);
  });

  it('recognizes only official detail URLs', () => {
    expect(isOfficialDurresKonsultimeDetailUrl(DETAIL_URL)).toBe(true);
    expect(isOfficialDurresKonsultimeDetailUrl('https://durres.gov.al/lajme/')).toBe(false);
  });
});

describe('Durrës konsultime document integrity behavior', () => {
  it('matches Pogradec/Shkodër URL slot_ref semantics and writes audit only for new links', async () => {
    const repository = new FakeRepository();
    repository.linkResults = [true, false];
    const storage = new FakeStorage();
    const enricher = new DurresKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({ [PDF_URL]: response(validPdf()) }),
      hash: () => SHA256,
      repository,
      storage,
      timestamp: async () => 'tsr-token',
    });
    const row = { id: 'konsultim-1', sourceUrl: DETAIL_URL, title: 'Konsultim' };
    const link = {
      label: 'Plani i masave viti 2026',
      originalFilename: 'Plani-i-masave-viti-2026.pdf',
      url: PDF_URL,
    };

    await enricher.enrichDocument(row, link);
    await enricher.enrichDocument(row, link);

    expect(repository.slotRefs).toEqual([PDF_URL, PDF_URL]);
    expect(repository.auditInputs).toHaveLength(1);
    expect(repository.auditInputs[0]).toMatchObject({
      documentUrl: PDF_URL,
      label: 'Plani i masave viti 2026',
      originalFilename: 'Plani-i-masave-viti-2026.pdf',
      sha256: SHA256,
      storageKey: `durres/konsultime/${SHA256}.pdf`,
    });
  });

  it('continues after one document fails', async () => {
    const repository = new FakeRepository();
    const storage = new FakeStorage();
    const enricher = new DurresKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({
        [DETAIL_URL]: response(PAGE_WITH_SITEWIDE_PDF_OUTSIDE_CONTENT),
        [PDF_URL]: response('not a pdf'),
        [PDF_URL_2]: response(validPdf()),
      }),
      hash: () => SHA256,
      repository,
      storage,
      timestamp: async () => 'tsr-token',
    });

    const stats = await enricher.enrichKonsultim({
      id: 'konsultim-1',
      sourceUrl: DETAIL_URL,
      title: 'Konsultim',
    });

    expect(stats.documentsSeen).toBe(2);
    expect(stats.documentsFailed).toBe(1);
    expect(stats.documentsStored).toBe(1);
    expect(storage.uploads).toHaveLength(1);
  });
});
