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
  ShkoderKonsultimeDocumentEnricher,
  type StorageLike,
  extractShkoderKonsultimeDocumentLinks,
  isOfficialShkoderKonsultimeDetailUrl,
} from './konsultime-documents.js';

const DETAIL_URL =
  'https://bashkiashkoder.gov.al/k%C3%ABshillim_m_publikun/njoftim-per-keshillim-me-publikun-12/';
const PDF_URL = 'https://bashkiashkoder.gov.al/wp-content/uploads/VKB-TRANS-AKU_.pdf';
const PDF_URL_2 =
  'https://bashkiashkoder.gov.al/wp-content/uploads/Njoftim-konsultim-tranferim.pdf';
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

describe('Shkodër konsultime document extraction', () => {
  it('extracts labels and direct document URLs from data-type="attachment" links', () => {
    const html = `
      <main>
        <a href="${PDF_URL}" data-type="attachment" data-id="10065">Projektvendim: konsultim</a>
        <a href="${PDF_URL_2}" data-type="attachment" data-id="10066">Njoftimi.</a>
      </main>
    `;

    expect(extractShkoderKonsultimeDocumentLinks(html, DETAIL_URL)).toEqual([
      {
        label: 'Projektvendim: konsultim',
        originalFilename: 'VKB-TRANS-AKU_.pdf',
        url: PDF_URL,
      },
      {
        label: 'Njoftimi.',
        originalFilename: 'Njoftim-konsultim-tranferim.pdf',
        url: PDF_URL_2,
      },
    ]);
  });

  it('returns no documents for metadata-only pages', () => {
    expect(extractShkoderKonsultimeDocumentLinks('<main>No files</main>', DETAIL_URL)).toEqual([]);
  });

  it('recognizes only official detail URLs', () => {
    expect(isOfficialShkoderKonsultimeDetailUrl(DETAIL_URL)).toBe(true);
    expect(isOfficialShkoderKonsultimeDetailUrl('https://bashkiashkoder.gov.al/lajme/')).toBe(
      false,
    );
  });
});

describe('Shkodër konsultime document integrity behavior', () => {
  it('matches Pogradec URL slot_ref semantics and writes audit only for new links', async () => {
    const repository = new FakeRepository();
    repository.linkResults = [true, false];
    const storage = new FakeStorage();
    const enricher = new ShkoderKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({ [PDF_URL]: response(validPdf()) }),
      hash: () => SHA256,
      repository,
      storage,
      timestamp: async () => 'tsr-token',
    });
    const row = { id: 'konsultim-1', sourceUrl: DETAIL_URL, title: 'Konsultim' };
    const link = {
      label: 'Projektvendim: konsultim',
      originalFilename: 'VKB-TRANS-AKU_.pdf',
      url: PDF_URL,
    };

    await enricher.enrichDocument(row, link);
    await enricher.enrichDocument(row, link);

    expect(repository.slotRefs).toEqual([PDF_URL, PDF_URL]);
    expect(repository.auditInputs).toHaveLength(1);
    expect(repository.auditInputs[0]).toMatchObject({
      documentUrl: PDF_URL,
      label: 'Projektvendim: konsultim',
      originalFilename: 'VKB-TRANS-AKU_.pdf',
      sha256: SHA256,
      storageKey: `shkoder/konsultime/${SHA256}.pdf`,
    });
  });

  it('continues after one document fails', async () => {
    const html = `
      <main>
        <a href="${PDF_URL}" data-type="attachment" data-id="10065">Bad PDF</a>
        <a href="${PDF_URL_2}" data-type="attachment" data-id="10066">Njoftimi.</a>
      </main>
    `;
    const repository = new FakeRepository();
    const storage = new FakeStorage();
    const enricher = new ShkoderKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({
        [DETAIL_URL]: response(html),
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
