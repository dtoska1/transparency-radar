import { db } from '@tra/db';
import { audit_log, konsultime, municipalities, prokurime, vendime } from '@tra/db';
import { MUNICIPALITY_SLUGS } from '@tra/shared';
import { and, eq, inArray, notLike, sql } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { z } from 'zod';

const ManualVerticalSchema = z.enum(['vendime', 'konsultime', 'prokurime'] as const);

const BulkApproveSchema = z.object({
  municipality: z.enum(MUNICIPALITY_SLUGS),
  year: z.coerce.number().int().min(2018).max(2027).optional(),
  excludePlaceholders: z.coerce.boolean().default(true),
  dryRun: z.coerce.boolean().default(true),
});

export const handleBulkApprove: RequestHandler = async (req, res) => {
  // 1. Validate vertical
  const verticalParse = ManualVerticalSchema.safeParse(req.params.vertical);
  if (!verticalParse.success) {
    res.status(400).json({ error: 'Invalid vertical — must be vendime, konsultime, or prokurime' });
    return;
  }
  const vertical = verticalParse.data;

  // 2. Validate body
  const bodyParse = BulkApproveSchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Invalid body', details: bodyParse.error.flatten() });
    return;
  }
  const { municipality, year, excludePlaceholders, dryRun } = bodyParse.data;

  // 3. Resolve municipality
  const [muni] = await db
    .select({ id: municipalities.id })
    .from(municipalities)
    .where(eq(municipalities.slug, municipality))
    .limit(1);
  if (!muni) {
    res.status(400).json({ error: `Unknown municipality: ${municipality}` });
    return;
  }

  if (vertical === 'vendime') {
    const conditions = [eq(vendime.review_status, 'pending'), eq(vendime.municipality_id, muni.id)];
    if (year !== undefined) conditions.push(eq(vendime.year_signed, year));
    if (excludePlaceholders) conditions.push(notLike(vendime.dedup_key, '%PLACEHOLDER%'));

    if (dryRun) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(vendime)
        .where(and(...conditions));
      const sample = await db
        .select({ dedup_key: vendime.dedup_key })
        .from(vendime)
        .where(and(...conditions))
        .limit(10);
      res.json({ dryRun: true, wouldApprove: count, sample: sample.map((r) => r.dedup_key) });
      return;
    }

    const approved = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: vendime.id })
        .from(vendime)
        .where(and(...conditions));

      if (rows.length === 0) return 0;

      const ids = rows.map((r) => r.id);
      await tx.update(vendime).set({ review_status: 'approved' }).where(inArray(vendime.id, ids));

      const payload = { filter: { municipality, year, excludePlaceholders } };
      await tx.insert(audit_log).values(
        ids.map((id) => ({
          action: 'bulk_approve',
          table_name: vertical,
          record_id: id,
          actor_id: 'admin',
          payload,
        })),
      );

      return rows.length;
    });

    res.json({ approved });
    return;
  }

  if (vertical === 'konsultime') {
    const conditions = [
      eq(konsultime.review_status, 'pending'),
      eq(konsultime.municipality_id, muni.id),
    ];
    if (year !== undefined)
      conditions.push(sql`EXTRACT(YEAR FROM ${konsultime.published_date})::int = ${year}`);
    if (excludePlaceholders) conditions.push(notLike(konsultime.dedup_key, '%PLACEHOLDER%'));

    if (dryRun) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(konsultime)
        .where(and(...conditions));
      const sample = await db
        .select({ dedup_key: konsultime.dedup_key })
        .from(konsultime)
        .where(and(...conditions))
        .limit(10);
      res.json({ dryRun: true, wouldApprove: count, sample: sample.map((r) => r.dedup_key) });
      return;
    }

    const approved = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: konsultime.id })
        .from(konsultime)
        .where(and(...conditions));

      if (rows.length === 0) return 0;

      const ids = rows.map((r) => r.id);
      await tx
        .update(konsultime)
        .set({ review_status: 'approved' })
        .where(inArray(konsultime.id, ids));

      const payload = { filter: { municipality, year, excludePlaceholders } };
      await tx.insert(audit_log).values(
        ids.map((id) => ({
          action: 'bulk_approve',
          table_name: vertical,
          record_id: id,
          actor_id: 'admin',
          payload,
        })),
      );

      return rows.length;
    });

    res.json({ approved });
    return;
  }

  // prokurime
  const conditions = [
    eq(prokurime.review_status, 'pending'),
    eq(prokurime.municipality_id, muni.id),
  ];
  if (year !== undefined)
    conditions.push(sql`EXTRACT(YEAR FROM ${prokurime.published_date})::int = ${year}`);
  if (excludePlaceholders) conditions.push(notLike(prokurime.dedup_key, '%PLACEHOLDER%'));

  if (dryRun) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(prokurime)
      .where(and(...conditions));
    const sample = await db
      .select({ dedup_key: prokurime.dedup_key })
      .from(prokurime)
      .where(and(...conditions))
      .limit(10);
    res.json({ dryRun: true, wouldApprove: count, sample: sample.map((r) => r.dedup_key) });
    return;
  }

  const approved = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: prokurime.id })
      .from(prokurime)
      .where(and(...conditions));

    if (rows.length === 0) return 0;

    const ids = rows.map((r) => r.id);
    await tx.update(prokurime).set({ review_status: 'approved' }).where(inArray(prokurime.id, ids));

    const payload = { filter: { municipality, year, excludePlaceholders } };
    await tx.insert(audit_log).values(
      ids.map((id) => ({
        action: 'bulk_approve',
        table_name: vertical,
        record_id: id,
        actor_id: 'admin',
        payload,
      })),
    );

    return rows.length;
  });

  res.json({ approved });
};
