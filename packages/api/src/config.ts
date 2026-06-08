import { assertAdminSessionSecret } from './auth/config.js';

const SUPPORTED_STORAGE_ADAPTER = 'local';

export interface ApiRuntimeConfig {
  allowedOrigins: string[];
  port: number;
}

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in production`);
  return value;
}

function parsePort(rawPort: string | undefined): number {
  const port = Number(rawPort ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseAllowedOrigins(rawOrigins: string): string[] {
  const origins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) throw new Error('CORS_ORIGINS must contain at least one origin');

  for (const origin of origins) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) {
      throw new Error('CORS_ORIGINS must contain HTTPS origins without paths');
    }
  }

  return origins;
}

export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const rawOrigins = env.CORS_ORIGINS ?? '';
  if (env.NODE_ENV !== 'production') {
    return rawOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return parseAllowedOrigins(requireValue(env, 'CORS_ORIGINS'));
}

export function validateApiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ApiRuntimeConfig {
  const port = parsePort(env.PORT);

  if (env.NODE_ENV !== 'production') {
    return { allowedOrigins: getAllowedOrigins(env), port };
  }

  const databaseUrl = new URL(requireValue(env, 'DATABASE_URL'));
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('DATABASE_URL must use postgres or postgresql');
  }

  assertAdminSessionSecret(env);

  const storageAdapter = requireValue(env, 'STORAGE_ADAPTER');
  if (storageAdapter !== SUPPORTED_STORAGE_ADAPTER) {
    throw new Error(`STORAGE_ADAPTER must be ${SUPPORTED_STORAGE_ADAPTER}`);
  }
  requireValue(env, 'STORAGE_LOCAL_PATH');

  return {
    allowedOrigins: getAllowedOrigins(env),
    port,
  };
}
