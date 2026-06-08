import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let AZURE_APP_SERVICE_PROXY_HOPS: number;
let createApp: () => Express;

describe('API Azure runtime', () => {
  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://tra:tra_dev@localhost:5432/tra');
    vi.stubEnv('ADMIN_SESSION_SECRET', '0123456789abcdef0123456789abcdef');
    ({ AZURE_APP_SERVICE_PROXY_HOPS, createApp } = await import('./app.js'));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('trusts exactly the direct App Service proxy hop', () => {
    const app = createApp();
    const trustProxy = app.get('trust proxy fn') as (address: string, index: number) => boolean;

    expect(AZURE_APP_SERVICE_PROXY_HOPS).toBe(1);
    expect(trustProxy('10.0.0.1', 0)).toBe(true);
    expect(trustProxy('10.0.0.2', 1)).toBe(false);
  });
});
