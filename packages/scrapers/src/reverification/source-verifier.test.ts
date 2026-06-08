import { APP_COLUMNS, type AppCsvRow, canonicalAppRowHash, hashBytes } from '@tra/shared';
import { describe, expect, it, vi } from 'vitest';
import { DefaultSourceVerifier } from './source-verifier.js';
import type { DocumentSourceSlot } from './types.js';

function response(bytes: Buffer, status = 200) {
  return new Response(bytes, { status });
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function buildCsv(rows: AppCsvRow[]): Buffer {
  return Buffer.from(
    [
      APP_COLUMNS.map(csvCell).join(','),
      ...rows.map((row) => APP_COLUMNS.map((column) => csvCell(row[column])).join(',')),
    ].join('\r\n'),
    'utf8',
  );
}

function appRow(reference: string, title: string): AppCsvRow {
  return {
    ...Object.fromEntries(APP_COLUMNS.map((column) => [column, ''])),
    Autoriteti_kontraktues: 'BASHKIA TIRANE',
    Numri_i_references: reference,
    Objekti_i_prokurimit: title,
    Data_e_publikimit: '01.06.2026',
    Fondi_limit: '59,000.00',
  } as AppCsvRow;
}

function verifier(fetchImpl: ReturnType<typeof vi.fn>) {
  return new DefaultSourceVerifier({
    fetchImpl,
    minimumRequestIntervalMs: 0,
    retryBackoffsMs: [],
    sleep: async () => undefined,
  });
}

describe('DefaultSourceVerifier URL sources', () => {
  it('hashes exact fetched bytes and detects match versus change', async () => {
    const captured = Buffer.from('captured');
    const changed = Buffer.from('changed');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(captured))
      .mockResolvedValueOnce(response(changed));
    const sourceVerifier = verifier(fetchImpl);
    const slots: DocumentSourceSlot[] = [
      {
        slotRef: 'https://example.test/a.pdf',
        sourceType: 'url',
        url: 'https://example.test/a.pdf',
      },
      {
        slotRef: 'https://example.test/b.pdf',
        sourceType: 'url',
        url: 'https://example.test/b.pdf',
      },
    ];

    const result = await sourceVerifier.verify(slots, hashBytes(captured), 'run-1');

    expect(result).toMatchObject({
      sourceOk: false,
      changed: true,
      unreachable: false,
      observedSourceSha256: hashBytes(changed),
    });
    expect(result.results).toEqual([
      expect.objectContaining({ slot_ref: slots[0].slotRef, ok: true }),
      expect.objectContaining({
        slot_ref: slots[1].slotRef,
        ok: false,
        observed_sha256: hashBytes(changed),
      }),
    ]);
  });

  it('classifies an exhausted outage as unreachable rather than throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const sourceVerifier = new DefaultSourceVerifier({
      fetchImpl,
      minimumRequestIntervalMs: 0,
      retryBackoffsMs: [0, 0],
      sleep: async () => undefined,
    });

    const result = await sourceVerifier.verify(
      [
        {
          slotRef: 'https://example.test/a.pdf',
          sourceType: 'url',
          url: 'https://example.test/a.pdf',
        },
      ],
      '0'.repeat(64),
      'run-1',
    );

    expect(result).toMatchObject({ sourceOk: null, changed: false, unreachable: true });
    expect(result.results[0]).toMatchObject({ ok: null, reason: 'network down' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('starts sequential source requests no faster than the configured interval', async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const fetchImpl = vi.fn().mockResolvedValue(response(Buffer.from('captured')));
    const sourceVerifier = new DefaultSourceVerifier({
      fetchImpl,
      minimumRequestIntervalMs: 1_000,
      retryBackoffsMs: [],
      sleep,
      nowMs: () => clock,
    });

    await sourceVerifier.verify(
      [
        {
          slotRef: 'https://example.test/a.pdf',
          sourceType: 'url',
          url: 'https://example.test/a.pdf',
        },
        {
          slotRef: 'https://example.test/b.pdf',
          sourceType: 'url',
          url: 'https://example.test/b.pdf',
        },
      ],
      hashBytes(Buffer.from('captured')),
      'run-1',
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it('keeps source_changed priority when another slot is unreachable', async () => {
    const changed = Buffer.from('changed');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(changed))
      .mockRejectedValueOnce(new Error('offline'));
    const sourceVerifier = verifier(fetchImpl);

    const result = await sourceVerifier.verify(
      [
        {
          slotRef: 'https://example.test/a.pdf',
          sourceType: 'url',
          url: 'https://example.test/a.pdf',
        },
        {
          slotRef: 'https://example.test/b.pdf',
          sourceType: 'url',
          url: 'https://example.test/b.pdf',
        },
      ],
      '0'.repeat(64),
      'run-1',
    );

    expect(result).toMatchObject({ sourceOk: false, changed: true, unreachable: true });
  });

  it('does not fetch manual or historical slots', async () => {
    const fetchImpl = vi.fn();
    const sourceVerifier = verifier(fetchImpl);

    const result = await sourceVerifier.verify(
      [
        { slotRef: 'manual:item', sourceType: 'manual', reason: 'manual upload' },
        { slotRef: 'old:item', sourceType: 'historical', reason: 'historical version' },
      ],
      '0'.repeat(64),
      'run-1',
    );

    expect(result).toMatchObject({
      sourceOk: null,
      notApplicableOnly: true,
      changed: false,
      unreachable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('DefaultSourceVerifier APP exports', () => {
  it('fetches one CSV per run/year across separate document checks', async () => {
    const first = appRow('REF-1', 'First tender');
    const second = appRow('REF-2', 'Second tender');
    const fetchImpl = vi.fn().mockResolvedValue(response(buildCsv([first, second])));
    const sourceVerifier = verifier(fetchImpl);

    const firstResult = await sourceVerifier.verify(
      [
        {
          slotRef: 'prokurime:app:REF-1:source-row',
          sourceType: 'app_export',
          appId: 'REF-1',
          year: 2026,
        },
      ],
      canonicalAppRowHash(first).sha256,
      'weekly-run',
    );
    const secondResult = await sourceVerifier.verify(
      [
        {
          slotRef: 'prokurime:app:REF-2:source-row',
          sourceType: 'app_export',
          appId: 'REF-2',
          year: 2026,
        },
      ],
      canonicalAppRowHash(second).sha256,
      'weekly-run',
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(firstResult.results).toEqual([
      expect.objectContaining({ slot_ref: 'prokurime:app:REF-1:source-row', ok: true }),
    ]);
    expect(secondResult.results).toEqual([
      expect.objectContaining({
        slot_ref: 'prokurime:app:REF-2:source-row',
        ok: true,
        observed_sha256: canonicalAppRowHash(second).sha256,
      }),
    ]);
  });

  it('treats a missing APP reference as source_changed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(buildCsv([appRow('OTHER', 'Tender')])));
    const sourceVerifier = verifier(fetchImpl);

    const result = await sourceVerifier.verify(
      [
        {
          slotRef: 'prokurime:app:MISSING:source-row',
          sourceType: 'app_export',
          appId: 'MISSING',
          year: 2026,
        },
      ],
      '0'.repeat(64),
      'weekly-run',
    );

    expect(result).toMatchObject({ sourceOk: false, changed: true, unreachable: false });
    expect(result.results[0]).toMatchObject({
      ok: false,
      reason: 'APP reference not found in 2026 export',
    });
  });

  it('treats malformed or drifted APP exports as source_unreachable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(Buffer.from('<html>error</html>')));
    const sourceVerifier = verifier(fetchImpl);

    const result = await sourceVerifier.verify(
      [
        {
          slotRef: 'prokurime:app:REF-1:source-row',
          sourceType: 'app_export',
          appId: 'REF-1',
          year: 2026,
        },
      ],
      '0'.repeat(64),
      'weekly-run',
    );

    expect(result).toMatchObject({ sourceOk: null, changed: false, unreachable: true });
    expect(result.results[0]).toMatchObject({
      ok: null,
      reason: 'APP CSV 2026 header mismatch',
    });
  });
});
