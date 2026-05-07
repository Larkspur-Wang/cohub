CREATE TABLE "v2"."user_profiles" (
	"user_uuid" varchar(255) PRIMARY KEY NOT NULL,
	"logto_user_id" varchar(255) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"avatar_url" text,
	"source" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_user_profiles_logto_user_id" ON "v2"."user_profiles" USING btree ("logto_user_id");--> statement-breakpoint
CREATE INDEX "v2_idx_user_profiles_updated_at" ON "v2"."user_profiles" USING btree ("updated_at");