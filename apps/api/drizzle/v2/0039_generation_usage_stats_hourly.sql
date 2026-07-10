CREATE TABLE "v2"."generation_usage_stats_hourly" (
	"bucket_start_at" timestamp with time zone NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"space_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"usage_type" varchar(100) NOT NULL,
	"provider" varchar(100) NOT NULL,
	"model" varchar(255) NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"cost_total" numeric(18, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_generation_usage_stats_hourly_bucket_dims" ON "v2"."generation_usage_stats_hourly" USING btree ("bucket_start_at","user_id","space_id","session_id","usage_type","provider","model");--> statement-breakpoint
CREATE INDEX "v2_idx_generation_usage_stats_hourly_bucket" ON "v2"."generation_usage_stats_hourly" USING btree ("bucket_start_at");--> statement-breakpoint
CREATE INDEX "v2_idx_generation_usage_stats_hourly_user_bucket" ON "v2"."generation_usage_stats_hourly" USING btree ("user_id","bucket_start_at");--> statement-breakpoint
CREATE INDEX "v2_idx_generation_usage_stats_hourly_space_bucket" ON "v2"."generation_usage_stats_hourly" USING btree ("space_id","bucket_start_at");--> statement-breakpoint
CREATE INDEX "v2_idx_generation_usage_stats_hourly_session_bucket" ON "v2"."generation_usage_stats_hourly" USING btree ("session_id","bucket_start_at");--> statement-breakpoint
CREATE INDEX "v2_idx_generation_usage_stats_hourly_usage_type_bucket" ON "v2"."generation_usage_stats_hourly" USING btree ("usage_type","bucket_start_at");--> statement-breakpoint
CREATE INDEX "v2_idx_generation_usage_stats_hourly_provider_model_bucket" ON "v2"."generation_usage_stats_hourly" USING btree ("provider","model","bucket_start_at");
