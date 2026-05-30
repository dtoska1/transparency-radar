import type { Vertical } from '@tra/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// ── Enums ─────────────────────────────────────────────────────────────────────

// Values must stay in sync with VERTICALS in @tra/shared
export const verticalEnum = pgEnum('vertical', ['vendime', 'konsultime', 'prokurime']);
// Compile-time guard: this line fails if verticalEnum values diverge from @tra/shared's Vertical type
export type _VerticalSync = (typeof verticalEnum.enumValues)[number] extends Vertical
  ? true
  : never;
export const reviewStatusEnum = pgEnum('review_status', ['pending', 'approved', 'rejected']);
export const konsultimeKindEnum = pgEnum('konsultime_kind', [
  'consultation_notice',
  'draft_act',
  'hearing',
]);

// ── Custom types ──────────────────────────────────────────────────────────────

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ── Core tables ───────────────────────────────────────────────────────────────

export const municipalities = pgTable('municipalities', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  municipality_id: uuid('municipality_id')
    .notNull()
    .references(() => municipalities.id),
  vertical: verticalEnum('vertical').notNull(),
  source_origin: text('source_origin').notNull(),
  source_page_url: text('source_page_url').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  is_unofficial_proxy: boolean('is_unofficial_proxy').notNull().default(false),
  label_override: text('label_override'),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Tamper-evidence tables ────────────────────────────────────────────────────

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  sha256: text('sha256').notNull().unique(),
  storage_uri: text('storage_uri').notNull(),
  mime_type: text('mime_type').notNull(),
  byte_size: integer('byte_size').notNull(),
  tsr_token: text('tsr_token'),
  tsr_timestamp_at: timestamp('tsr_timestamp_at', { withTimezone: true }),
  first_seen_at: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// append-only: no UPDATE/DELETE in application code
export const document_versions = pgTable('document_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  document_id: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  slot_ref: text('slot_ref').notNull(),
  version_no: integer('version_no').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const document_checks = pgTable('document_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  document_id: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  checked_at: timestamp('checked_at', { withTimezone: true }).notNull(),
  status: text('status').notNull(),
  result_detail: text('result_detail'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Vertical: Vendime ─────────────────────────────────────────────────────────

export const vendime = pgTable(
  'vendime',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    municipality_id: uuid('municipality_id')
      .notNull()
      .references(() => municipalities.id),
    source_id: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    // provenance fields (canonical — do not rename)
    source_origin: text('source_origin').notNull(),
    source_page_url: text('source_page_url').notNull(),
    source_url: text('source_url').notNull(),
    // dedup key formula: vendime:{slug}:{number_normalized}:{year_signed}
    dedup_key: text('dedup_key').notNull().unique(),
    number_normalized: text('number_normalized').notNull(),
    year_signed: integer('year_signed').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    published_date: date('published_date').notNull(),
    review_status: reviewStatusEnum('review_status').notNull().default('pending'),
    collected_at: timestamp('collected_at', { withTimezone: true }).notNull(),
    search_tsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))`,
    ),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('vendime_search_tsv_gin_idx').using('gin', table.search_tsv)],
);

// ── Vertical: Konsultime ──────────────────────────────────────────────────────

export const konsultime = pgTable(
  'konsultime',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    municipality_id: uuid('municipality_id')
      .notNull()
      .references(() => municipalities.id),
    source_id: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    // provenance fields (canonical — do not rename)
    source_origin: text('source_origin').notNull(),
    source_page_url: text('source_page_url').notNull(),
    source_url: text('source_url').notNull(),
    // dedup key formula: konsultime:{slug}:{title_slug}:{published_date_iso}
    dedup_key: text('dedup_key').notNull().unique(),
    title: text('title').notNull(),
    title_slug: text('title_slug').notNull(),
    summary: text('summary'),
    published_date: date('published_date').notNull(),
    // kind distinguishes draft acts / projektakte from open consultations
    kind: konsultimeKindEnum('kind').notNull().default('consultation_notice'),
    review_status: reviewStatusEnum('review_status').notNull().default('pending'),
    collected_at: timestamp('collected_at', { withTimezone: true }).notNull(),
    search_tsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))`,
    ),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('konsultime_search_tsv_gin_idx').using('gin', table.search_tsv)],
);

// ── Vertical: Prokurime ───────────────────────────────────────────────────────

export const prokurime = pgTable(
  'prokurime',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    municipality_id: uuid('municipality_id')
      .notNull()
      .references(() => municipalities.id),
    source_id: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    // provenance fields (canonical — do not rename)
    source_origin: text('source_origin').notNull(),
    source_page_url: text('source_page_url').notNull(),
    source_url: text('source_url').notNull(),
    // dedup key formula: prokurime:app:{app_id}
    dedup_key: text('dedup_key').notNull().unique(),
    app_id: text('app_id').notNull(),
    title: text('title').notNull(),
    contracting_authority: text('contracting_authority').notNull(),
    procurement_object: text('procurement_object').notNull(),
    published_date: date('published_date').notNull(),
    review_status: reviewStatusEnum('review_status').notNull().default('pending'),
    collected_at: timestamp('collected_at', { withTimezone: true }).notNull(),
    search_tsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(contracting_authority, '') || ' ' || coalesce(procurement_object, ''))`,
    ),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('prokurime_search_tsv_gin_idx').using('gin', table.search_tsv)],
);

// ── Join tables ───────────────────────────────────────────────────────────────

export const vendim_documents = pgTable(
  'vendim_documents',
  {
    vendim_id: uuid('vendim_id')
      .notNull()
      .references(() => vendime.id),
    document_version_id: uuid('document_version_id')
      .notNull()
      .references(() => document_versions.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.vendim_id, table.document_version_id] })],
);

export const konsultim_documents = pgTable(
  'konsultim_documents',
  {
    konsultim_id: uuid('konsultim_id')
      .notNull()
      .references(() => konsultime.id),
    document_version_id: uuid('document_version_id')
      .notNull()
      .references(() => document_versions.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.konsultim_id, table.document_version_id] })],
);

export const prokurim_documents = pgTable(
  'prokurim_documents',
  {
    prokurim_id: uuid('prokurim_id')
      .notNull()
      .references(() => prokurime.id),
    document_version_id: uuid('document_version_id')
      .notNull()
      .references(() => document_versions.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.prokurim_id, table.document_version_id] })],
);

// ── Audit log ─────────────────────────────────────────────────────────────────

// append-only: no UPDATE/DELETE in application code
export const audit_log = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  action: text('action').notNull(),
  table_name: text('table_name').notNull(),
  record_id: uuid('record_id'),
  actor_id: text('actor_id'),
  payload: jsonb('payload'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Scrape run log ────────────────────────────────────────────────────────────

export const scrape_runs = pgTable('scrape_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  source_id: uuid('source_id')
    .notNull()
    .references(() => sources.id),
  municipality_id: uuid('municipality_id')
    .notNull()
    .references(() => municipalities.id),
  vertical: verticalEnum('vertical').notNull(),
  started_at: timestamp('started_at', { withTimezone: true }).notNull(),
  finished_at: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull(),
  items_seen: integer('items_seen').notNull().default(0),
  items_new: integer('items_new').notNull().default(0),
  items_updated: integer('items_updated').notNull().default(0),
  error_message: text('error_message'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
