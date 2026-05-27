import * as Sentry from '@sentry/node';
import { createApp } from './app.js';
import { logger } from './logger.js';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
  });
}

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

const server = app.listen(port, () => {
  logger.info({ port }, 'API server started');
});

const shutdown = () => {
  logger.info('Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
