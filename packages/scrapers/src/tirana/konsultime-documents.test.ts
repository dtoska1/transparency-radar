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
  TiranaKonsultimeDocumentEnricher,
  isOfficialTiranaKonsultimeDocumentUrl,
} from './konsultime-documents.js';

const DOC_URL =
  'https://tirana.al/uploads/2026/5/20260520142956_regjistri-i-projektakteve-per-konsultim-1.doc';
const ROW = {
  id: 'konsultim-1',
  sourceUrl: DOC_URL,
  title: 'Regjistri i projekt-akteve per Konsultim Publik',
};
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

function validOleDoc(): Buffer {
  const header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return Buffer.concat([header, Buffer.from('fixture body', 'utf8')]);
}

describe('Tiranë konsultime document URL guard', () => {
  it('recognizes only official document URLs', () => {
    expect(isOfficialTiranaKonsultimeDocumentUrl(DOC_URL)).toBe(true);
    expect(isOfficialTiranaKonsultimeDocumentUrl('https://tirana.al/lajme/something/')).toBe(false);
    expect(isOfficialTiranaKonsultimeDocumentUrl('https://evil.example/uploads/x.doc')).toBe(false);
  });
});

describe('Tiranë konsultime document integrity behavior', () => {
  it('matches the other municipalities slot_ref/audit semantics for a valid OLE doc', async () => {
    const repository = new FakeRepository();
    repository.linkResults = [true, false];
    const storage = new FakeStorage();
    const enricher = new TiranaKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({ [DOC_URL]: response(validOleDoc()) }),
      hash: () => SHA256,
      repository,
      storage,
      timestamp: async () => 'tsr-token',
    });

    await enricher.enrichDocument(ROW);
    await enricher.enrichDocument(ROW);

    expect(repository.slotRefs).toEqual([DOC_URL, DOC_URL]);
    expect(repository.auditInputs).toHaveLength(1);
    expect(repository.auditInputs[0]).toMatchObject({
      documentUrl: DOC_URL,
      label: ROW.title,
      originalFilename: '20260520142956_regjistri-i-projektakteve-per-konsultim-1.doc',
      sha256: SHA256,
      storageKey: `tirana/konsultime/${SHA256}.doc`,
    });
    expect(storage.uploads).toHaveLength(2);
  });

  it('skips a row cleanly when the document URL returns a non-200 response, without aborting the batch', async () => {
    const repository = new FakeRepository();
    const storage = new FakeStorage();
    const enricher = new TiranaKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({ [DOC_URL]: response('not found', { status: 404 }) }),
      hash: () => SHA256,
      repository,
      storage,
      timestamp: async () => 'tsr-token',
    });

    const stats = await enricher.enrichKonsultim(ROW);

    expect(stats.rowsSkipped).toBe(1);
    expect(stats.documentsStored).toBe(0);
    expect(storage.uploads).toHaveLength(0);
  });

  it('rejects a 200 response whose body is not a real OLE document', async () => {
    const repository = new FakeRepository();
    const storage = new FakeStorage();
    const enricher = new TiranaKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({ [DOC_URL]: response('<html>not a doc</html>') }),
      hash: () => SHA256,
      repository,
      storage,
      timestamp: async () => 'tsr-token',
    });

    const stats = await enricher.enrichKonsultim(ROW);

    expect(stats.documentsFailed).toBe(1);
    expect(stats.documentsStored).toBe(0);
    expect(storage.uploads).toHaveLength(0);
  });

  it('skips a row cleanly when the document URL is not official', async () => {
    const repository = new FakeRepository();
    const storage = new FakeStorage();
    const enricher = new TiranaKonsultimeDocumentEnricher({
      delay: async () => {},
      fetchImpl: fetchMap({}),
      hash: () => SHA256,
      repository,
      storage,
      timestamp: async () => 'tsr-token',
    });

    const stats = await enricher.enrichKonsultim({
      id: 'konsultim-2',
      sourceUrl: 'https://evil.example/uploads/x.doc',
      title: 'Bad row',
    });

    expect(stats.rowsSkipped).toBe(1);
    expect(stats.documentsStored).toBe(0);
    expect(storage.uploads).toHaveLength(0);
  });
});
