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
  PogradecKonsultimeDocumentEnricher,
  type StorageLike,
  extractPogradecKonsultimeDocumentLinks,
  getAllowedDocumentFormat,
  isOfficialPogradecKonsultimeDetailUrl,
} from './konsultime-documents.js';

const DETAIL_URL =
  'https://bashkiapogradec.gov.al/publikime/konsultim-publik-10/konsultim-publik-779/';
const PDF_URL = 'https://bashkiapogradec.gov.al/ngarkime/njoftimet/docs/projekt-vendim.pdf';
const DOC_URL = 'https://bashkiapogradec.gov.al/ngarkime/njoftimet/docs/njoftim-konsultimi.doc';
const DOCX_URL = 'https://bashkiapogradec.gov.al/ngarkime/njoftimet/docs/njoftim-konsultimi.docx';
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

function validDocx(): Buffer {
  return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
}

describe('Pogradec konsultime document extraction', () => {
  it('extracts labels and direct document URLs from table rows', () => {
    const html = `
      <table>
        <tr><td>Dokumenti</td><td>Data</td><td>Numri</td><td>Shkarko</td></tr>
        <tr>
          <td>Projekt Vendimi I Linjave Te Transportit</td>
          <td></td><td></td>
          <td><a href="${PDF_URL}"><span class="fa fa-download"></span></a></td>
        </tr>
      </table>
    `;

    expect(extractPogradecKonsultimeDocumentLinks(html, DETAIL_URL)).toEqual([
      {
        label: 'Projekt Vendimi I Linjave Te Transportit',
        originalFilename: 'projekt-vendim.pdf',
        url: PDF_URL,
      },
    ]);
  });

  it('returns no documents for metadata-only pages', () => {
    expect(extractPogradecKonsultimeDocumentLinks('<main>No files</main>', DETAIL_URL)).toEqual([]);
  });

  it('recognizes only official detail URLs', () => {
    expect(isOfficialPogradecKonsultimeDetailUrl(DETAIL_URL)).toBe(true);
    expect(isOfficialPogradecKonsultimeDetailUrl('https://bashkiapogradec.gov.al/konsultim')).toBe(
      false,
    );
  });
});

describe('Pogradec konsultime document validation', () => {
  it('allows pdf/doc/docx formats only', () => {
    expect(getAllowedDocumentFormat(PDF_URL)?.ext).toBe('pdf');
    expect(getAllowedDocumentFormat(DOC_URL)?.ext).toBe('doc');
    expect(getAllowedDocumentFormat(DOCX_URL)?.ext).toBe('docx');
    expect(
      getAllowedDocumentFormat('https://bashkiapogradec.gov.al/ngarkime/njoftimet/docs/table.xlsx'),
    ).toBeNull();
  });

  it('rejects oversized downloads before storing', async () => {
    const repository = new FakeRepository();
    const storage = new FakeStorage();
    const enricher = new PogradecKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({
        [PDF_URL]: response('', { headers: { 'content-length': String(51 * 1024 * 1024) } }),
      }),
      hash: () => SHA256,
      repository,
      storage,
      timestamp: async () => 'tsr-token',
    });

    await expect(
      enricher.enrichDocument(
        { id: 'konsultim-1', sourceUrl: DETAIL_URL, title: 'Konsultim' },
        { label: 'Dokumenti', originalFilename: 'projekt-vendim.pdf', url: PDF_URL },
      ),
    ).rejects.toThrow(/50 MB/);
    expect(storage.uploads).toHaveLength(0);
  });
});

describe('Pogradec konsultime document integrity behavior', () => {
  it('matches vendime URL slot_ref semantics and writes audit only for new links', async () => {
    const repository = new FakeRepository();
    repository.linkResults = [true, false];
    const storage = new FakeStorage();
    const enricher = new PogradecKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({ [PDF_URL]: response(validPdf()) }),
      hash: () => SHA256,
      repository,
      storage,
      timestamp: async () => 'tsr-token',
    });
    const row = { id: 'konsultim-1', sourceUrl: DETAIL_URL, title: 'Konsultim' };
    const link = { label: 'Projekt Vendimi', originalFilename: 'projekt-vendim.pdf', url: PDF_URL };

    await enricher.enrichDocument(row, link);
    await enricher.enrichDocument(row, link);

    expect(repository.slotRefs).toEqual([PDF_URL, PDF_URL]);
    expect(repository.auditInputs).toHaveLength(1);
    expect(repository.auditInputs[0]).toMatchObject({
      documentUrl: PDF_URL,
      label: 'Projekt Vendimi',
      originalFilename: 'projekt-vendim.pdf',
      sha256: SHA256,
      storageKey: `pogradec/konsultime/${SHA256}.pdf`,
    });
  });

  it('continues after one document fails', async () => {
    const html = `
      <table>
        <tr><td>Bad PDF</td><td></td><td></td><td><a href="${PDF_URL}"></a></td></tr>
        <tr><td>Njoftim</td><td></td><td></td><td><a href="${DOCX_URL}"></a></td></tr>
      </table>
    `;
    const repository = new FakeRepository();
    const storage = new FakeStorage();
    const enricher = new PogradecKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({
        [DETAIL_URL]: response(html),
        [PDF_URL]: response('not a pdf'),
        [DOCX_URL]: response(validDocx()),
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
