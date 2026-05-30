import { createHash } from 'node:crypto';
import { db } from '@tra/db';
import {
  audit_log,
  document_versions,
  documents,
  konsultim_documents,
  konsultime,
  municipalities,
  sources,
  vendim_documents,
  vendime,
} from '@tra/db';
import { LocalDiskAdapter, MUNICIPALITY_SLUGS } from '@tra/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';

// ── Storage ───────────────────────────────────────────────────────────────────

const storage = new LocalDiskAdapter(process.env.STORAGE_LOCAL_PATH ?? './uploads');

// ── Multer ────────────────────────────────────────────────────────────────────

export const upload: multer.Multer = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

// ── Vertical restriction ──────────────────────────────────────────────────────

// prokurime excluded: its NOT NULL fields (contracting_authority, procurement_object)
// have no sensible manual-entry default and it can be scraped.
const ManualVerticalSchema = z.enum(['vendime', 'konsultime'] as const);
type ManualVertical = z.infer<typeof ManualVerticalSchema>;

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CommonSchema = z.object({
  municipality: z.enum(MUNICIPALITY_SLUGS),
  title: z.string().min(1).max(500),
  published_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .refine((d) => {
      const y = Number(d.slice(0, 4));
      return y >= 2018 && y <= 2027 && !Number.isNaN(Date.parse(d));
    }, 'Date must be a valid date in 2018–2027'),
  source_url: z.string().url().optional(),
  source_page_url: z.string().url().optional(),
});

const VendimeSchema = CommonSchema.extend({
  number: z.string().min(1),
  year_signed: z.coerce.number().int().min(2018).max(2027),
});

const KonsultimeSchema = CommonSchema.extend({
  kind: z.enum(['consultation_notice', 'draft_act', 'hearing']),
});

type VendimeMeta = z.infer<typeof VendimeSchema>;
type KonsultimeMeta = z.infer<typeof KonsultimeSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isPdf(buf: Buffer): boolean {
  // %PDF- magic bytes: 0x25 0x50 0x44 0x46 0x2D
  return (
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  );
}

function buildDedupKey(vertical: ManualVertical, meta: VendimeMeta | KonsultimeMeta): string {
  if (vertical === 'vendime') {
    const v = meta as VendimeMeta;
    return `vendime:${meta.municipality}:${v.number}:${v.year_signed}`;
  }
  return `konsultime:${meta.municipality}:${toSlug(meta.title)}:${meta.published_date}`;
}

class DedupConflict extends Error {}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handleAdminCreate: RequestHandler = async (req, res) => {
  // 1. Validate vertical
  const verticalParse = ManualVerticalSchema.safeParse(req.params.vertical);
  if (!verticalParse.success) {
    res.status(400).json({ error: 'Invalid vertical — must be vendime or konsultime' });
    return;
  }
  const vertical = verticalParse.data;

  // 2. Validate metadata (all form fields arrive as strings from multer)
  let meta: VendimeMeta | KonsultimeMeta;
  if (vertical === 'vendime') {
    const parse = VendimeSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid fields', details: parse.error.flatten() });
      return;
    }
    meta = parse.data;
  } else {
    const parse = KonsultimeSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid fields', details: parse.error.flatten() });
      return;
    }
    meta = parse.data;
  }

  // 3. Resolve municipality
  const [muni] = await db
    .select({ id: municipalities.id })
    .from(municipalities)
    .where(eq(municipalities.slug, meta.municipality))
    .limit(1);
  if (!muni) {
    res.status(400).json({ error: `Unknown municipality: ${meta.municipality}` });
    return;
  }

  // 4. Resolve active source for this municipality + vertical
  const [source] = await db
    .select({
      id: sources.id,
      source_origin: sources.source_origin,
      source_page_url: sources.source_page_url,
    })
    .from(sources)
    .where(
      and(
        eq(sources.municipality_id, muni.id),
        eq(sources.vertical, vertical),
        eq(sources.is_active, true),
      ),
    )
    .limit(1);
  if (!source) {
    res.status(400).json({ error: `Seed the ${vertical} source for ${meta.municipality} first` });
    return;
  }

  // 5. Build dedup key early — needed as slot_ref fallback for document_versions
  const dedupKey = buildDedupKey(vertical, meta);

  // 6. File handling (if present)
  let docVersionId: string | undefined;
  if (req.file) {
    const buf = req.file.buffer;

    if (!isPdf(buf)) {
      res.status(415).json({ error: 'File must be a PDF (magic bytes mismatch)' });
      return;
    }

    const sha256 = createHash('sha256').update(buf).digest('hex');
    const key = `${meta.municipality}/${vertical}/${sha256}.pdf`;

    // source_url MUST NOT be fetched — stored as text only (SSRF guard)
    await storage.upload(key, buf, 'application/pdf');

    // Upsert document (dedup by sha256)
    const [insertedDoc] = await db
      .insert(documents)
      .values({
        sha256,
        storage_uri: key,
        mime_type: 'application/pdf',
        byte_size: buf.length,
        first_seen_at: new Date(),
      })
      .onConflictDoNothing({ target: documents.sha256 })
      .returning({ id: documents.id });

    const docId =
      insertedDoc?.id ??
      (
        await db
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.sha256, sha256))
          .limit(1)
      )[0].id;

    // Upsert document_version — same version-bump logic as the scraper
    const slotRef = meta.source_url ?? `manual:${dedupKey}`;
    const [latest] = await db
      .select()
      .from(document_versions)
      .where(eq(document_versions.slot_ref, slotRef))
      .orderBy(desc(document_versions.version_no))
      .limit(1);

    if (!latest) {
      const [v] = await db
        .insert(document_versions)
        .values({ document_id: docId, slot_ref: slotRef, version_no: 1 })
        .returning({ id: document_versions.id });
      docVersionId = v.id;
    } else if (latest.document_id === docId) {
      docVersionId = latest.id;
    } else {
      const [v] = await db
        .insert(document_versions)
        .values({ document_id: docId, slot_ref: slotRef, version_no: latest.version_no + 1 })
        .returning({ id: document_versions.id });
      docVersionId = v.id;
    }
  }

  // 7. Transaction: insert vertical row + link document + audit log
  const auditPayload = { ...meta, file_present: !!docVersionId };

  const rowId = await db
    .transaction(async (tx) => {
      let insertedId: string | undefined;

      if (vertical === 'vendime') {
        const v = meta as VendimeMeta;
        const [row] = await tx
          .insert(vendime)
          .values({
            municipality_id: muni.id,
            source_id: source.id,
            source_origin: source.source_origin,
            source_page_url: meta.source_page_url ?? source.source_page_url,
            source_url: meta.source_url ?? '',
            dedup_key: dedupKey,
            number_normalized: v.number,
            year_signed: v.year_signed,
            title: meta.title,
            published_date: meta.published_date,
            review_status: 'pending',
            collected_at: new Date(),
          })
          .onConflictDoNothing({ target: vendime.dedup_key })
          .returning({ id: vendime.id });
        insertedId = row?.id;

        if (insertedId && docVersionId) {
          await tx.insert(vendim_documents).values({
            vendim_id: insertedId,
            document_version_id: docVersionId,
          });
        }
      } else {
        const k = meta as KonsultimeMeta;
        const [row] = await tx
          .insert(konsultime)
          .values({
            municipality_id: muni.id,
            source_id: source.id,
            source_origin: source.source_origin,
            source_page_url: meta.source_page_url ?? source.source_page_url,
            source_url: meta.source_url ?? '',
            dedup_key: dedupKey,
            title: meta.title,
            title_slug: toSlug(meta.title),
            published_date: meta.published_date,
            kind: k.kind,
            review_status: 'pending',
            collected_at: new Date(),
          })
          .onConflictDoNothing({ target: konsultime.dedup_key })
          .returning({ id: konsultime.id });
        insertedId = row?.id;

        if (insertedId && docVersionId) {
          await tx.insert(konsultim_documents).values({
            konsultim_id: insertedId,
            document_version_id: docVersionId,
          });
        }
      }

      if (!insertedId) throw new DedupConflict();

      await tx.insert(audit_log).values({
        action: 'manual_create',
        table_name: vertical,
        record_id: insertedId,
        actor_id: 'admin',
        payload: auditPayload,
      });

      return insertedId;
    })
    .catch((err: unknown) => {
      if (err instanceof DedupConflict) return null;
      throw err;
    });

  if (rowId === null) {
    res.status(409).json({ error: 'Already exists (dedup conflict)', dedup_key: dedupKey });
    return;
  }

  res.status(201).json({ id: rowId, dedup_key: dedupKey });
};
