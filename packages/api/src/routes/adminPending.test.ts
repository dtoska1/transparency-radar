import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface QueryCall {
  innerJoins: unknown[];
  leftJoins: unknown[];
  limit: number | undefined;
  offset: number | undefined;
  selectionKeys: string[];
  table: unknown;
}

const dbMock = vi.hoisted(() => {
  const state = {
    rowsByTable: new Map<unknown, Record<string, unknown>[]>(),
    queryCalls: [] as QueryCall[],
    subqueryCalls: [] as {
      alias: string | undefined;
      innerJoins: unknown[];
      orderBy: unknown[];
      selectionKeys: string[];
      table: unknown;
    }[],
  };

  const selectDistinctOn = vi.fn((_on: unknown[], selection: Record<string, unknown>) => {
    const call = {
      alias: undefined as string | undefined,
      innerJoins: [] as unknown[],
      orderBy: [] as unknown[],
      selectionKeys: Object.keys(selection),
      table: undefined as unknown,
    };
    state.subqueryCalls.push(call);

    const builder = {
      from(table: unknown) {
        call.table = table;
        return builder;
      },
      innerJoin(table: unknown) {
        call.innerJoins.push(table);
        return builder;
      },
      orderBy(...orderBy: unknown[]) {
        call.orderBy = orderBy;
        return builder;
      },
      as(alias: string) {
        call.alias = alias;
        return {
          alias,
          item_id: `${alias}.item_id`,
          sha256: `${alias}.sha256`,
          tsr_timestamp_at: `${alias}.tsr_timestamp_at`,
        };
      },
    };

    return builder;
  });

  const select = vi.fn((selection: Record<string, unknown>) => {
    const call: QueryCall = {
      innerJoins: [],
      leftJoins: [],
      limit: undefined,
      offset: undefined,
      selectionKeys: Object.keys(selection),
      table: undefined,
    };
    state.queryCalls.push(call);

    const builder = {
      from(table: unknown) {
        call.table = table;
        return builder;
      },
      innerJoin(table: unknown) {
        call.innerJoins.push(table);
        return builder;
      },
      leftJoin(table: unknown) {
        call.leftJoins.push(table);
        return builder;
      },
      where() {
        return builder;
      },
      limit(limit: number) {
        call.limit = limit;
        return builder;
      },
      offset(offset: number) {
        call.offset = offset;
        return Promise.resolve(state.rowsByTable.get(call.table) ?? []);
      },
    };

    return builder;
  });

  const reset = () => {
    state.rowsByTable.clear();
    state.queryCalls.length = 0;
    state.subqueryCalls.length = 0;
    select.mockClear();
    selectDistinctOn.mockClear();
  };

  return {
    db: {
      select,
      selectDistinctOn,
    },
    reset,
    state,
  };
});

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions })),
  desc: vi.fn((value: unknown) => ({ kind: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: [...strings],
    values,
  })),
}));

vi.mock('./adminBulkApprove.js', () => ({
  handleBulkApprove: vi.fn(),
}));

vi.mock('./adminCreate.js', () => ({
  handleAdminCreate: vi.fn(),
  upload: {
    single: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@tra/db', () => {
  const table = (name: string) => ({
    collected_at: `${name}.collected_at`,
    created_at: `${name}.created_at`,
    id: `${name}.id`,
    municipality_id: `${name}.municipality_id`,
    published_date: `${name}.published_date`,
    review_status: `${name}.review_status`,
    source_id: `${name}.source_id`,
    source_origin: `${name}.source_origin`,
    source_page_url: `${name}.source_page_url`,
    source_url: `${name}.source_url`,
    tableName: name,
    title: `${name}.title`,
  });

  return {
    audit_log: { tableName: 'audit_log' },
    db: dbMock.db,
    document_versions: {
      created_at: 'document_versions.created_at',
      document_id: 'document_versions.document_id',
      id: 'document_versions.id',
      version_no: 'document_versions.version_no',
    },
    documents: {
      id: 'documents.id',
      sha256: 'documents.sha256',
      tsr_timestamp_at: 'documents.tsr_timestamp_at',
    },
    konsultim_documents: {
      document_version_id: 'konsultim_documents.document_version_id',
      konsultim_id: 'konsultim_documents.konsultim_id',
      tableName: 'konsultim_documents',
    },
    konsultime: table('konsultime'),
    municipalities: {
      id: 'municipalities.id',
      slug: 'municipalities.slug',
      tableName: 'municipalities',
    },
    prokurim_documents: {
      document_version_id: 'prokurim_documents.document_version_id',
      prokurim_id: 'prokurim_documents.prokurim_id',
      tableName: 'prokurim_documents',
    },
    prokurime: table('prokurime'),
    sources: {
      id: 'sources.id',
      is_unofficial_proxy: 'sources.is_unofficial_proxy',
      tableName: 'sources',
    },
    vendim_documents: {
      document_version_id: 'vendim_documents.document_version_id',
      tableName: 'vendim_documents',
      vendim_id: 'vendim_documents.vendim_id',
    },
    vendime: table('vendime'),
  };
});

import { konsultime, prokurime, vendime } from '@tra/db';
import { handleListPending } from './admin.js';

function makeRequest(query: Record<string, unknown>): Request {
  return { query } as unknown as Request;
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

const expectedSelectionKeys = [
  'id',
  'title',
  'published_date',
  'municipality',
  'source_id',
  'source_origin',
  'source_page_url',
  'source_url',
  'is_unofficial_proxy',
  'sha256',
  'tsr_timestamp_at',
  'stamped',
  'review_status',
  'collected_at',
  'created_at',
];

describe('GET /api/admin/pending projection', () => {
  beforeEach(() => {
    dbMock.reset();
  });

  it('returns a stamped pending row with the enriched fields and unchanged envelope', async () => {
    const timestamp = new Date('2026-06-04T12:00:00.000Z');
    dbMock.state.rowsByTable.set(vendime, [
      {
        id: 'vendim-1',
        is_unofficial_proxy: false,
        sha256: 'a'.repeat(64),
        source_id: 'source-1',
        source_page_url: 'https://example.test/vendime',
        stamped: true,
        tsr_timestamp_at: timestamp,
      },
    ]);
    const res = makeResponse();

    await handleListPending(makeRequest({ vertical: 'vendime', limit: '1', offset: '0' }), res);

    expect(res.statusCode).toBeUndefined();
    expect(res.body).toEqual({
      data: [
        {
          id: 'vendim-1',
          is_unofficial_proxy: false,
          sha256: 'a'.repeat(64),
          source_id: 'source-1',
          source_page_url: 'https://example.test/vendime',
          stamped: true,
          tsr_timestamp_at: timestamp,
          vertical: 'vendime',
        },
      ],
      limit: 1,
      offset: 0,
    });
  });

  it('keeps an unstamped pending row with null document fields', async () => {
    dbMock.state.rowsByTable.set(konsultime, [
      {
        id: 'konsultim-1',
        is_unofficial_proxy: false,
        sha256: null,
        source_id: 'source-2',
        source_page_url: 'https://example.test/konsultime',
        stamped: false,
        tsr_timestamp_at: null,
      },
    ]);
    const res = makeResponse();

    await handleListPending(makeRequest({ vertical: 'konsultime' }), res);

    expect(res.body).toMatchObject({
      data: [
        {
          id: 'konsultim-1',
          sha256: null,
          stamped: false,
          tsr_timestamp_at: null,
          vertical: 'konsultime',
        },
      ],
      limit: 20,
      offset: 0,
    });
    expect(dbMock.state.queryCalls[0]?.leftJoins).toHaveLength(1);
  });

  it('uses the same enriched projection for every vertical without exposing tsr_token', async () => {
    for (const vertical of ['vendime', 'konsultime', 'prokurime'] as const) {
      const res = makeResponse();
      await handleListPending(makeRequest({ vertical }), res);
    }

    expect(dbMock.state.queryCalls).toHaveLength(3);
    for (const call of dbMock.state.queryCalls) {
      expect(call.selectionKeys).toEqual(expectedSelectionKeys);
      expect(call.selectionKeys).not.toContain('tsr_token');
      expect(call.leftJoins).toHaveLength(1);
    }
    expect(dbMock.state.subqueryCalls).toHaveLength(3);
    for (const call of dbMock.state.subqueryCalls) {
      expect(call.selectionKeys).toEqual(['item_id', 'sha256', 'tsr_timestamp_at']);
      expect(call.selectionKeys).not.toContain('tsr_token');
      expect(call.innerJoins).toHaveLength(2);
      expect(call.orderBy).toHaveLength(4);
    }

    expect(dbMock.state.queryCalls.map((call) => call.table)).toEqual([
      vendime,
      konsultime,
      prokurime,
    ]);
  });
});
