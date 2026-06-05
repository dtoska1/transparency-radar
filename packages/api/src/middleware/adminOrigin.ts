import type { NextFunction, Request, RequestHandler, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function adminOriginCheck(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.headers.origin;
    if (!origin || allowed.has(origin)) {
      next();
      return;
    }

    res.status(403).json({ error: 'Forbidden' });
  };
}
