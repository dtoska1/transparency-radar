import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DUMMY_ARGON2ID_HASH } from '../auth/password.js';

const dbMock = vi.hoisted(() => {
  const state = {
    user: undefined as
      | {
          id: string;
          email: string;
          password_hash: string;
          disabled_at: Date | null;
        }
      | undefined,
  };

  const selectLimit = vi.fn(async () => (state.user ? [state.user] : []));
  const select = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: selectLimit,
      }),
    }),
  }));

  const reset = () => {
    state.user = undefined;
    select.mockClear();
    selectLimit.mockClear();
  };

  return {
    db: { select },
    reset,
    state,
  };
});

const verifyMock = vi.hoisted(() => vi.fn(async () => false));
const createSessionMock = vi.hoisted(() =>
  vi.fn(async () => ({
    token: 'raw-session-token',
    sessionId: 'hashed-session-token',
    expiresAt: new Date('2026-06-05T20:00:00.000Z'),
  })),
);
const invalidateSessionMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@node-rs/argon2', () => ({
  verify: verifyMock,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
}));

vi.mock('@tra/db', () => ({
  admin_users: {
    id: 'admin_users.id',
    email: 'admin_users.email',
    password_hash: 'admin_users.password_hash',
    disabled_at: 'admin_users.disabled_at',
  },
  db: dbMock.db,
}));

vi.mock('../auth/session.js', () => ({
  createSession: createSessionMock,
  invalidateSession: invalidateSessionMock,
}));

import { handleAdminLogin, handleAdminLogout } from './adminAuth.js';

function makeRequest(body: unknown, cookie?: string): Request {
  return {
    body,
    headers: { cookie },
  } as unknown as Request;
}

function makeResponse(): Response & {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number | undefined;
} {
  const res = {
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    statusCode: undefined as number | undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader(name: string, value: number | string | readonly string[]) {
      res.headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
      return res;
    },
  };
  return res as unknown as Response & {
    body: unknown;
    headers: Record<string, string>;
    statusCode: number | undefined;
  };
}

describe('admin auth routes', () => {
  beforeEach(() => {
    dbMock.reset();
    verifyMock.mockReset().mockResolvedValue(false);
    createSessionMock.mockClear();
    invalidateSessionMock.mockClear();
  });

  it('logs in valid credentials with a strict session cookie', async () => {
    dbMock.state.user = {
      id: 'admin-1',
      email: 'admin@example.com',
      password_hash: 'real-password-hash',
      disabled_at: null,
    };
    verifyMock.mockResolvedValue(true);
    const res = makeResponse();

    await handleAdminLogin(
      makeRequest({ email: ' Admin@Example.COM ', password: 'correct-password' }),
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBeUndefined();
    expect(res.body).toEqual({ ok: true });
    expect(verifyMock).toHaveBeenCalledWith(
      'real-password-hash',
      'correct-password',
      expect.objectContaining({ algorithm: 2 }),
    );
    expect(createSessionMock).toHaveBeenCalledWith('admin-1');
    expect(res.headers['Set-Cookie']).toContain('tra_admin_session=raw-session-token');
    expect(res.headers['Set-Cookie']).toContain('Path=/');
    expect(res.headers['Set-Cookie']).toContain('HttpOnly');
    expect(res.headers['Set-Cookie']).toContain('Secure');
    expect(res.headers['Set-Cookie']).toContain('SameSite=Strict');
    expect(res.headers['Set-Cookie']).toContain('Expires=Fri, 05 Jun 2026 20:00:00 GMT');
  });

  it('returns identical 401 for unknown email, wrong password, disabled user, and bad body', async () => {
    const cases = [
      {
        name: 'unknown email',
        body: { email: 'missing@example.com', password: 'submitted-password' },
        user: undefined,
        verifyResult: false,
      },
      {
        name: 'wrong password',
        body: { email: 'admin@example.com', password: 'wrong-password' },
        user: {
          id: 'admin-1',
          email: 'admin@example.com',
          password_hash: 'real-password-hash',
          disabled_at: null,
        },
        verifyResult: false,
      },
      {
        name: 'disabled user',
        body: { email: 'admin@example.com', password: 'correct-password' },
        user: {
          id: 'admin-1',
          email: 'admin@example.com',
          password_hash: 'real-password-hash',
          disabled_at: new Date('2026-06-05T12:00:00.000Z'),
        },
        verifyResult: true,
      },
      {
        name: 'bad body',
        body: { email: 'not-an-email', password: 'submitted-password' },
        user: undefined,
        verifyResult: false,
      },
    ];

    for (const testCase of cases) {
      dbMock.reset();
      verifyMock.mockReset().mockResolvedValue(testCase.verifyResult);
      createSessionMock.mockClear();
      dbMock.state.user = testCase.user;
      const res = makeResponse();

      await handleAdminLogin(makeRequest(testCase.body), res, vi.fn());

      expect(res.statusCode, testCase.name).toBe(401);
      expect(res.body, testCase.name).toEqual({ error: 'Unauthorized' });
      expect(verifyMock, testCase.name).toHaveBeenCalledTimes(1);
      expect(createSessionMock, testCase.name).not.toHaveBeenCalled();
      expect(res.headers['Set-Cookie'], testCase.name).toBeUndefined();
    }
  });

  it('runs dummy argon2 verification for unknown email', async () => {
    const res = makeResponse();

    await handleAdminLogin(
      makeRequest({ email: 'missing@example.com', password: 'submitted-password' }),
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(401);
    expect(verifyMock).toHaveBeenCalledWith(
      DUMMY_ARGON2ID_HASH,
      'submitted-password',
      expect.objectContaining({ algorithm: 2 }),
    );
  });

  it('logs out by invalidating only the current cookie token and clearing the cookie', async () => {
    const res = makeResponse();

    await handleAdminLogout(
      makeRequest(undefined, 'tra_admin_session=raw-session-token'),
      res,
      vi.fn(),
    );

    expect(invalidateSessionMock).toHaveBeenCalledWith('raw-session-token');
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['Set-Cookie']).toContain('tra_admin_session=');
    expect(res.headers['Set-Cookie']).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
  });

  it('does not log request bodies in the auth route', async () => {
    const source = await readFile(fileURLToPath(new URL('./adminAuth.ts', import.meta.url)), {
      encoding: 'utf8',
    });

    expect(source).not.toContain('logger');
    expect(source).not.toContain('req.log');
  });
});
