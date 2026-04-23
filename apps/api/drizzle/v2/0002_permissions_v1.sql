CREATE TABLE "v2"."access_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" varchar(20) NOT NULL,
	"resource_id" uuid NOT NULL,
	"signed_in_user_role" varchar(20),
	"anonymous_user_role" varchar(20),
	"created_by" varchar(255) NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."space_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"role" varchar(20) NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DROP TABLE "v2"."resource_permissions" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_access_policies_resource" ON "v2"."access_policies" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "v2_idx_access_policies_resource" ON "v2"."access_policies" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_space_members_space_user" ON "v2"."space_members" USING btree ("space_id","user_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_members_space" ON "v2"."space_members" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_members_user" ON "v2"."space_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_members_space_role" ON "v2"."space_members" USING btree ("space_id","role");--> statement-breakpoint
ALTER TABLE "v2"."session_messages" DROP COLUMN "usage_input";--> statement-breakpoint
ALTER TABLE "v2"."session_messages" DROP COLUMN "usage_output";--> statement-breakpoint
ALTER TABLE "v2"."session_messages" DROP COLUMN "cost_total";
