const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', 'postgres']);

export function assertDevDatabase(
  databaseUrl = process.env.DATABASE_URL,
  scraperName = 'this scraper',
): void {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  let hostname = '';
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (!LOCAL_DATABASE_HOSTS.has(hostname)) {
    throw new Error(`${scraperName} is DEV-only; refusing non-local DATABASE_URL host`);
  }
}
