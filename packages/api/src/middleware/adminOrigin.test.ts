import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminOriginCheck } from './adminOrigin.js';

function makeRequest(method: string, origin?: string): Request {
  return {
    method,
    headers: { origin },
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

describe('adminOriginCheck', () => {
  const check = adminOriginCheck(['http://localhost:5173']);
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn() as NextFunction;
  });

  it('allows safe methods regardless of Origin', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const res = makeResponse();
      check(makeRequest(method, 'https://evil.example'), res, next);
      expect(res.statusCode).toBeUndefined();
    }

    expect(next).toHaveBeenCalledTimes(3);
  });

  it('allows non-safe requests with no Origin', () => {
    const res = makeResponse();

    check(makeRequest('POST'), res, next);

    expect(res.statusCode).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('allows non-safe requests with an allow-listed Origin', () => {
    const res = makeResponse();

    check(makeRequest('POST', 'http://localhost:5173'), res, next);

    expect(res.statusCode).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects non-safe requests with a generic 403 for mismatched Origin', () => {
    const res = makeResponse();

    check(makeRequest('POST', 'https://evil.example'), res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
    expect(JSON.stringify(res.body)).not.toContain('evil.example');
    expect(JSON.stringify(res.body)).not.toContain('localhost:5173');
    expect(next).not.toHaveBeenCalled();
  });
});
