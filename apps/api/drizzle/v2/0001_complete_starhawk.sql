CREATE TABLE "v2"."space_sandboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"pod_name" varchar(255),
	"last_heartbeat_at" timestamp with time zone,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_space_sandboxes_space_id" ON "v2"."space_sandboxes" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sandboxes_status" ON "v2"."space_sandboxes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sandboxes_last_heartbeat_at" ON "v2"."space_sandboxes" USING btree ("last_heartbeat_at");