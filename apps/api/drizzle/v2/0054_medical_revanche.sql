CREATE TABLE "v2"."work_promotion_stats_hourly" (
	"promotion_id" uuid NOT NULL,
	"work_version_id" uuid NOT NULL,
	"bucket_start_at" timestamp with time zone NOT NULL,
	"event_key" varchar(64) NOT NULL,
	"event_count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."work_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "v2_chk_work_promotions_provider" CHECK (length("v2"."work_promotions"."provider") between 1 and 64 and "v2"."work_promotions"."provider" !~ '[^a-z0-9_-]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_work_promotion_stats_hourly_dims" ON "v2"."work_promotion_stats_hourly" USING btree ("promotion_id","work_version_id","bucket_start_at","event_key");--> statement-breakpoint
CREATE INDEX "v2_idx_work_promotion_stats_hourly_promotion_bucket" ON "v2"."work_promotion_stats_hourly" USING btree ("promotion_id","bucket_start_at");--> statement-breakpoint
CREATE INDEX "v2_idx_work_promotions_work_id" ON "v2"."work_promotions" USING btree ("work_id");