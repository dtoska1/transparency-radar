import * as Sentry from '@sentry/node';
import { validateApiRuntimeConfig } from './config.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  const { port } = validateApiRuntimeConfig();

  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
    });
  }

  const { createApp } = await import('./app.js');
  const app = createApp();

  const server = app.listen(port, '0.0.0.0', () => {
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
}

main().catch((error: unknown) => {
  logger.fatal(error instanceof Error ? error.message : 'API startup failed');
  process.exit(1);
});
