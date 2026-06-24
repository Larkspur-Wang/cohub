ALTER TABLE "v2"."spaces" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
UPDATE "v2"."spaces" SET "last_activity_at" = "updated_at" WHERE "last_activity_at" IS NULL;--> statement-breakpoint
CREATE INDEX "v2_idx_spaces_last_activity_at" ON "v2"."spaces" USING btree ("last_activity_at" DESC NULLS LAST,"created_at" DESC NULLS LAST);