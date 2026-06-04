import { describe, expect, it, vi } from 'vitest';

vi.mock('@tra/db', () => ({
  admin_sessions: {
    id: 'admin_sessions.id',
    user_id: 'admin_sessions.user_id',
    created_at: 'admin_sessions.created_at',
    expires_at: 'admin_sessions.expires_at',
  },
  admin_users: {
    id: 'admin_users.id',
    email: 'admin_users.email',
    disabled_at: 'admin_users.disabled_at',
  },
  db: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
}));

import {
  type AdminSessionRecord,
  type AdminSessionStore,
  createSessionWithStore,
  hashSessionToken,
  validateSessionWithStore,
} from './session.js';

function makeStore(record: AdminSessionRecord | null): AdminSessionStore & {
  inserted: unknown[];
  updated: unknown[];
  deleted: string[];
} {
  return {
    inserted: [],
    updated: [],
    deleted: [],
    async insertSession(value) {
      this.inserted.push(value);
    },
    async findSession() {
      return record;
    },
    async updateSessionExpiresAt(sessionId, expiresAt) {
      this.updated.push({ sessionId, expiresAt });
    },
    async deleteSession(sessionId) {
      this.deleted.push(sessionId);
    },
  };
}

describe('admin sessions', () => {
  const now = new Date('2026-06-05T12:00:00.000Z');
  const token = 'raw-session-token';
  const sessionId = hashSessionToken(token);

  it('creates sessions using only a lowercase sha256 token hash as id', async () => {
    const store = makeStore(null);

    const result = await createSessionWithStore(store, 'user-1', now, token);

    expect(result).toEqual({
      token,
      sessionId,
      expiresAt: new Date('2026-06-05T20:00:00.000Z'),
    });
    expect(store.inserted).toEqual([
      {
        id: sessionId,
        userId: 'user-1',
        createdAt: now,
        expiresAt: new Date('2026-06-05T20:00:00.000Z'),
      },
    ]);
    expect(sessionId).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionId).not.toContain(token);
  });

  it('accepts a valid session and refreshes idle expiry without exceeding absolute expiry', async () => {
    const store = makeStore({
      id: sessionId,
      userId: 'user-1',
      userEmail: 'admin@example.com',
      userDisabledAt: null,
      createdAt: new Date('2026-06-05T11:00:00.000Z'),
      expiresAt: new Date('2026-06-05T13:00:00.000Z'),
    });

    const result = await validateSessionWithStore(store, token, now);

    expect(result).toMatchObject({
      user: { id: 'user-1', email: 'admin@example.com' },
      cookieExpiresAt: new Date('2026-06-05T20:00:00.000Z'),
    });
    expect(store.updated).toEqual([
      {
        sessionId,
        expiresAt: new Date('2026-06-05T20:00:00.000Z'),
      },
    ]);
    expect(store.deleted).toEqual([]);
  });

  it('caps refreshed idle expiry at the absolute max lifetime', async () => {
    const store = makeStore({
      id: sessionId,
      userId: 'user-1',
      userEmail: 'admin@example.com',
      userDisabledAt: null,
      createdAt: new Date('2026-06-04T13:00:00.000Z'),
      expiresAt: new Date('2026-06-05T13:00:00.000Z'),
    });

    const result = await validateSessionWithStore(store, token, now);

    expect(result?.cookieExpiresAt).toEqual(new Date('2026-06-05T13:00:00.000Z'));
    expect(store.updated).toEqual([
      {
        sessionId,
        expiresAt: new Date('2026-06-05T13:00:00.000Z'),
      },
    ]);
  });

  it('rejects unknown, idle-expired, absolute-expired, and disabled sessions', async () => {
    await expect(validateSessionWithStore(makeStore(null), token, now)).resolves.toBeNull();

    const idleExpired = makeStore({
      id: sessionId,
      userId: 'user-1',
      userEmail: 'admin@example.com',
      userDisabledAt: null,
      createdAt: new Date('2026-06-05T10:00:00.000Z'),
      expiresAt: now,
    });
    await expect(validateSessionWithStore(idleExpired, token, now)).resolves.toBeNull();
    expect(idleExpired.deleted).toEqual([sessionId]);

    const absoluteExpired = makeStore({
      id: sessionId,
      userId: 'user-1',
      userEmail: 'admin@example.com',
      userDisabledAt: null,
      createdAt: new Date('2026-06-04T12:00:00.000Z'),
      expiresAt: new Date('2026-06-05T13:00:00.000Z'),
    });
    await expect(validateSessionWithStore(absoluteExpired, token, now)).resolves.toBeNull();
    expect(absoluteExpired.deleted).toEqual([sessionId]);

    const disabled = makeStore({
      id: sessionId,
      userId: 'user-1',
      userEmail: 'admin@example.com',
      userDisabledAt: new Date('2026-06-05T11:00:00.000Z'),
      createdAt: new Date('2026-06-05T10:00:00.000Z'),
      expiresAt: new Date('2026-06-05T13:00:00.000Z'),
    });
    await expect(validateSessionWithStore(disabled, token, now)).resolves.toBeNull();
    expect(disabled.deleted).toEqual([sessionId]);
  });
});
