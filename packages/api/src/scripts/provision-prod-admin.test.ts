import { describe, expect, it, vi } from 'vitest';

const hashMock = vi.hoisted(() => vi.fn(async () => 'argon2id-hash'));

vi.mock('@node-rs/argon2', () => ({
  hash: hashMock,
  verify: vi.fn(),
}));

import {
  PROD_PROVISION_OPT_IN,
  assertProductionProvisionTarget,
  normalizeProvisionEmail,
  provisionFirstAdmin,
} from './provision-prod-admin.js';

describe('production admin provisioning', () => {
  it('requires the exact opt-in flag and a Neon PostgreSQL host', () => {
    const valid = {
      TRA_ALLOW_PROD_ADMIN_PROVISION: PROD_PROVISION_OPT_IN,
      DATABASE_URL: 'postgresql://user:secret@ep-example.eu-central-1.aws.neon.tech/db',
    };

    expect(assertProductionProvisionTarget(valid).hostname).toBe(
      'ep-example.eu-central-1.aws.neon.tech',
    );
    expect(() =>
      assertProductionProvisionTarget({
        ...valid,
        TRA_ALLOW_PROD_ADMIN_PROVISION: 'yes',
      }),
    ).toThrow(/exact explicit opt-in/);
    expect(() =>
      assertProductionProvisionTarget({
        ...valid,
        DATABASE_URL: 'postgresql://tra:tra_dev@localhost:5432/tra',
      }),
    ).toThrow(/Neon PostgreSQL host/);
    expect(() =>
      assertProductionProvisionTarget({
        ...valid,
        DATABASE_URL: 'postgresql://user:secret@neon.tech.evil.example/db',
      }),
    ).toThrow(/Neon PostgreSQL host/);
  });

  it('normalizes the administrator email', () => {
    expect(normalizeProvisionEmail(' Admin@Example.COM ')).toBe('admin@example.com');
    expect(() => normalizeProvisionEmail('not-an-email')).toThrow(/valid admin email/);
  });

  it('hashes with the application Argon2id parameters and inserts exactly once', async () => {
    const insertIfEmpty = vi.fn(async () => true);

    await provisionFirstAdmin(
      { email: 'Admin@Example.COM', password: 'long-password' },
      { insertIfEmpty },
    );

    expect(hashMock).toHaveBeenCalledWith(
      'long-password',
      expect.objectContaining({
        algorithm: 2,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      }),
    );
    expect(insertIfEmpty).toHaveBeenCalledOnce();
    expect(insertIfEmpty).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@example.com',
        password_hash: 'argon2id-hash',
      }),
    );
  });

  it('refuses to provision when any administrator already exists', async () => {
    const insertIfEmpty = vi.fn(async () => false);

    await expect(
      provisionFirstAdmin(
        { email: 'admin@example.com', password: 'long-password' },
        { insertIfEmpty },
      ),
    ).rejects.toThrow(/already exists/);
    expect(insertIfEmpty).toHaveBeenCalledOnce();
  });
});
