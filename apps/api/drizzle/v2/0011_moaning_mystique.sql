ALTER TABLE "v2"."space_sandboxes" ADD COLUMN "runtime_status" varchar(30) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "v2"."space_sandboxes" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "v2"."space_sandboxes" ADD COLUMN "stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "v2"."space_sandboxes" ADD COLUMN "stop_reason" varchar(30);--> statement-breakpoint
CREATE INDEX "v2_idx_space_sandboxes_last_activity_at" ON "v2"."space_sandboxes" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sandboxes_runtime_status" ON "v2"."space_sandboxes" USING btree ("runtime_status");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sandboxes_stopped_at" ON "v2"."space_sandboxes" USING btree ("stopped_at");