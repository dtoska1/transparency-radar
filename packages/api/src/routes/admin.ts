import { db } from '@tra/db';
import { audit_log, konsultime, municipalities, prokurime, vendime } from '@tra/db';
import { MUNICIPALITY_SLUGS, VERTICALS, type Vertical } from '@tra/shared';
import { and, eq, sql } from 'drizzle-orm';
import type express from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { handleBulkApprove } from './adminBulkApprove.js';
import { handleAdminCreate, upload } from './adminCreate.js';

const VerticalSchema = z.enum(VERTICALS);
const UUIDSchema = z.string().uuid();

const PendingQuerySchema = z.object({
  vertical: z.enum(VERTICALS).optional(),
  municipality: z.enum(MUNICIPALITY_SLUGS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const RejectBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export const adminRouter: express.Router = Router();

adminRouter.post('/:vertical', upload.single('file'), handleAdminCreate);

// Must be registered before /:vertical/:id routes — literal segment 'bulk-approve'
// won't collide (different path depth), but explicit ordering makes intent clear.
adminRouter.post('/:vertical/bulk-approve', handleBulkApprove);

adminRouter.get('/pending', async (req, res) => {
  const parse = PendingQuerySchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid query params', details: parse.error.flatten() });
    return;
  }

  const { vertical, municipality, limit, offset } = parse.data;
  const rows = await listPending(vertical, municipality, limit, offset);
  res.json({ data: rows, limit, offset });
});

adminRouter.post('/:vertical/:id/approve', async (req, res) => {
  const verticalParse = VerticalSchema.safeParse(req.params.vertical);
  if (!verticalParse.success) {
    res.status(400).json({ error: 'Invalid vertical' });
    return;
  }

  const idParse = UUIDSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const outcome = await approveRow(verticalParse.data, idParse.data);
  if (outcome === 'not_found') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (outcome === 'not_pending') {
    res.status(409).json({ error: 'Row is not in pending state' });
    return;
  }
  res.json({ ok: true });
});

adminRouter.post('/:vertical/:id/reject', async (req, res) => {
  const verticalParse = VerticalSchema.safeParse(req.params.vertical);
  if (!verticalParse.success) {
    res.status(400).json({ error: 'Invalid vertical' });
    return;
  }

  const idParse = UUIDSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const bodyParse = RejectBodySchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Invalid body', details: bodyParse.error.flatten() });
    return;
  }

  const outcome = await rejectRow(verticalParse.data, idParse.data, bodyParse.data.reason);
  if (outcome === 'not_found') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (outcome === 'not_pending') {
    res.status(409).json({ error: 'Row is not in pending state' });
    return;
  }
  res.json({ ok: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

type TransitionOutcome = 'ok' | 'not_found' | 'not_pending';

async function listPending(
  vertical: Vertical | undefined,
  municipality: string | undefined,
  limit: number,
  offset: number,
) {
  if (vertical) {
    return listPendingVertical(vertical, municipality, limit, offset);
  }
  // No vertical filter: query all three tables; limit/offset applied per-table.
  const results = await Promise.all(
    VERTICALS.map((v) => listPendingVertical(v, municipality, limit, offset)),
  );
  return results.flat();
}

async function listPendingVertical(
  vertical: Vertical,
  municipality: string | undefined,
  limit: number,
  offset: number,
) {
  switch (vertical) {
    case 'vendime':
      return listPendingVendime(municipality, limit, offset);
    case 'konsultime':
      return listPendingKonsultime(municipality, limit, offset);
    case 'prokurime':
      return listPendingProkurime(municipality, limit, offset);
  }
}

async function listPendingVendime(municipality: string | undefined, limit: number, offset: number) {
  const conditions = [eq(vendime.review_status, 'pending')];
  if (municipality) conditions.push(eq(municipalities.slug, municipality));

  const rows = await db
    .select({
      id: vendime.id,
      title: vendime.title,
      published_date: sql<string>`${vendime.published_date}::text`,
      municipality: municipalities.slug,
      source_origin: vendime.source_origin,
      source_url: vendime.source_url,
      review_status: vendime.review_status,
      collected_at: vendime.collected_at,
      created_at: vendime.created_at,
    })
    .from(vendime)
    .innerJoin(municipalities, eq(vendime.municipality_id, municipalities.id))
    .where(and(...conditions))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({ ...r, vertical: 'vendime' as const }));
}

async function listPendingKonsultime(
  municipality: string | undefined,
  limit: number,
  offset: number,
) {
  const conditions = [eq(konsultime.review_status, 'pending')];
  if (municipality) conditions.push(eq(municipalities.slug, municipality));

  const rows = await db
    .select({
      id: konsultime.id,
      title: konsultime.title,
      published_date: sql<string>`${konsultime.published_date}::text`,
      municipality: municipalities.slug,
      source_origin: konsultime.source_origin,
      source_url: konsultime.source_url,
      review_status: konsultime.review_status,
      collected_at: konsultime.collected_at,
      created_at: konsultime.created_at,
    })
    .from(konsultime)
    .innerJoin(municipalities, eq(konsultime.municipality_id, municipalities.id))
    .where(and(...conditions))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({ ...r, vertical: 'konsultime' as const }));
}

async function listPendingProkurime(
  municipality: string | undefined,
  limit: number,
  offset: number,
) {
  const conditions = [eq(prokurime.review_status, 'pending')];
  if (municipality) conditions.push(eq(municipalities.slug, municipality));

  const rows = await db
    .select({
      id: prokurime.id,
      title: prokurime.title,
      published_date: sql<string>`${prokurime.published_date}::text`,
      municipality: municipalities.slug,
      source_origin: prokurime.source_origin,
      source_url: prokurime.source_url,
      review_status: prokurime.review_status,
      collected_at: prokurime.collected_at,
      created_at: prokurime.created_at,
    })
    .from(prokurime)
    .innerJoin(municipalities, eq(prokurime.municipality_id, municipalities.id))
    .where(and(...conditions))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({ ...r, vertical: 'prokurime' as const }));
}

async function approveRow(vertical: Vertical, id: string): Promise<TransitionOutcome> {
  let outcome: TransitionOutcome = 'ok';

  await db.transaction(async (tx) => {
    let currentStatus: string | undefined;

    switch (vertical) {
      case 'vendime': {
        const [r] = await tx
          .select({ s: vendime.review_status })
          .from(vendime)
          .where(eq(vendime.id, id))
          .limit(1);
        currentStatus = r?.s;
        break;
      }
      case 'konsultime': {
        const [r] = await tx
          .select({ s: konsultime.review_status })
          .from(konsultime)
          .where(eq(konsultime.id, id))
          .limit(1);
        currentStatus = r?.s;
        break;
      }
      case 'prokurime': {
        const [r] = await tx
          .select({ s: prokurime.review_status })
          .from(prokurime)
          .where(eq(prokurime.id, id))
          .limit(1);
        currentStatus = r?.s;
        break;
      }
    }

    if (currentStatus === undefined) {
      outcome = 'not_found';
      return;
    }
    if (currentStatus !== 'pending') {
      outcome = 'not_pending';
      return;
    }

    switch (vertical) {
      case 'vendime':
        await tx.update(vendime).set({ review_status: 'approved' }).where(eq(vendime.id, id));
        break;
      case 'konsultime':
        await tx.update(konsultime).set({ review_status: 'approved' }).where(eq(konsultime.id, id));
        break;
      case 'prokurime':
        await tx.update(prokurime).set({ review_status: 'approved' }).where(eq(prokurime.id, id));
        break;
    }

    await tx.insert(audit_log).values({
      action: 'approve',
      table_name: vertical,
      record_id: id,
      actor_id: 'admin',
      payload: { old_status: 'pending', new_status: 'approved' },
    });
  });

  return outcome;
}

async function rejectRow(
  vertical: Vertical,
  id: string,
  reason: string | undefined,
): Promise<TransitionOutcome> {
  let outcome: TransitionOutcome = 'ok';

  await db.transaction(async (tx) => {
    let currentStatus: string | undefined;

    switch (vertical) {
      case 'vendime': {
        const [r] = await tx
          .select({ s: vendime.review_status })
          .from(vendime)
          .where(eq(vendime.id, id))
          .limit(1);
        currentStatus = r?.s;
        break;
      }
      case 'konsultime': {
        const [r] = await tx
          .select({ s: konsultime.review_status })
          .from(konsultime)
          .where(eq(konsultime.id, id))
          .limit(1);
        currentStatus = r?.s;
        break;
      }
      case 'prokurime': {
        const [r] = await tx
          .select({ s: prokurime.review_status })
          .from(prokurime)
          .where(eq(prokurime.id, id))
          .limit(1);
        currentStatus = r?.s;
        break;
      }
    }

    if (currentStatus === undefined) {
      outcome = 'not_found';
      return;
    }
    if (currentStatus !== 'pending') {
      outcome = 'not_pending';
      return;
    }

    switch (vertical) {
      case 'vendime':
        await tx.update(vendime).set({ review_status: 'rejected' }).where(eq(vendime.id, id));
        break;
      case 'konsultime':
        await tx.update(konsultime).set({ review_status: 'rejected' }).where(eq(konsultime.id, id));
        break;
      case 'prokurime':
        await tx.update(prokurime).set({ review_status: 'rejected' }).where(eq(prokurime.id, id));
        break;
    }

    await tx.insert(audit_log).values({
      action: 'reject',
      table_name: vertical,
      record_id: id,
      actor_id: 'admin',
      payload: { old_status: 'pending', new_status: 'rejected', reason },
    });
  });

  return outcome;
}
