import { describe, expect, it } from 'vitest';
import { getAllowedOrigins, validateApiRuntimeConfig } from './config.js';

const validProductionEnv = {
  ADMIN_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  CORS_ORIGINS: 'https://admin.radarivendor.com',
  DATABASE_URL: 'postgresql://user:password@example.neon.tech/tra',
  NODE_ENV: 'production',
  PORT: '8080',
  STORAGE_ADAPTER: 'local',
  STORAGE_LOCAL_PATH: '/app/uploads',
};

describe('API runtime config', () => {
  it('accepts the complete production configuration', () => {
    expect(validateApiRuntimeConfig(validProductionEnv)).toEqual({
      allowedOrigins: ['https://admin.radarivendor.com'],
      port: 8080,
    });
  });

  it.each([
    'ADMIN_SESSION_SECRET',
    'CORS_ORIGINS',
    'DATABASE_URL',
    'STORAGE_ADAPTER',
    'STORAGE_LOCAL_PATH',
  ] as const)('fails closed when %s is missing in production', (name) => {
    const env = { ...validProductionEnv };
    delete env[name];
    expect(() => validateApiRuntimeConfig(env)).toThrow();
  });

  it('requires HTTPS origin values in production', () => {
    expect(() =>
      validateApiRuntimeConfig({
        ...validProductionEnv,
        CORS_ORIGINS: 'http://admin.radarivendor.com',
      }),
    ).toThrow('HTTPS origins');
  });

  it('keeps local development origin parsing permissive', () => {
    expect(
      getAllowedOrigins({
        CORS_ORIGINS: ' http://localhost:4321, http://localhost:5173 ',
        NODE_ENV: 'development',
      }),
    ).toEqual(['http://localhost:4321', 'http://localhost:5173']);
  });
});
