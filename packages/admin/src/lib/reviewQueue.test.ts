import { describe, expect, it } from 'vitest';
import {
  type PendingRow,
  buildPendingApiPath,
  buildQueuePageUrl,
  formatPublishedDate,
  municipalityLabel,
  paginatePendingRows,
  parsePendingEnvelope,
  parseQueueFilters,
  safeExternalUrl,
  shortHash,
} from './reviewQueue';

function makeRow(overrides: Partial<PendingRow> = {}): PendingRow {
  return {
    id: '051abce1-feb1-4011-8fcf-3968d73fe5d5',
    title: 'Vendim test',
    published_date: '2026-06-07',
    municipality: 'pogradec',
    vertical: 'vendime',
    source_id: '0a540893-7342-445e-8d11-ef1395983529',
    source_origin: 'bashkiapogradec.gov.al',
    source_page_url: 'https://bashkiapogradec.gov.al/vendime',
    source_url: 'https://bashkiapogradec.gov.al/vendim.pdf',
    is_unofficial_proxy: false,
    sha256: 'a'.repeat(64),
    tsr_timestamp_at: '2026-06-07T10:00:00.000Z',
    stamped: true,
    review_status: 'pending',
    collected_at: '2026-06-07T10:00:00.000Z',
    created_at: '2026-06-07T10:00:00.000Z',
    ...overrides,
  };
}

describe('review queue data helpers', () => {
  it('parses valid filters and resets invalid values', () => {
    expect(
      parseQueueFilters(new URLSearchParams('vertical=vendime&municipality=shkoder&offset=40')),
    ).toEqual({ vertical: 'vendime', municipality: 'shkoder', offset: 40 });
    expect(
      parseQueueFilters(new URLSearchParams('vertical=unknown&municipality=other&offset=-1')),
    ).toEqual({ offset: 0 });
  });

  it('builds the read-only API path with one-row lookahead', () => {
    expect(
      buildPendingApiPath({ vertical: 'konsultime', municipality: 'pogradec', offset: 20 }),
    ).toBe('/api/admin/pending?vertical=konsultime&municipality=pogradec&limit=21&offset=20');
  });

  it('validates stamped rows and rejects stamped rows without a hash', () => {
    expect(
      parsePendingEnvelope({
        data: [makeRow()],
        limit: 21,
        offset: 0,
      }).data[0]?.sha256,
    ).toBe('a'.repeat(64));

    expect(() =>
      parsePendingEnvelope({
        data: [makeRow({ sha256: null, stamped: true })],
        limit: 21,
        offset: 0,
      }),
    ).toThrow('Invalid pending row');
  });

  it('accepts an unstamped pending row with null tamper fields', () => {
    const row = makeRow({
      vertical: 'konsultime',
      sha256: null,
      stamped: false,
      tsr_timestamp_at: null,
    });
    expect(parsePendingEnvelope({ data: [row], limit: 21, offset: 0 }).data[0]).toEqual(row);
  });

  it('trims lookahead independently per vertical without inventing a total', () => {
    const rows = [
      ...Array.from({ length: 21 }, (_, index) =>
        makeRow({ id: `vendim-${index}`, vertical: 'vendime' }),
      ),
      makeRow({
        id: 'konsultim-1',
        vertical: 'konsultime',
        sha256: null,
        stamped: false,
        tsr_timestamp_at: null,
      }),
    ];

    const result = paginatePendingRows(rows);
    expect(result.rows).toHaveLength(21);
    expect(result.rows.filter((row) => row.vertical === 'vendime')).toHaveLength(20);
    expect(result.rows.some((row) => row.id === 'konsultim-1')).toBe(true);
    expect(result.hasNext).toBe(true);
  });

  it('preserves filters in page links and omits a zero offset', () => {
    const filters = { vertical: 'vendime' as const, municipality: 'tirana' as const, offset: 20 };
    expect(buildQueuePageUrl(filters, 40)).toBe('/?vertical=vendime&municipality=tirana&offset=40');
    expect(buildQueuePageUrl(filters, 0)).toBe('/?vertical=vendime&municipality=tirana');
  });

  it('formats real display values without inventing metadata', () => {
    expect(municipalityLabel('shkoder')).toBe('Shkodër');
    expect(formatPublishedDate('2026-06-07')).toBe('07.06.2026');
    expect(shortHash('90e74b9235016e0b')).toBe('90e74b9235…');
  });

  it('allows only HTTP and HTTPS source links', () => {
    expect(safeExternalUrl('https://app.gov.al/path')).toBe('https://app.gov.al/path');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
  });
});
