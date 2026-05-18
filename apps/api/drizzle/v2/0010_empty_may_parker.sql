CREATE TABLE "v2"."space_mods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"mod_space_id" uuid NOT NULL,
	"name" varchar(255),
	"mount_slug" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "v2_idx_space_mods_space_id" ON "v2"."space_mods" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_mods_mod_space_id" ON "v2"."space_mods" USING btree ("mod_space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_space_mods_space_mod" ON "v2"."space_mods" USING btree ("space_id","mod_space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_space_mods_space_mount_slug" ON "v2"."space_mods" USING btree ("space_id","mount_slug");
