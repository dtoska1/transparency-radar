import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { serve } from 'inngest/express';
import multer from 'multer';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';
import { inngest } from './inngest.js';
import { logger } from './logger.js';
import { requireAdmin } from './middleware/requireAdmin.js';
import { adminRouter } from './routes/admin.js';
import { createAdminAuthRouter } from './routes/adminAuth.js';
import { publicRouter } from './routes/public.js';

// Default-deny: if CORS_ORIGINS is unset, allowedOrigins is empty and all origins are blocked.
const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);

const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const adminAuthLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow requests without an Origin header (server-to-server, curl).
        if (!origin) return cb(null, false);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger }));

  // Admin router first — must precede publicRouter to prevent GET /:vertical
  // from capturing /api/admin/* as vertical='admin'.
  app.use('/api/admin/auth', adminAuthLimiter, createAdminAuthRouter());
  app.use('/api/admin', adminLimiter, requireAdmin, adminRouter);

  app.use('/api', publicLimiter, publicRouter);

  app.get('/api/v1/health', (_req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
    });
  });

  app.use(
    '/api/inngest',
    serve({
      client: inngest,
      functions: [],
    }),
  );

  // Central error handler — no stack traces to client
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File too large (max 50 MB)' });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.flatten() });
      return;
    }
    logger.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
