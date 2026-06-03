import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SelectScope = 'db' | 'tx';
type SelectRow = Record<string, unknown>;

interface SelectCall {
  scope: SelectScope;
  selectionKeys: string[];
  table: unknown;
  whereArgs: unknown[];
  limitValue: number | undefined;
}

interface SelectResult extends Array<SelectRow> {
  limit(limitValue: number): SelectResult;
}

interface SelectBuilder {
  from(table: unknown): SelectBuilder;
  where(condition: unknown): SelectResult;
}

const dbMock = vi.hoisted(() => {
  const state = {
    count: 2,
    municipalityRows: [{ id: 'municipality-tirana' }] as SelectRow[],
    itemRows: [{ id: 'prokurim-1' }, { id: 'prokurim-2' }] as SelectRow[],
    sampleRows: [{ dedup_key: 'prokurime:app:REF-1' }] as SelectRow[],
    selectCalls: [] as SelectCall[],
    updateSetValues: [] as Record<string, unknown>[],
    insertValues: [] as unknown[],
  };

  const resolveSelect = (call: SelectCall): SelectRow[] => {
    if (call.selectionKeys.includes('count')) return [{ count: state.count }];
    if (call.selectionKeys.includes('dedup_key')) return state.sampleRows;
    if (call.selectionKeys.includes('id') && call.scope === 'tx') return state.itemRows;
    if (call.selectionKeys.includes('id')) return state.municipalityRows;
    return [];
  };

  const createSelect = (scope: SelectScope) =>
    vi.fn((selection: Record<string, unknown>) => {
      const call: SelectCall = {
        scope,
        selectionKeys: Object.keys(selection),
        table: undefined,
        whereArgs: [],
        limitValue: undefined,
      };
      state.selectCalls.push(call);

      const builder: SelectBuilder = {
        from(table: unknown) {
          call.table = table;
          return builder;
        },
        where(condition: unknown) {
          call.whereArgs.push(condition);
          const rows = resolveSelect(call) as SelectResult;
          rows.limit = (limitValue: number) => {
            call.limitValue = limitValue;
            return rows;
          };
          return rows;
        },
      };

      return builder;
    });

  const dbSelect = createSelect('db');
  const txSelect = createSelect('tx');
  const updateWhere = vi.fn(() => Promise.resolve());
  const updateSet = vi.fn((values: Record<string, unknown>) => {
    state.updateSetValues.push(values);
    return { where: updateWhere };
  });
  const update = vi.fn(() => ({ set: updateSet }));
  const insertValues = vi.fn((values: unknown) => {
    state.insertValues.push(values);
    return Promise.resolve();
  });
  const insert = vi.fn(() => ({ values: insertValues }));
  const tx = { select: txSelect, update, insert };
  const transaction = vi.fn(async (callback: (transactionClient: typeof tx) => Promise<unknown>) =>
    callback(tx),
  );

  const reset = () => {
    state.count = 2;
    state.municipalityRows = [{ id: 'municipality-tirana' }];
    state.itemRows = [{ id: 'prokurim-1' }, { id: 'prokurim-2' }];
    state.sampleRows = [{ dedup_key: 'prokurime:app:REF-1' }];
    state.selectCalls.length = 0;
    state.updateSetValues.length = 0;
    state.insertValues.length = 0;
    dbSelect.mockClear();
    txSelect.mockClear();
    updateWhere.mockClear();
    updateSet.mockClear();
    update.mockClear();
    insertValues.mockClear();
    insert.mockClear();
    transaction.mockClear();
  };

  return {
    db: {
      select: dbSelect,
      transaction,
    },
    reset,
    state,
    transaction,
  };
});

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  inArray: vi.fn((left: unknown, values: unknown[]) => ({ kind: 'inArray', left, values })),
  notLike: vi.fn((left: unknown, pattern: string) => ({ kind: 'notLike', left, pattern })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: [...strings],
    values,
  })),
}));

vi.mock('@tra/db', () => {
  const audit_log = { tableName: 'audit_log' };
  const municipalities = { id: 'municipalities.id', slug: 'municipalities.slug' };
  const vendime = {
    id: 'vendime.id',
    review_status: 'vendime.review_status',
    municipality_id: 'vendime.municipality_id',
    year_signed: 'vendime.year_signed',
    dedup_key: 'vendime.dedup_key',
  };
  const konsultime = {
    id: 'konsultime.id',
    review_status: 'konsultime.review_status',
    municipality_id: 'konsultime.municipality_id',
    published_date: 'konsultime.published_date',
    dedup_key: 'konsultime.dedup_key',
  };
  const prokurime = {
    id: 'prokurime.id',
    review_status: 'prokurime.review_status',
    municipality_id: 'prokurime.municipality_id',
    published_date: 'prokurime.published_date',
    dedup_key: 'prokurime.dedup_key',
  };

  return {
    audit_log,
    db: dbMock.db,
    konsultime,
    municipalities,
    prokurime,
    vendime,
  };
});

import { handleBulkApprove } from './adminBulkApprove.js';

function makeRequest(body: Record<string, unknown>): Request {
  return {
    params: { vertical: 'prokurime' },
    body,
  } as unknown as Request;
}

function makeResponse(): Response & {
  body: unknown;
  statusCode: number | undefined;
} {
  const res = {
    body: undefined as unknown,
    statusCode: undefined as number | undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res as unknown as Response & { body: unknown; statusCode: number | undefined };
}

describe('handleBulkApprove', () => {
  beforeEach(() => {
    dbMock.reset();
  });

  it('accepts prokurime and returns a dry-run count without mutating', async () => {
    const res = makeResponse();

    await handleBulkApprove(
      makeRequest({ municipality: 'tirana', year: 2026, dryRun: true }),
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBeUndefined();
    expect(res.body).toEqual({
      dryRun: true,
      wouldApprove: 2,
      sample: ['prokurime:app:REF-1'],
    });
    expect(dbMock.transaction).not.toHaveBeenCalled();
    expect(dbMock.state.updateSetValues).toEqual([]);
    expect(dbMock.state.insertValues).toEqual([]);
  });

  it('hardcodes approved status server-side when the body includes review_status', async () => {
    const res = makeResponse();

    await handleBulkApprove(
      makeRequest({ municipality: 'tirana', dryRun: false, review_status: 'rejected' }),
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBeUndefined();
    expect(res.body).toEqual({ approved: 2 });
    expect(dbMock.state.updateSetValues).toEqual([{ review_status: 'approved' }]);
    expect(dbMock.state.insertValues).toHaveLength(1);
    expect(dbMock.state.insertValues[0]).toMatchObject([
      { action: 'bulk_approve', table_name: 'prokurime', record_id: 'prokurim-1' },
      { action: 'bulk_approve', table_name: 'prokurime', record_id: 'prokurim-2' },
    ]);
  });

  it('filters prokurime years through published_date, never year_signed', async () => {
    const source = await readFile(
      fileURLToPath(new URL('./adminBulkApprove.ts', import.meta.url)),
      {
        encoding: 'utf8',
      },
    );
    const prokurimeBranchStart = source.indexOf('// prokurime');
    expect(prokurimeBranchStart).toBeGreaterThan(-1);

    const prokurimeBranch = source.slice(prokurimeBranchStart);
    expect(prokurimeBranch).toContain('prokurime.published_date');
    expect(prokurimeBranch).not.toContain('year_signed');
    expect(source).not.toContain('prokurime.year_signed');
  });
});
