import { describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const state = {
    existingId: undefined as string | undefined,
    insertValues: [] as unknown[],
    updateValues: [] as unknown[],
  };

  const selectLimit = vi.fn(async () => (state.existingId ? [{ id: state.existingId }] : []));
  const select = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: selectLimit,
      }),
    }),
  }));
  const insertValues = vi.fn(async (values: unknown) => {
    state.insertValues.push(values);
  });
  const insert = vi.fn(() => ({ values: insertValues }));
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn((values: unknown) => {
    state.updateValues.push(values);
    return { where: updateWhere };
  });
  const update = vi.fn(() => ({ set: updateSet }));

  const reset = () => {
    state.existingId = undefined;
    state.insertValues.length = 0;
    state.updateValues.length = 0;
    select.mockClear();
    selectLimit.mockClear();
    insert.mockClear();
    insertValues.mockClear();
    update.mockClear();
    updateSet.mockClear();
    updateWhere.mockClear();
  };

  return {
    db: { select, insert, update },
    reset,
    state,
  };
});

const hashMock = vi.hoisted(() => vi.fn(async () => 'argon2id-hash'));

vi.mock('@node-rs/argon2', () => ({
  Algorithm: { Argon2id: 2 },
  hash: hashMock,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
}));

vi.mock('@tra/db', () => ({
  admin_users: {
    id: 'admin_users.id',
    email: 'admin_users.email',
  },
  db: dbMock.db,
}));

import {
  assertDevDatabase,
  createAdminUser,
  normalizeEmail,
  parseCreateAdminArgs,
} from './create-admin.js';

describe('create-admin script helpers', () => {
  it('normalizes email and parses reset flag', () => {
    expect(normalizeEmail(' Admin@Example.COM ')).toBe('admin@example.com');
    expect(parseCreateAdminArgs(['--email', 'Admin@Example.COM', '--reset'])).toEqual({
      email: 'admin@example.com',
      reset: true,
    });
    expect(parseCreateAdminArgs(['--email=Admin@Example.COM'])).toEqual({
      email: 'admin@example.com',
      reset: false,
    });
  });

  it('rejects non-local database URLs', () => {
    expect(() => assertDevDatabase('postgresql://tra:tra_dev@localhost:5432/tra')).not.toThrow();
    expect(() => assertDevDatabase('postgresql://tra:tra_dev@127.0.0.1:5432/tra')).not.toThrow();
    expect(() => assertDevDatabase('postgresql://tra:tra_dev@postgres:5432/tra')).not.toThrow();
    expect(() => assertDevDatabase('postgresql://tra:tra_dev@db.example.com:5432/tra')).toThrow(
      /DEV-only/,
    );
  });

  it('creates a new admin user with a hashed password', async () => {
    dbMock.reset();

    const result = await createAdminUser({
      email: 'Admin@Example.COM',
      password: 'long-password',
      reset: false,
    });

    expect(result).toBe('created');
    expect(hashMock).toHaveBeenCalledWith(
      'long-password',
      expect.objectContaining({ algorithm: 2 }),
    );
    expect(dbMock.state.insertValues).toHaveLength(1);
    expect(dbMock.state.insertValues[0]).toMatchObject({
      email: 'admin@example.com',
      password_hash: 'argon2id-hash',
    });
    expect(dbMock.state.updateValues).toEqual([]);
  });

  it('refuses to overwrite an existing admin without reset', async () => {
    dbMock.reset();
    dbMock.state.existingId = 'admin-1';

    const result = await createAdminUser({
      email: 'admin@example.com',
      password: 'long-password',
      reset: false,
    });

    expect(result).toBe('exists');
    expect(dbMock.state.insertValues).toEqual([]);
    expect(dbMock.state.updateValues).toEqual([]);
  });

  it('resets only the password hash when reset is explicit', async () => {
    dbMock.reset();
    dbMock.state.existingId = 'admin-1';

    const result = await createAdminUser({
      email: 'admin@example.com',
      password: 'long-password',
      reset: true,
    });

    expect(result).toBe('reset');
    expect(dbMock.state.insertValues).toEqual([]);
    expect(dbMock.state.updateValues).toEqual([{ password_hash: 'argon2id-hash' }]);
  });
});
