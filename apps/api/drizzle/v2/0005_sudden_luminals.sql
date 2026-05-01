CREATE TABLE "v2"."space_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"kind" varchar(30) NOT NULL,
	"resource_type" varchar(30) NOT NULL,
	"resource_ref" text NOT NULL,
	"label" text,
	"rank" integer DEFAULT 0 NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_space_marks_resource" ON "v2"."space_marks" USING btree ("space_id","kind","resource_type","resource_ref");--> statement-breakpoint
CREATE INDEX "v2_idx_space_marks_space_kind_rank" ON "v2"."space_marks" USING btree ("space_id","kind","rank");--> statement-breakpoint
CREATE INDEX "v2_idx_space_marks_space_resource" ON "v2"."space_marks" USING btree ("space_id","resource_type","resource_ref");