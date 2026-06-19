import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const state = {
    allowlistRows: [] as { id: string; email: string; added_by: string | null; created_at: Date }[],
    adminRows: [] as { id: string; email: string; disabled_at: Date | null; created_at: Date }[],
    insertedValues: undefined as { email: string; added_by: string | null } | undefined,
    onConflictCalled: false,
    deletedWhere: undefined as unknown,
  };

  const select = vi.fn((selection: Record<string, unknown>) => {
    const isAllowlist = 'added_by' in selection;
    const builder = {
      from() {
        return builder;
      },
      orderBy() {
        return Promise.resolve(isAllowlist ? state.allowlistRows : state.adminRows);
      },
    };
    return builder;
  });

  const insert = vi.fn(() => ({
    values: vi.fn((row: { email: string; added_by: string | null }) => {
      state.insertedValues = row;
      return {
        onConflictDoNothing: vi.fn(() => {
          state.onConflictCalled = true;
          return Promise.resolve();
        }),
      };
    }),
  }));

  const del = vi.fn(() => ({
    where: vi.fn((condition: unknown) => {
      state.deletedWhere = condition;
      return Promise.resolve();
    }),
  }));

  const reset = () => {
    state.allowlistRows = [];
    state.adminRows = [];
    state.insertedValues = undefined;
    state.onConflictCalled = false;
    state.deletedWhere = undefined;
    select.mockClear();
    insert.mockClear();
    del.mockClear();
  };

  return { db: { select, insert, delete: del }, reset, state };
});

vi.mock('drizzle-orm', () => ({
  desc: vi.fn((value: unknown) => ({ kind: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
}));

vi.mock('@tra/db', () => ({
  admin_allowlist: {
    id: 'admin_allowlist.id',
    email: 'admin_allowlist.email',
    added_by: 'admin_allowlist.added_by',
    created_at: 'admin_allowlist.created_at',
  },
  admin_users: {
    id: 'admin_users.id',
    email: 'admin_users.email',
    disabled_at: 'admin_users.disabled_at',
    created_at: 'admin_users.created_at',
  },
  db: dbMock.db,
}));

import { requireAdminSession } from '../middleware/requireAdminSession.js';
import { adminAllowlistRouter } from './adminAllowlist.js';

function findHandler(method: 'get' | 'post' | 'delete', path: string) {
  const layer = (
    adminAllowlistRouter as unknown as {
      stack: {
        route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
      }[];
    }
  ).stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer?.route) throw new Error(`No ${method.toUpperCase()} handler for ${path}`);
  return layer.route.stack[0]?.handle as (req: Request, res: Response) => Promise<void>;
}

function makeRequest(
  opts: { body?: unknown; params?: Record<string, string>; admin?: { user: { id: string } } } = {},
): Request {
  return { body: opts.body, params: opts.params ?? {}, admin: opts.admin } as unknown as Request;
}

function makeResponse(): Response & { body: unknown; statusCode: number | undefined } {
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
    setHeader() {
      return res;
    },
  };
  return res as unknown as Response & typeof res;
}

describe('requireAdminSession composed in front of the allowlist router', () => {
  beforeEach(() => dbMock.reset());

  it('rejects an unauthenticated request before it reaches the allowlist handler', async () => {
    const res = makeResponse();
    const getAllowlist = findHandler('get', '/allowlist');
    let handlerCalled = false;

    await requireAdminSession({ headers: {} } as unknown as Request, res, (async () => {
      handlerCalled = true;
      await getAllowlist(makeRequest(), res);
    }) as unknown as () => void);

    expect(res.statusCode).toBe(401);
    expect(handlerCalled).toBe(false);
  });
});

describe('GET /allowlist', () => {
  beforeEach(() => dbMock.reset());

  it('returns the allowlist and current admins', async () => {
    dbMock.state.allowlistRows = [
      { id: '1', email: 'dev@gmail.com', added_by: 'admin-1', created_at: new Date('2026-01-01') },
    ];
    dbMock.state.adminRows = [
      {
        id: 'admin-1',
        email: 'dt@csdgalbania.org',
        disabled_at: null,
        created_at: new Date('2026-01-01'),
      },
    ];

    const res = makeResponse();
    await findHandler('get', '/allowlist')(makeRequest(), res);

    expect(res.body).toEqual({
      allowlist: dbMock.state.allowlistRows,
      admins: dbMock.state.adminRows,
    });
  });
});

describe('POST /allowlist', () => {
  beforeEach(() => dbMock.reset());

  it('rejects an invalid email without inserting', async () => {
    const res = makeResponse();
    await findHandler('post', '/allowlist')(makeRequest({ body: { email: 'not-an-email' } }), res);

    expect(res.statusCode).toBe(400);
    expect(dbMock.state.insertedValues).toBeUndefined();
  });

  it('normalizes and inserts a valid email, recording who added it', async () => {
    const res = makeResponse();
    await findHandler('post', '/allowlist')(
      makeRequest({
        body: { email: '  External-Dev@GMAIL.com  ' },
        admin: { user: { id: 'admin-1' } },
      }),
      res,
    );

    expect(dbMock.state.insertedValues).toEqual({
      email: 'external-dev@gmail.com',
      added_by: 'admin-1',
    });
    expect(dbMock.state.onConflictCalled).toBe(true);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('DELETE /allowlist/:id', () => {
  beforeEach(() => dbMock.reset());

  it('rejects a non-uuid id without deleting', async () => {
    const res = makeResponse();
    await findHandler('delete', '/allowlist/:id')(
      makeRequest({ params: { id: 'not-a-uuid' } }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(dbMock.state.deletedWhere).toBeUndefined();
  });

  it('deletes by id', async () => {
    const res = makeResponse();
    await findHandler('delete', '/allowlist/:id')(
      makeRequest({ params: { id: '11111111-1111-1111-1111-111111111111' } }),
      res,
    );

    expect(dbMock.state.deletedWhere).toEqual({
      kind: 'eq',
      left: 'admin_allowlist.id',
      right: '11111111-1111-1111-1111-111111111111',
    });
    expect(res.body).toEqual({ ok: true });
  });
});
