CREATE TABLE "v2"."token_usage_stats_hourly" (
	"bucket_start_at" timestamp with time zone NOT NULL,
	"user_id" varchar(255),
	"space_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"provider" varchar(100),
	"model" varchar(255),
	"request_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_input" numeric(18, 8) DEFAULT '0' NOT NULL,
	"cost_output" numeric(18, 8) DEFAULT '0' NOT NULL,
	"cost_cache_read" numeric(18, 8) DEFAULT '0' NOT NULL,
	"cost_cache_write" numeric(18, 8) DEFAULT '0' NOT NULL,
	"cost_total" numeric(18, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "v2"."session_messages" ADD COLUMN "usage" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_token_usage_stats_hourly_bucket_dims" ON "v2"."token_usage_stats_hourly" USING btree ("bucket_start_at","user_id","space_id","session_id","provider","model");--> statement-breakpoint
CREATE INDEX "v2_idx_token_usage_stats_hourly_bucket" ON "v2"."token_usage_stats_hourly" USING btree ("bucket_start_at");--> statement-breakpoint
CREATE INDEX "v2_idx_token_usage_stats_hourly_user_bucket" ON "v2"."token_usage_stats_hourly" USING btree ("user_id","bucket_start_at");--> statement-breakpoint
CREATE INDEX "v2_idx_token_usage_stats_hourly_space_bucket" ON "v2"."token_usage_stats_hourly" USING btree ("space_id","bucket_start_at");--> statement-breakpoint
CREATE INDEX "v2_idx_token_usage_stats_hourly_session_bucket" ON "v2"."token_usage_stats_hourly" USING btree ("session_id","bucket_start_at");--> statement-breakpoint
CREATE INDEX "v2_idx_token_usage_stats_hourly_provider_model_bucket" ON "v2"."token_usage_stats_hourly" USING btree ("provider","model","bucket_start_at");
