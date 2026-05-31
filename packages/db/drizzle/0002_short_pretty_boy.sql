ALTER TABLE "konsultime" ADD COLUMN "is_unofficial_proxy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prokurime" ADD COLUMN "is_unofficial_proxy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vendime" ADD COLUMN "is_unofficial_proxy" boolean DEFAULT false NOT NULL;