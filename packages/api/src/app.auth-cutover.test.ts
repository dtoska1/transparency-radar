import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminOriginCheck } from './middleware/adminOrigin.js';

interface ChainResult {
  body: unknown;
  sessionGateCalls: number;
  statusCode: number | undefined;
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

function runAdminStack({
  authorization,
  cookie,
  method,
  origin,
}: {
  authorization?: string;
  cookie?: string;
  method: string;
  origin?: string;
}): ChainResult {
  let sessionGateCalls = 0;
  const req = {
    headers: { authorization, cookie, origin },
    method,
  } as unknown as Request;
  const res = makeResponse();

  const fakeSessionGate: RequestHandler = (request, response, next) => {
    sessionGateCalls += 1;
    if (request.headers.cookie?.includes('tra_admin_session=raw-token')) {
      next();
      return;
    }
    response.status(401).json({ error: 'Unauthorized' });
  };

  const adminHandler: RequestHandler = (_request, response) => {
    response.json({ data: [], limit: 1, offset: 0 });
  };

  adminOriginCheck(['http://localhost:5173'])(req, res, (() => {
    fakeSessionGate(req, res, (() => {
      adminHandler(req, res, vi.fn() as NextFunction);
    }) as NextFunction);
  }) as NextFunction);

  return {
    body: res.body,
    sessionGateCalls,
    statusCode: res.statusCode,
  };
}

describe('admin auth cutover route stack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects admin data routes without a valid session cookie', () => {
    const result = runAdminStack({ method: 'GET' });

    expect(result.statusCode).toBe(401);
    expect(result.body).toEqual({ error: 'Unauthorized' });
    expect(result.sessionGateCalls).toBe(1);
  });

  it('rejects old bearer token access without a session cookie', () => {
    const result = runAdminStack({
      authorization: 'Bearer old-admin-token',
      method: 'GET',
    });

    expect(result.statusCode).toBe(401);
    expect(result.body).toEqual({ error: 'Unauthorized' });
    expect(result.sessionGateCalls).toBe(1);
  });

  it('allows a valid session cookie to reach an admin data route', () => {
    const result = runAdminStack({
      cookie: 'tra_admin_session=raw-token',
      method: 'GET',
    });

    expect(result.statusCode).toBeUndefined();
    expect(result.body).toEqual({ data: [], limit: 1, offset: 0 });
    expect(result.sessionGateCalls).toBe(1);
  });

  it('returns the admin Origin middleware generic 403 for bogus-Origin non-GET requests', () => {
    const result = runAdminStack({
      cookie: 'tra_admin_session=raw-token',
      method: 'POST',
      origin: 'https://evil.example',
    });

    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: 'Forbidden' });
    expect(result.sessionGateCalls).toBe(0);
  });

  it('allows no-Origin non-GET requests through Origin middleware to the session gate', () => {
    const result = runAdminStack({ method: 'POST' });

    expect(result.statusCode).toBe(401);
    expect(result.body).toEqual({ error: 'Unauthorized' });
    expect(result.sessionGateCalls).toBe(1);
  });
});
