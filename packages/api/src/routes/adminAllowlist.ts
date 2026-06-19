import { admin_allowlist, admin_users, db } from '@tra/db';
import { desc, eq } from 'drizzle-orm';
import type express from 'express';
import { Router } from 'express';
import { z } from 'zod';
import type { AdminSessionRequest } from '../middleware/requireAdminSession.js';

const AddAllowlistBodySchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(320) })
  .strict();

const UUIDSchema = z.string().uuid();

export const adminAllowlistRouter: express.Router = Router();

adminAllowlistRouter.get('/allowlist', async (_req, res) => {
  const [allowlist, admins] = await Promise.all([
    db
      .select({
        id: admin_allowlist.id,
        email: admin_allowlist.email,
        added_by: admin_allowlist.added_by,
        created_at: admin_allowlist.created_at,
      })
      .from(admin_allowlist)
      .orderBy(desc(admin_allowlist.created_at)),
    db
      .select({
        id: admin_users.id,
        email: admin_users.email,
        disabled_at: admin_users.disabled_at,
        created_at: admin_users.created_at,
      })
      .from(admin_users)
      .orderBy(desc(admin_users.created_at)),
  ]);

  res.json({ allowlist, admins });
});

adminAllowlistRouter.post('/allowlist', async (req, res) => {
  const parse = AddAllowlistBodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid body', details: parse.error.flatten() });
    return;
  }

  const addedBy = (req as AdminSessionRequest).admin?.user.id ?? null;
  await db
    .insert(admin_allowlist)
    .values({ email: parse.data.email, added_by: addedBy })
    .onConflictDoNothing({ target: admin_allowlist.email });

  res.json({ ok: true });
});

adminAllowlistRouter.delete('/allowlist/:id', async (req, res) => {
  const idParse = UUIDSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  await db.delete(admin_allowlist).where(eq(admin_allowlist.id, idParse.data));
  res.json({ ok: true });
});
