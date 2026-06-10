CREATE TABLE IF NOT EXISTS "v2"."works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_ref" text NOT NULL,
	"asset_key" text,
	"published_at" timestamp with time zone,
	"work_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_viewer_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "v2_chk_works_slug_format" CHECK (length("slug") between 1 and 80 and "slug" !~ '[^a-z0-9_-]' and left("slug", 1) ~ '[a-z0-9]' and right("slug", 1) ~ '[a-z0-9]')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "v2"."work_viewer_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"viewer_user_uuid" varchar(255) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "v2_idx_works_space_id" ON "v2"."works" USING btree ("space_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "v2_idx_works_user_uuid" ON "v2"."works" USING btree ("user_uuid");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "v2_idx_works_status" ON "v2"."works" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "v2_uq_works_user_slug" ON "v2"."works" USING btree ("user_uuid","slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "v2_idx_work_viewer_grants_work_id" ON "v2"."work_viewer_grants" USING btree ("work_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "v2_idx_work_viewer_grants_space_id" ON "v2"."work_viewer_grants" USING btree ("space_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "v2_idx_work_viewer_grants_viewer_user_uuid" ON "v2"."work_viewer_grants" USING btree ("viewer_user_uuid");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "v2_uq_work_viewer_grants_work_viewer" ON "v2"."work_viewer_grants" USING btree ("work_id","viewer_user_uuid");
