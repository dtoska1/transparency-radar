import { db } from '@tra/db';
import {
  document_versions,
  documents,
  konsultim_documents,
  konsultime,
  municipalities,
  prokurim_documents,
  prokurime,
  vendim_documents,
  vendime,
} from '@tra/db';
import { MUNICIPALITY_SLUGS, VERTICALS, type Vertical } from '@tra/shared';
import { and, eq, sql } from 'drizzle-orm';
import type express from 'express';
import { Router } from 'express';
import { z } from 'zod';

const VerticalSchema = z.enum(VERTICALS);
const UUIDSchema = z.string().uuid();

const ListQuerySchema = z.object({
  municipality: z.enum(MUNICIPALITY_SLUGS).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  q: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const publicRouter: express.Router = Router();

publicRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

publicRouter.get('/:vertical', async (req, res) => {
  const verticalParse = VerticalSchema.safeParse(req.params.vertical);
  if (!verticalParse.success) {
    res.status(400).json({ error: 'Invalid vertical', details: verticalParse.error.flatten() });
    return;
  }

  const queryParse = ListQuerySchema.safeParse(req.query);
  if (!queryParse.success) {
    res.status(400).json({ error: 'Invalid query params', details: queryParse.error.flatten() });
    return;
  }

  const { municipality, year, q, limit, offset } = queryParse.data;
  const rows = await listApproved(verticalParse.data, { municipality, year, q, limit, offset });
  res.json({ data: rows, limit, offset });
});

publicRouter.get('/:vertical/:id', async (req, res) => {
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

  const row = await getApprovedById(verticalParse.data, idParse.data);
  if (!row) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const docs = await getDocuments(verticalParse.data, idParse.data);
  res.json({ data: { ...row, documents: docs } });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

type ListParams = {
  municipality: string | undefined;
  year: number | undefined;
  q: string | undefined;
  limit: number;
  offset: number;
};

async function listApproved(vertical: Vertical, params: ListParams) {
  switch (vertical) {
    case 'vendime':
      return listApprovedVendime(params);
    case 'konsultime':
      return listApprovedKonsultime(params);
    case 'prokurime':
      return listApprovedProkurime(params);
  }
}

async function listApprovedVendime({ municipality, year, q, limit, offset }: ListParams) {
  const conditions = [eq(vendime.review_status, 'approved')];
  if (municipality) conditions.push(eq(municipalities.slug, municipality));
  if (year !== undefined) conditions.push(eq(vendime.year_signed, year));
  if (q) conditions.push(sql`${vendime.search_tsv} @@ plainto_tsquery('simple', ${q})`);

  return db
    .select({
      id: vendime.id,
      title: vendime.title,
      published_date: sql<string>`${vendime.published_date}::text`,
      municipality: municipalities.slug,
      source_origin: vendime.source_origin,
      source_url: vendime.source_url,
      review_status: vendime.review_status,
    })
    .from(vendime)
    .innerJoin(municipalities, eq(vendime.municipality_id, municipalities.id))
    .where(and(...conditions))
    .limit(limit)
    .offset(offset);
}

async function listApprovedKonsultime({ municipality, year, q, limit, offset }: ListParams) {
  const conditions = [eq(konsultime.review_status, 'approved')];
  if (municipality) conditions.push(eq(municipalities.slug, municipality));
  if (year !== undefined)
    conditions.push(sql`EXTRACT(YEAR FROM ${konsultime.published_date})::int = ${year}`);
  if (q) conditions.push(sql`${konsultime.search_tsv} @@ plainto_tsquery('simple', ${q})`);

  return db
    .select({
      id: konsultime.id,
      title: konsultime.title,
      published_date: sql<string>`${konsultime.published_date}::text`,
      municipality: municipalities.slug,
      source_origin: konsultime.source_origin,
      source_url: konsultime.source_url,
      review_status: konsultime.review_status,
    })
    .from(konsultime)
    .innerJoin(municipalities, eq(konsultime.municipality_id, municipalities.id))
    .where(and(...conditions))
    .limit(limit)
    .offset(offset);
}

async function listApprovedProkurime({ municipality, year, q, limit, offset }: ListParams) {
  const conditions = [eq(prokurime.review_status, 'approved')];
  if (municipality) conditions.push(eq(municipalities.slug, municipality));
  if (year !== undefined)
    conditions.push(sql`EXTRACT(YEAR FROM ${prokurime.published_date})::int = ${year}`);
  if (q) conditions.push(sql`${prokurime.search_tsv} @@ plainto_tsquery('simple', ${q})`);

  return db
    .select({
      id: prokurime.id,
      title: prokurime.title,
      published_date: sql<string>`${prokurime.published_date}::text`,
      municipality: municipalities.slug,
      source_origin: prokurime.source_origin,
      source_url: prokurime.source_url,
      review_status: prokurime.review_status,
    })
    .from(prokurime)
    .innerJoin(municipalities, eq(prokurime.municipality_id, municipalities.id))
    .where(and(...conditions))
    .limit(limit)
    .offset(offset);
}

async function getApprovedById(vertical: Vertical, id: string) {
  switch (vertical) {
    case 'vendime':
      return getApprovedVendimeById(id);
    case 'konsultime':
      return getApprovedKonsultimeById(id);
    case 'prokurime':
      return getApprovedProkurimById(id);
  }
}

async function getApprovedVendimeById(id: string) {
  const [row] = await db
    .select({
      id: vendime.id,
      title: vendime.title,
      published_date: sql<string>`${vendime.published_date}::text`,
      municipality: municipalities.slug,
      source_origin: vendime.source_origin,
      source_url: vendime.source_url,
      review_status: vendime.review_status,
    })
    .from(vendime)
    .innerJoin(municipalities, eq(vendime.municipality_id, municipalities.id))
    .where(and(eq(vendime.id, id), eq(vendime.review_status, 'approved')))
    .limit(1);
  return row ?? null;
}

async function getApprovedKonsultimeById(id: string) {
  const [row] = await db
    .select({
      id: konsultime.id,
      title: konsultime.title,
      published_date: sql<string>`${konsultime.published_date}::text`,
      municipality: municipalities.slug,
      source_origin: konsultime.source_origin,
      source_url: konsultime.source_url,
      review_status: konsultime.review_status,
    })
    .from(konsultime)
    .innerJoin(municipalities, eq(konsultime.municipality_id, municipalities.id))
    .where(and(eq(konsultime.id, id), eq(konsultime.review_status, 'approved')))
    .limit(1);
  return row ?? null;
}

async function getApprovedProkurimById(id: string) {
  const [row] = await db
    .select({
      id: prokurime.id,
      title: prokurime.title,
      published_date: sql<string>`${prokurime.published_date}::text`,
      municipality: municipalities.slug,
      source_origin: prokurime.source_origin,
      source_url: prokurime.source_url,
      review_status: prokurime.review_status,
    })
    .from(prokurime)
    .innerJoin(municipalities, eq(prokurime.municipality_id, municipalities.id))
    .where(and(eq(prokurime.id, id), eq(prokurime.review_status, 'approved')))
    .limit(1);
  return row ?? null;
}

async function getDocuments(vertical: Vertical, rowId: string) {
  switch (vertical) {
    case 'vendime':
      return getDocumentsVendime(rowId);
    case 'konsultime':
      return getDocumentsKonsultime(rowId);
    case 'prokurime':
      return getDocumentsProkurime(rowId);
  }
}

async function getDocumentsVendime(rowId: string) {
  return db
    .select({
      id: document_versions.id,
      slot_ref: document_versions.slot_ref,
      version_no: document_versions.version_no,
      sha256: documents.sha256,
      storage_uri: documents.storage_uri,
      tsr_timestamp_at: documents.tsr_timestamp_at,
    })
    .from(vendim_documents)
    .innerJoin(document_versions, eq(document_versions.id, vendim_documents.document_version_id))
    .innerJoin(documents, eq(documents.id, document_versions.document_id))
    .where(eq(vendim_documents.vendim_id, rowId));
}

async function getDocumentsKonsultime(rowId: string) {
  return db
    .select({
      id: document_versions.id,
      slot_ref: document_versions.slot_ref,
      version_no: document_versions.version_no,
      sha256: documents.sha256,
      storage_uri: documents.storage_uri,
      tsr_timestamp_at: documents.tsr_timestamp_at,
    })
    .from(konsultim_documents)
    .innerJoin(document_versions, eq(document_versions.id, konsultim_documents.document_version_id))
    .innerJoin(documents, eq(documents.id, document_versions.document_id))
    .where(eq(konsultim_documents.konsultim_id, rowId));
}

async function getDocumentsProkurime(rowId: string) {
  return db
    .select({
      id: document_versions.id,
      slot_ref: document_versions.slot_ref,
      version_no: document_versions.version_no,
      sha256: documents.sha256,
      storage_uri: documents.storage_uri,
      tsr_timestamp_at: documents.tsr_timestamp_at,
    })
    .from(prokurim_documents)
    .innerJoin(document_versions, eq(document_versions.id, prokurim_documents.document_version_id))
    .innerJoin(documents, eq(documents.id, document_versions.document_id))
    .where(eq(prokurim_documents.prokurim_id, rowId));
}
