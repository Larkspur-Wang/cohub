ALTER TABLE "v2"."label_assignments" ALTER COLUMN "rank" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "v2"."label_assignments" ALTER COLUMN "rank" DROP NOT NULL;--> statement-breakpoint
UPDATE "v2"."label_assignments" SET "rank" = NULL, "updated_at" = now() WHERE "source" = 'system' AND "rank" IS NOT NULL;