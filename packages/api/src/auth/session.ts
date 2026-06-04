import { createHash, randomBytes } from 'node:crypto';
import { admin_sessions, admin_users, db } from '@tra/db';
import { eq } from 'drizzle-orm';
import { ADMIN_SESSION_ABSOLUTE_TIMEOUT_MS, ADMIN_SESSION_IDLE_TIMEOUT_MS } from './config.js';

export interface AdminSessionRecord {
  id: string;
  userId: string;
  userEmail: string;
  userDisabledAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface AdminSessionStore {
  insertSession(record: {
    id: string;
    userId: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void>;
  findSession(sessionId: string): Promise<AdminSessionRecord | null>;
  updateSessionExpiresAt(sessionId: string, expiresAt: Date): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}

export interface CreatedAdminSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export interface ValidAdminSession {
  session: {
    id: string;
    userId: string;
    createdAt: Date;
    expiresAt: Date;
  };
  user: {
    id: string;
    email: string;
  };
  cookieExpiresAt: Date;
}

export const dbAdminSessionStore: AdminSessionStore = {
  async insertSession(record) {
    await db.insert(admin_sessions).values({
      id: record.id,
      user_id: record.userId,
      created_at: record.createdAt,
      expires_at: record.expiresAt,
    });
  },

  async findSession(sessionId) {
    const [row] = await db
      .select({
        id: admin_sessions.id,
        userId: admin_sessions.user_id,
        userEmail: admin_users.email,
        userDisabledAt: admin_users.disabled_at,
        createdAt: admin_sessions.created_at,
        expiresAt: admin_sessions.expires_at,
      })
      .from(admin_sessions)
      .innerJoin(admin_users, eq(admin_sessions.user_id, admin_users.id))
      .where(eq(admin_sessions.id, sessionId))
      .limit(1);

    return row ?? null;
  },

  async updateSessionExpiresAt(sessionId, expiresAt) {
    await db
      .update(admin_sessions)
      .set({ expires_at: expiresAt })
      .where(eq(admin_sessions.id, sessionId));
  },

  async deleteSession(sessionId) {
    await db.delete(admin_sessions).where(eq(admin_sessions.id, sessionId));
  },
};

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

export async function createSessionWithStore(
  store: AdminSessionStore,
  userId: string,
  now = new Date(),
  token = generateSessionToken(),
): Promise<CreatedAdminSession> {
  const sessionId = hashSessionToken(token);
  const expiresAt = addMs(now, ADMIN_SESSION_IDLE_TIMEOUT_MS);

  await store.insertSession({
    id: sessionId,
    userId,
    createdAt: now,
    expiresAt,
  });

  return { token, sessionId, expiresAt };
}

export function createSession(userId: string, now = new Date()): Promise<CreatedAdminSession> {
  return createSessionWithStore(dbAdminSessionStore, userId, now);
}

export async function validateSessionWithStore(
  store: AdminSessionStore,
  rawToken: string,
  now = new Date(),
): Promise<ValidAdminSession | null> {
  if (!rawToken) return null;

  const sessionId = hashSessionToken(rawToken);
  const record = await store.findSession(sessionId);
  if (!record) return null;

  const absoluteExpiresAt = addMs(record.createdAt, ADMIN_SESSION_ABSOLUTE_TIMEOUT_MS);
  const expired =
    record.userDisabledAt !== null ||
    now.getTime() >= record.expiresAt.getTime() ||
    now.getTime() >= absoluteExpiresAt.getTime();

  if (expired) {
    await store.deleteSession(sessionId);
    return null;
  }

  const refreshedExpiresAt = minDate(addMs(now, ADMIN_SESSION_IDLE_TIMEOUT_MS), absoluteExpiresAt);
  await store.updateSessionExpiresAt(sessionId, refreshedExpiresAt);

  return {
    session: {
      id: record.id,
      userId: record.userId,
      createdAt: record.createdAt,
      expiresAt: refreshedExpiresAt,
    },
    user: {
      id: record.userId,
      email: record.userEmail,
    },
    cookieExpiresAt: refreshedExpiresAt,
  };
}

export function validateSession(
  rawToken: string,
  now = new Date(),
): Promise<ValidAdminSession | null> {
  return validateSessionWithStore(dbAdminSessionStore, rawToken, now);
}

export async function invalidateSessionWithStore(
  store: AdminSessionStore,
  rawToken: string | undefined,
): Promise<void> {
  if (!rawToken) return;
  await store.deleteSession(hashSessionToken(rawToken));
}

export function invalidateSession(rawToken: string | undefined): Promise<void> {
  return invalidateSessionWithStore(dbAdminSessionStore, rawToken);
}
