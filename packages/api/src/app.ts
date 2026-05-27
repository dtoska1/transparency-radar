import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { serve } from 'inngest/express';
import { pinoHttp } from 'pino-http';
import { inngest } from './inngest.js';
import { logger } from './logger.js';

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',');

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(pinoHttp({ logger }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

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

  return app;
}
