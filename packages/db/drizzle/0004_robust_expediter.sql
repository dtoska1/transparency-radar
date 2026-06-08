DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "document_checks" LIMIT 1) THEN
		RAISE EXCEPTION
			'document_checks must be empty before applying the Phase B contract migration';
	END IF;
END
$$;
--> statement-breakpoint
CREATE TYPE "public"."document_check_status" AS ENUM('verified', 'source_changed', 'stored_mismatch', 'token_invalid', 'token_missing', 'source_unreachable', 'source_not_applicable', 'error');--> statement-breakpoint
ALTER TABLE "document_checks" ALTER COLUMN "status" SET DATA TYPE "public"."document_check_status" USING "status"::text::"public"."document_check_status";--> statement-breakpoint
ALTER TABLE "document_checks" ALTER COLUMN "result_detail" SET DATA TYPE jsonb USING COALESCE("result_detail"::jsonb, '{}'::jsonb);--> statement-breakpoint
ALTER TABLE "document_checks" ALTER COLUMN "result_detail" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document_checks" ADD COLUMN "run_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "document_checks" ADD CONSTRAINT "document_checks_run_id_document_id_unique" UNIQUE("run_id","document_id");
