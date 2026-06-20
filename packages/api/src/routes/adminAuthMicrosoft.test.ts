import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_ID = '11111111-2222-3333-4444-555555555555';

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

const microsoftMock = vi.hoisted(() => ({
  createMicrosoftAuthorizationURL: vi.fn(),
  exchangeMicrosoftCode: vi.fn(),
  assertMicrosoftOAuthConfig: vi.fn(() => ({
    tenantId: '11111111-2222-3333-4444-555555555555',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://api.radarvendor.com/api/admin/auth/microsoft/callback',
  })),
}));
vi.mock('../auth/microsoft.js', () => microsoftMock);

const sessionMock = vi.hoisted(() => ({
  createSession: vi.fn(async (userId: string) => ({
    token: `token-for-${userId}`,
    sessionId: `session-for-${userId}`,
    expiresAt: new Date('2026-06-19T00:00:00.000Z'),
  })),
}));
vi.mock('../auth/session.js', () => sessionMock);

import { handleMicrosoftCallback, handleMicrosoftStart } from './adminAuthMicrosoft.js';

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

describe('handleMicrosoftStart', () => {
  beforeEach(() => {
    dbMock.reset();
    vi.clearAllMocks();
  });

  it('redirects to the Microsoft authorization URL and sets the state cookie', () => {
    microsoftMock.createMicrosoftAuthorizationURL.mockReturnValue({
      url: new URL(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?foo=bar`),
      state: 'the-state',
      codeVerifier: 'the-code-verifier',
    });

    const res = makeResponse();
    handleMicrosoftStart(makeRequest(), res, vi.fn());

    expect(res.redirectedTo).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?foo=bar`,
    );
    expect(res.headers['Set-Cookie']).toContain('tra_admin_oauth=');
  });

  it('responds 500 without redirecting when Microsoft OAuth is not configured', () => {
    microsoftMock.createMicrosoftAuthorizationURL.mockImplementation(() => {
      throw new Error('MICROSOFT_CLIENT_ID is required for Microsoft OAuth');
    });

    const res = makeResponse();
    handleMicrosoftStart(makeRequest(), res, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(res.redirectedTo).toBeUndefined();
  });
});

describe('handleMicrosoftCallback', () => {
  const stateCookie = 'tra_admin_oauth=the-state.the-code-verifier';

  beforeEach(() => {
    dbMock.reset();
    vi.clearAllMocks();
    microsoftMock.assertMicrosoftOAuthConfig.mockReturnValue({
      tenantId: TENANT_ID,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://api.radarvendor.com/api/admin/auth/microsoft/callback',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects when the query state does not match the cookie state, without exchanging the code', async () => {
    const res = makeResponse();
    await handleMicrosoftCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'wrong-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('/login?error=not_authorized');
    expect(microsoftMock.exchangeMicrosoftCode).not.toHaveBeenCalled();
    expect(dbMock.state.insertedAdmins).toHaveLength(0);
  });

  it('rejects a tenant mismatch after exchange, creating no admin row', async () => {
    microsoftMock.exchangeMicrosoftCode.mockResolvedValue({
      email: 'dt@csdgalbania.org',
      tid: 'different-tenant-id',
    });

    const res = makeResponse();
    await handleMicrosoftCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(microsoftMock.exchangeMicrosoftCode).toHaveBeenCalled();
    expect(res.redirectedTo).toBe('/login?error=not_authorized');
    expect(dbMock.state.insertedAdmins).toHaveLength(0);
    expect(sessionMock.createSession).not.toHaveBeenCalled();
  });

  it('rejects when email_verified is explicitly false, creating no admin row', async () => {
    microsoftMock.exchangeMicrosoftCode.mockResolvedValue({
      email: 'dt@csdgalbania.org',
      tid: TENANT_ID,
      email_verified: false,
    });

    const res = makeResponse();
    await handleMicrosoftCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('/login?error=not_authorized');
    expect(dbMock.state.insertedAdmins).toHaveLength(0);
    expect(sessionMock.createSession).not.toHaveBeenCalled();
  });

  it('rejects when email_verified is absent (not just when explicitly false), creating no admin row', async () => {
    microsoftMock.exchangeMicrosoftCode.mockResolvedValue({
      email: 'dt@csdgalbania.org',
      tid: TENANT_ID,
    });

    const res = makeResponse();
    await handleMicrosoftCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('/login?error=not_authorized');
    expect(dbMock.state.insertedAdmins).toHaveLength(0);
    expect(sessionMock.createSession).not.toHaveBeenCalled();
  });

  it('rejects claims with neither email nor a usable preferred_username', async () => {
    microsoftMock.exchangeMicrosoftCode.mockResolvedValue({
      tid: TENANT_ID,
      preferred_username: 'not-an-email',
      email_verified: true,
    });

    const res = makeResponse();
    await handleMicrosoftCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('/login?error=not_authorized');
    expect(dbMock.state.insertedAdmins).toHaveLength(0);
  });

  it('rejects a verified, correct-tenant email that is neither csdg-domain nor allowlisted', async () => {
    microsoftMock.exchangeMicrosoftCode.mockResolvedValue({
      email: 'random@gmail.com',
      tid: TENANT_ID,
      email_verified: true,
    });
    dbMock.state.allowlistEmails = ['external-dev@gmail.com'];

    const res = makeResponse();
    await handleMicrosoftCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('/login?error=not_authorized');
    expect(dbMock.state.insertedAdmins).toHaveLength(0);
    expect(sessionMock.createSession).not.toHaveBeenCalled();
  });

  it('allows a csdg-domain email in the correct tenant, creating the admin and starting a session', async () => {
    microsoftMock.exchangeMicrosoftCode.mockResolvedValue({
      email: 'DT@CSDGAlbania.ORG',
      tid: TENANT_ID,
      email_verified: true,
    });

    const res = makeResponse();
    await handleMicrosoftCallback(
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

  it('falls back to preferred_username when no email claim is present', async () => {
    microsoftMock.exchangeMicrosoftCode.mockResolvedValue({
      preferred_username: 'dt@csdgalbania.org',
      tid: TENANT_ID,
      email_verified: true,
    });

    const res = makeResponse();
    await handleMicrosoftCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(dbMock.state.insertedAdmins).toHaveLength(1);
    expect(dbMock.state.insertedAdmins[0]?.email).toBe('dt@csdgalbania.org');
    expect(res.redirectedTo).toBe('/');
  });

  it('allows an allowlisted non-csdg email in the correct tenant, linking the existing admin row', async () => {
    microsoftMock.exchangeMicrosoftCode.mockResolvedValue({
      email: 'external-dev@gmail.com',
      tid: TENANT_ID,
      email_verified: true,
    });
    dbMock.state.allowlistEmails = ['external-dev@gmail.com'];
    dbMock.state.adminUsers = [{ id: 'existing-admin-id', email: 'external-dev@gmail.com' }];

    const res = makeResponse();
    await handleMicrosoftCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'the-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(dbMock.state.insertedAdmins).toHaveLength(0);
    expect(sessionMock.createSession).toHaveBeenCalledWith('existing-admin-id');
    expect(res.redirectedTo).toBe('/');
  });

  it('redirects to the configured admin UI origin, not the API origin, on success', async () => {
    vi.stubEnv('CORS_ORIGINS', 'https://admin.radarvendor.com');
    vi.stubEnv('NODE_ENV', 'development');
    microsoftMock.exchangeMicrosoftCode.mockResolvedValue({
      email: 'dt@csdgalbania.org',
      tid: TENANT_ID,
      email_verified: true,
    });

    const res = makeResponse();
    await handleMicrosoftCallback(
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
    await handleMicrosoftCallback(
      makeRequest({ cookie: stateCookie, query: { state: 'wrong-state', code: 'abc' } }),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('https://admin.radarvendor.com/login?error=not_authorized');
  });
});
