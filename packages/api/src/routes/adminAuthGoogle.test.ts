import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const state = {
    allowlistEmails: [] as string[],
    adminUsers: [] as { id: string; email: string }[],
    insertedAdmins: [] as { id: string; email: string; password_hash: string }[],
  };

  const select = vi.fn(() => {
    const builder = {
      from(table: { tableName: string }) {
        if (table.tableName === 'admin_allowlist') {
          return Promise.resolve(state.allowlistEmails.map((email) => ({ email })));
        }
        return builder;
      },
      where() {
        return builder;
      },
      limit() {
        return Promise.resolve(
          state.adminUsers.length > 0
            ? [state.adminUsers[0]]
            : ([] as { id: string; email: string }[]),
        );
      },
    };
    return builder;
  });

  const insert = vi.fn((table: { tableName: string }) => ({
    values: vi.fn((row: { id: string; email: string; password_hash: string }) => {
      if (table.tableName === 'admin_users') state.insertedAdmins.push(row);
      return Promise.resolve();
    }),
  }));

  const reset = () => {
    state.allowlistEmails = [];
    state.adminUsers = [];
    state.insertedAdmins = [];
    select.mockClear();
    insert.mockClear();
  };

  return { db: { select, insert }, reset, state };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
}));

vi.mock('@tra/db', () => ({
  admin_allowlist: { tableName: 'admin_allowlist', email: 'admin_allowlist.email' },
  admin_users: {
    tableName: 'admin_users',
    id: 'admin_users.id',
    email: 'admin_users.email',
    password_hash: 'admin_users.password_hash',
  },
  db: dbMock.db,
}));

const googleMock = vi.hoisted(() => ({
  createGoogleAuthorizationURL: vi.fn(),
  exchangeGoogleCode: vi.fn(),
}));
vi.mock('../auth/google.js', () => googleMock);

const sessionMock = vi.hoisted(() => ({
  createSession: vi.fn(async (userId: string) => ({
    token: `token-for-${userId}`,
    sessionId: `session-for-${userId}`,
    expiresAt: new Date('2026-06-19T00:00:00.000Z'),
  })),
}));
vi.mock('../auth/session.js', () => sessionMock);

import { handleGoogleCallback, handleGoogleStart } from './adminAuthGoogle.js';

function makeRequest(opts: { cookie?: string; query?: Record<string, string> } = {}): Request {
  return {
    headers: { cookie: opts.cookie },
    query: opts.query ?? {},
  } as unknown as Request;
}

function makeResponse(): Response & {
  headers: Record<string, string | string[]>;
  redirectedTo: string | undefined;
  statusCode: number | undefined;
  body: unknown;
} {
  const res = {
    headers: {} as Record<string, string | string[]>,
    redirectedTo: undefined as string | undefined,
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    setHeader(name: string, value: string | string[]) {
      res.headers[name] = value;
      return res;
    },
    redirect(location: string) {
      res.redirectedTo = location;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res as unknown as Response & typeof res;
}

describe('handleGoogleStart', () => {
  beforeEach(() => {
    dbMock.reset();
    vi.clearAllMocks();
  });

  it('redirects to the Google authorization URL and sets the state cookie', () => {
    googleMock.createGoogleAuthorizationURL.mockReturnValue({
      url: new URL('https://accounts.google.com/o/oauth2/v2/auth?foo=bar'),
      state: 'the-state',
      codeVerifier: 'the-code-verifier',
    });

    const res = makeResponse();
    handleGoogleStart(makeRequest(), res, vi.fn());

    expect(res.redirectedTo).toBe('https://accounts.google.com/o/oauth2/v2/auth?foo=bar');
    expect(res.headers['Set-Cookie']).toContain('tra_admin_oauth=');
  });

  it('responds 500 without redirecting when Google OAuth is not configured', () => {
    googleMock.createGoogleAuthorizationURL.mockImplementation(() => {
      throw new Error('GOOGLE_CLIENT_ID is required for Google OAuth');
    });

    const res = makeResponse();
    handleGoogleStart(makeRequest(), res, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(res.redirectedTo).toBeUndefined();
  });
});

describe('handleGoogleCallback', () => {
  const stateCookie = 'tra_admin_oauth=the-state.the-code-verifier';

  beforeEach(() => {
    dbMock.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('redirects to the configured admin UI origin, not the API origin, on success', async () => {
    vi.stubEnv('CORS_ORIGINS', 'https://admin.radarvendor.com');
    vi.stubEnv('NODE_ENV', 'development');
    googleMock.exchangeGoogleCode.mockResolvedValue({
      email: 'dt@csdgalbania.org',
      email_verified: true,
    });

    const res = makeResponse();
    await handleGoogleCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('https://admin.radarvendor.com/');
  });

  it('redirects to the configured admin UI origin on rejection too', async () => {
    vi.stubEnv('CORS_ORIGINS', 'https://admin.radarvendor.com');
    vi.stubEnv('NODE_ENV', 'development');

    const res = makeResponse();
    await handleGoogleCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'wrong-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('https://admin.radarvendor.com/login?error=not_authorized');
  });

  it('rejects when the query state does not match the cookie state, without exchanging the code', async () => {
    const res = makeResponse();
    await handleGoogleCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'wrong-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('/login?error=not_authorized');
    expect(googleMock.exchangeGoogleCode).not.toHaveBeenCalled();
    expect(dbMock.state.insertedAdmins).toHaveLength(0);
  });

  it('rejects when email_verified is false, creating no admin row', async () => {
    googleMock.exchangeGoogleCode.mockResolvedValue({
      email: 'dt@csdgalbania.org',
      email_verified: false,
    });

    const res = makeResponse();
    await handleGoogleCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('/login?error=not_authorized');
    expect(dbMock.state.insertedAdmins).toHaveLength(0);
    expect(sessionMock.createSession).not.toHaveBeenCalled();
  });

  it('rejects a verified email that is neither csdg-domain nor allowlisted, creating no admin row', async () => {
    googleMock.exchangeGoogleCode.mockResolvedValue({
      email: 'random@gmail.com',
      email_verified: true,
    });
    dbMock.state.allowlistEmails = ['external-dev@gmail.com'];

    const res = makeResponse();
    await handleGoogleCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('/login?error=not_authorized');
    expect(dbMock.state.insertedAdmins).toHaveLength(0);
    expect(sessionMock.createSession).not.toHaveBeenCalled();
  });

  it('allows a verified csdg-domain email, creating the admin and starting a session', async () => {
    googleMock.exchangeGoogleCode.mockResolvedValue({
      email: 'DT@CSDGAlbania.ORG',
      email_verified: true,
    });

    const res = makeResponse();
    await handleGoogleCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(dbMock.state.insertedAdmins).toHaveLength(1);
    expect(dbMock.state.insertedAdmins[0]?.email).toBe('dt@csdgalbania.org');
    expect(sessionMock.createSession).toHaveBeenCalledWith(dbMock.state.insertedAdmins[0]?.id);
    expect(res.redirectedTo).toBe('/');
    expect(JSON.stringify(res.headers['Set-Cookie'])).toContain('tra_admin_session=');
  });

  it('allows an allowlisted non-csdg email and links to the existing admin row without re-creating it', async () => {
    googleMock.exchangeGoogleCode.mockResolvedValue({
      email: 'external-dev@gmail.com',
      email_verified: true,
    });
    dbMock.state.allowlistEmails = ['external-dev@gmail.com'];
    dbMock.state.adminUsers = [{ id: 'existing-admin-id', email: 'external-dev@gmail.com' }];

    const res = makeResponse();
    await handleGoogleCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(dbMock.state.insertedAdmins).toHaveLength(0);
    expect(sessionMock.createSession).toHaveBeenCalledWith('existing-admin-id');
    expect(res.redirectedTo).toBe('/');
  });
});
