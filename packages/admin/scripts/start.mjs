function parsePort(rawPort) {
  const port = Number(rawPort ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
}

function validateRuntimeConfig(env = process.env) {
  parsePort(env.PORT);
  if (env.NODE_ENV !== 'production') return;

  const configured = env.ADMIN_API_BASE_URL?.trim();
  if (!configured) throw new Error('ADMIN_API_BASE_URL is required in production');

  const url = new URL(configured);
  if (url.protocol !== 'https:') {
    throw new Error('ADMIN_API_BASE_URL must use https in production');
  }
}

try {
  validateRuntimeConfig();
  await import('../dist/server/entry.mjs');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`[admin] startup failed: ${message}`);
  process.exit(1);
}
