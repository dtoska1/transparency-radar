import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiRuntimeConfig } from './config.js';

let createApp: (config?: ApiRuntimeConfig) => Express;

describe('API runtime', () => {
  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://tra:tra_dev@localhost:5432/tra');
    vi.stubEnv('ADMIN_SESSION_SECRET', '0123456789abcdef0123456789abcdef');
    ({ createApp } = await import('./app.js'));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('sets trust proxy to the configured exact hop count', () => {
    const app = createApp({
      allowedOrigins: [],
      port: 3000,
      trustProxyHops: 2,
    });
    const trustProxy = app.get('trust proxy fn') as (address: string, index: number) => boolean;

    expect(app.get('trust proxy')).toBe(2);
    expect(trustProxy('10.0.0.1', 0)).toBe(true);
    expect(trustProxy('10.0.0.2', 1)).toBe(true);
    expect(trustProxy('10.0.0.3', 2)).toBe(false);
  });
});
