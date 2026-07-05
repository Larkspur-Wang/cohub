CREATE TABLE "v2"."resource_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(30) NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"source_id" text NOT NULL,
	"source_turn_id" uuid,
	"target_type" varchar(20) NOT NULL,
	"target_id" text NOT NULL,
	"space_id" uuid NOT NULL,
	"session_id" uuid,
	"count" integer DEFAULT 1 NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "v2_uq_resource_references_identity" UNIQUE NULLS NOT DISTINCT("kind","source_type","source_id","source_turn_id","target_type","target_id")
);
--> statement-breakpoint
CREATE INDEX "v2_idx_resource_references_target" ON "v2"."resource_references" USING btree ("target_type","target_id","kind");--> statement-breakpoint
CREATE INDEX "v2_idx_resource_references_source" ON "v2"."resource_references" USING btree ("source_type","source_id","kind");--> statement-breakpoint
CREATE INDEX "v2_idx_resource_references_space_kind" ON "v2"."resource_references" USING btree ("space_id","kind","updated_at");--> statement-breakpoint
CREATE INDEX "v2_idx_resource_references_session_kind" ON "v2"."resource_references" USING btree ("session_id","kind");--> statement-breakpoint
CREATE INDEX "v2_idx_resource_references_turn" ON "v2"."resource_references" USING btree ("source_turn_id");