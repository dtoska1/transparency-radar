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
  type EnrichmentRepository,
  type FetchLike,
  type LinkAuditInput,
  type StorageLike,
  VloreKonsultimeDocumentEnricher,
  extractVloreKonsultimeDocumentLinks,
  isOfficialVloreKonsultimeDetailUrl,
} from './konsultime-documents.js';

const DETAIL_URL =
  'https://vlora.gov.al/njoftim-mbi-degjesen-publike-per-projekt-paketen-fiskale-per-taksat-dhe-tarifat-vendore/';
const PDF_URL =
  'https://vlora.gov.al/wp-content/uploads/2023/11/PROJEKT-VENDIMIN-PERFUNDIMTARE-Per-taksat-dhe-tarifat-vendore-viti-2024.pdf';
const PDF_URL_2 = 'https://vlora.gov.al/wp-content/uploads/2024/01/Njoftim-shtese.pdf';
const NAV_PDF_SAME_ORIGIN =
  'http://vlora.gov.al/wp-content/uploads/STRATEGJIA-e-kominikimit-te-KB-Vlore.pdf';
const NAV_PDF_CROSS_ORIGIN =
  'http://cec.org.al/wp-content/uploads/2019/07/Bashkia-Vlore-Keshill-1.pdf';
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

const PAGE_WITH_NAV_PDFS_OUTSIDE_CONTENT = `
  <header>
    <nav>
      <a href="${NAV_PDF_CROSS_ORIGIN}">Rezultati i zgjedhjeve</a>
      <a href="${NAV_PDF_SAME_ORIGIN}">Strategjia e Komunikimit te KB</a>
    </nav>
  </header>
  <article class="hentry">
    <div class="entry-inner">
      <p><a href="${PDF_URL}">PROJEKT VENDIMIN PERFUNDIMTARE Per taksat dhe tarifat vendore viti 2024</a></p>
      <p><a href="${PDF_URL_2}">Njoftim shtese</a></p>
    </div>
  </article>
`;

const PAGE_WITH_NO_ENTRY_INNER = `
  <header>
    <nav>
      <a href="${NAV_PDF_CROSS_ORIGIN}">Rezultati i zgjedhjeve</a>
    </nav>
  </header>
`;

describe('Vlorë konsultime document extraction', () => {
  it('extracts labels and document URLs from inside the entry-inner container only', () => {
    expect(
      extractVloreKonsultimeDocumentLinks(PAGE_WITH_NAV_PDFS_OUTSIDE_CONTENT, DETAIL_URL),
    ).toEqual([
      {
        label: 'PROJEKT VENDIMIN PERFUNDIMTARE Per taksat dhe tarifat vendore viti 2024',
        originalFilename:
          'PROJEKT-VENDIMIN-PERFUNDIMTARE-Per-taksat-dhe-tarifat-vendore-viti-2024.pdf',
        url: PDF_URL,
      },
      {
        label: 'Njoftim shtese',
        originalFilename: 'Njoftim-shtese.pdf',
        url: PDF_URL_2,
      },
    ]);
  });

  it('excludes sitewide nav PDFs linked outside entry-inner, including the cross-origin one', () => {
    const links = extractVloreKonsultimeDocumentLinks(
      PAGE_WITH_NAV_PDFS_OUTSIDE_CONTENT,
      DETAIL_URL,
    );
    expect(links.some((link) => link.url === NAV_PDF_CROSS_ORIGIN)).toBe(false);
    expect(links.some((link) => link.url === NAV_PDF_SAME_ORIGIN)).toBe(false);
  });

  it('returns no documents when entry-inner is missing entirely', () => {
    expect(extractVloreKonsultimeDocumentLinks(PAGE_WITH_NO_ENTRY_INNER, DETAIL_URL)).toEqual([]);
  });

  it('returns no documents for an empty entry-inner container', () => {
    const html = '<article class="hentry"><div class="entry-inner"></div></article>';
    expect(extractVloreKonsultimeDocumentLinks(html, DETAIL_URL)).toEqual([]);
  });

  it('recognizes only official detail URLs', () => {
    expect(isOfficialVloreKonsultimeDetailUrl(DETAIL_URL)).toBe(true);
    expect(isOfficialVloreKonsultimeDetailUrl('https://vlora.gov.al/lajme/something/')).toBe(false);
    expect(
      isOfficialVloreKonsultimeDetailUrl('https://cec.org.al/njoftim-per-degjese-publike/'),
    ).toBe(false);
  });
});

describe('Vlorë konsultime document integrity behavior', () => {
  it('matches Pogradec/Shkodër/Durrës URL slot_ref semantics and writes audit only for new links', async () => {
    const repository = new FakeRepository();
    repository.linkResults = [true, false];
    const storage = new FakeStorage();
    const enricher = new VloreKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({ [PDF_URL]: response(validPdf()) }),
      hash: () => SHA256,
      repository,
      storage,
      timestamp: async () => 'tsr-token',
    });
    const row = { id: 'konsultim-1', sourceUrl: DETAIL_URL, title: 'Konsultim' };
    const link = {
      label: 'PROJEKT VENDIMIN PERFUNDIMTARE Per taksat dhe tarifat vendore viti 2024',
      originalFilename:
        'PROJEKT-VENDIMIN-PERFUNDIMTARE-Per-taksat-dhe-tarifat-vendore-viti-2024.pdf',
      url: PDF_URL,
    };

    await enricher.enrichDocument(row, link);
    await enricher.enrichDocument(row, link);

    expect(repository.slotRefs).toEqual([PDF_URL, PDF_URL]);
    expect(repository.auditInputs).toHaveLength(1);
    expect(repository.auditInputs[0]).toMatchObject({
      documentUrl: PDF_URL,
      label: 'PROJEKT VENDIMIN PERFUNDIMTARE Per taksat dhe tarifat vendore viti 2024',
      originalFilename:
        'PROJEKT-VENDIMIN-PERFUNDIMTARE-Per-taksat-dhe-tarifat-vendore-viti-2024.pdf',
      sha256: SHA256,
      storageKey: `vlore/konsultime/${SHA256}.pdf`,
    });
  });

  it('continues after one document fails', async () => {
    const repository = new FakeRepository();
    const storage = new FakeStorage();
    const enricher = new VloreKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({
        [DETAIL_URL]: response(PAGE_WITH_NAV_PDFS_OUTSIDE_CONTENT),
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

  it('skips a row cleanly when the detail page returns a non-200 response, without aborting the batch', async () => {
    const repository = new FakeRepository();
    const storage = new FakeStorage();
    const enricher = new VloreKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({
        [DETAIL_URL]: response('<html>Page not found</html>', { status: 404 }),
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

    expect(stats.documentsSeen).toBe(0);
    expect(stats.documentsFailed).toBe(0);
    expect(stats.rowsSkipped).toBe(1);
    expect(storage.uploads).toHaveLength(0);
  });
});
