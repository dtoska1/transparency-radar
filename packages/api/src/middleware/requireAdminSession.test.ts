import type { NextFunction, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const validateSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../auth/session.js', () => ({
  validateSession: validateSessionMock,
}));

import { requireAdminSession } from './requireAdminSession.js';
import type { AdminSessionRequest } from './requireAdminSession.js';

function makeRequest(cookie?: string): AdminSessionRequest {
  return {
    headers: { cookie },
  } as unknown as AdminSessionRequest;
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

describe('requireAdminSession', () => {
  beforeEach(() => {
    validateSessionMock.mockReset();
  });

  it('attaches valid admin session metadata, refreshes the cookie, and calls next', async () => {
    const auth = {
      session: {
        id: 'hashed-session-token',
        userId: 'admin-1',
        createdAt: new Date('2026-06-05T12:00:00.000Z'),
        expiresAt: new Date('2026-06-05T20:00:00.000Z'),
      },
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
      },
      cookieExpiresAt: new Date('2026-06-05T20:00:00.000Z'),
    };
    validateSessionMock.mockResolvedValue(auth);
    const req = makeRequest('tra_admin_session=raw-session-token');
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    await requireAdminSession(req, res, next);

    expect(validateSessionMock).toHaveBeenCalledWith('raw-session-token');
    expect(req.admin).toBe(auth);
    expect(res.statusCode).toBeUndefined();
    expect(res.body).toBeUndefined();
    expect(res.headers['Set-Cookie']).toContain('tra_admin_session=raw-session-token');
    expect(res.headers['Set-Cookie']).toContain('Path=/');
    expect(res.headers['Set-Cookie']).toContain('HttpOnly');
    expect(res.headers['Set-Cookie']).toContain('Secure');
    expect(res.headers['Set-Cookie']).toContain('SameSite=Strict');
    expect(next).toHaveBeenCalledOnce();
  });

  it('clears cookie and returns sanitized 401 when cookie is missing', async () => {
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    await requireAdminSession(req, res, next);

    expect(validateSessionMock).not.toHaveBeenCalled();
    expect(req.admin).toBeUndefined();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(res.headers['Set-Cookie']).toContain('tra_admin_session=');
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
    expect(next).not.toHaveBeenCalled();
  });

  it('clears cookie and returns sanitized 401 when session is invalid or expired', async () => {
    validateSessionMock.mockResolvedValue(null);
    const req = makeRequest('tra_admin_session=expired-token');
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    await requireAdminSession(req, res, next);

    expect(validateSessionMock).toHaveBeenCalledWith('expired-token');
    expect(req.admin).toBeUndefined();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(res.headers['Set-Cookie']).toContain('tra_admin_session=');
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
    expect(next).not.toHaveBeenCalled();
  });
});
