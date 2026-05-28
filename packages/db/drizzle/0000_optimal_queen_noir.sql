CREATE TYPE "public"."konsultime_kind" AS ENUM('consultation_notice', 'draft_act', 'hearing');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."vertical" AS ENUM('vendime', 'konsultime', 'prokurime');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid,
	"actor_id" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"result_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"slot_ref" text NOT NULL,
	"version_no" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"storage_uri" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"tsr_token" text,
	"tsr_timestamp_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "konsultim_documents" (
	"konsultim_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "konsultim_documents_konsultim_id_document_version_id_pk" PRIMARY KEY("konsultim_id","document_version_id")
);
--> statement-breakpoint
CREATE TABLE "konsultime" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"municipality_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_origin" text NOT NULL,
	"source_page_url" text NOT NULL,
	"source_url" text NOT NULL,
	"dedup_key" text NOT NULL,
	"title" text NOT NULL,
	"title_slug" text NOT NULL,
	"summary" text,
	"published_date" date NOT NULL,
	"kind" "konsultime_kind" DEFAULT 'consultation_notice' NOT NULL,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "konsultime_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "municipalities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "municipalities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "prokurim_documents" (
	"prokurim_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prokurim_documents_prokurim_id_document_version_id_pk" PRIMARY KEY("prokurim_id","document_version_id")
);
--> statement-breakpoint
CREATE TABLE "prokurime" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"municipality_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_origin" text NOT NULL,
	"source_page_url" text NOT NULL,
	"source_url" text NOT NULL,
	"dedup_key" text NOT NULL,
	"app_id" text NOT NULL,
	"title" text NOT NULL,
	"contracting_authority" text NOT NULL,
	"procurement_object" text NOT NULL,
	"published_date" date NOT NULL,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(contracting_authority, '') || ' ' || coalesce(procurement_object, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prokurime_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"municipality_id" uuid NOT NULL,
	"vertical" "vertical" NOT NULL,
	"source_origin" text NOT NULL,
	"source_page_url" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_unofficial_proxy" boolean DEFAULT false NOT NULL,
	"label_override" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendim_documents" (
	"vendim_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendim_documents_vendim_id_document_version_id_pk" PRIMARY KEY("vendim_id","document_version_id")
);
--> statement-breakpoint
CREATE TABLE "vendime" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"municipality_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_origin" text NOT NULL,
	"source_page_url" text NOT NULL,
	"source_url" text NOT NULL,
	"dedup_key" text NOT NULL,
	"number_normalized" text NOT NULL,
	"year_signed" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"published_date" date NOT NULL,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendime_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
ALTER TABLE "document_checks" ADD CONSTRAINT "document_checks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "konsultim_documents" ADD CONSTRAINT "konsultim_documents_konsultim_id_konsultime_id_fk" FOREIGN KEY ("konsultim_id") REFERENCES "public"."konsultime"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "konsultim_documents" ADD CONSTRAINT "konsultim_documents_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "konsultime" ADD CONSTRAINT "konsultime_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "konsultime" ADD CONSTRAINT "konsultime_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prokurim_documents" ADD CONSTRAINT "prokurim_documents_prokurim_id_prokurime_id_fk" FOREIGN KEY ("prokurim_id") REFERENCES "public"."prokurime"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prokurim_documents" ADD CONSTRAINT "prokurim_documents_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prokurime" ADD CONSTRAINT "prokurime_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prokurime" ADD CONSTRAINT "prokurime_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendim_documents" ADD CONSTRAINT "vendim_documents_vendim_id_vendime_id_fk" FOREIGN KEY ("vendim_id") REFERENCES "public"."vendime"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendim_documents" ADD CONSTRAINT "vendim_documents_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendime" ADD CONSTRAINT "vendime_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendime" ADD CONSTRAINT "vendime_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "konsultime_search_tsv_gin_idx" ON "konsultime" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "prokurime_search_tsv_gin_idx" ON "prokurime" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "vendime_search_tsv_gin_idx" ON "vendime" USING gin ("search_tsv");