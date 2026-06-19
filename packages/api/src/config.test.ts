import { describe, expect, it } from 'vitest';
import { getAllowedOrigins, validateApiRuntimeConfig } from './config.js';

const validProductionEnv = {
  ADMIN_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  CORS_ORIGINS: 'https://admin.radarivendor.com',
  DATABASE_URL: 'postgresql://user:password@example.neon.tech/tra',
  GOOGLE_CLIENT_ID: 'client-id-123',
  GOOGLE_CLIENT_SECRET: 'client-secret-456',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://admin.radarivendor.com/api/admin/auth/google/callback',
  NODE_ENV: 'production',
  PORT: '8080',
  STORAGE_ADAPTER: 'local',
  STORAGE_LOCAL_PATH: '/app/uploads',
  TRUST_PROXY_HOPS: '2',
};

describe('API runtime config', () => {
  it('accepts the complete production configuration', () => {
    expect(validateApiRuntimeConfig(validProductionEnv)).toEqual({
      allowedOrigins: ['https://admin.radarivendor.com'],
      port: 8080,
      trustProxyHops: 2,
    });
  });

  it.each([
    'ADMIN_SESSION_SECRET',
    'CORS_ORIGINS',
    'DATABASE_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_OAUTH_REDIRECT_URI',
    'STORAGE_ADAPTER',
    'STORAGE_LOCAL_PATH',
    'TRUST_PROXY_HOPS',
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

  it('parses valid trust proxy hop counts', () => {
    expect(
      validateApiRuntimeConfig({
        ...validProductionEnv,
        TRUST_PROXY_HOPS: '0',
      }).trustProxyHops,
    ).toBe(0);
    expect(
      validateApiRuntimeConfig({
        ...validProductionEnv,
        TRUST_PROXY_HOPS: '10',
      }).trustProxyHops,
    ).toBe(10);
  });

  it.each(['1.5', '-1', '11', 'not-a-number'])(
    'rejects invalid TRUST_PROXY_HOPS=%s',
    (trustProxyHops) => {
      expect(() =>
        validateApiRuntimeConfig({
          ...validProductionEnv,
          TRUST_PROXY_HOPS: trustProxyHops,
        }),
      ).toThrow('TRUST_PROXY_HOPS must be an integer between 0 and 10');
    },
  );

  it('defaults trust proxy hops in non-production', () => {
    expect(
      validateApiRuntimeConfig({
        CORS_ORIGINS: 'http://localhost:4321',
        NODE_ENV: 'development',
      }),
    ).toMatchObject({
      trustProxyHops: 1,
    });
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
