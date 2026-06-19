ALTER TABLE "v2"."works" ADD COLUMN "current_version_id" uuid;
ALTER TABLE "v2"."works" ADD COLUMN "latest_version" integer DEFAULT 0 NOT NULL;

CREATE TABLE "v2"."work_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(20) DEFAULT 'published' NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_ref" text NOT NULL,
	"asset_key" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"published_at" timestamp with time zone
);

CREATE INDEX "v2_idx_work_versions_work_id" ON "v2"."work_versions" USING btree ("work_id");
CREATE INDEX "v2_idx_work_versions_space_id" ON "v2"."work_versions" USING btree ("space_id");
CREATE UNIQUE INDEX "v2_uq_work_versions_work_version" ON "v2"."work_versions" USING btree ("work_id","version");

WITH inserted_versions AS (
	INSERT INTO "v2"."work_versions" (
		"work_id",
		"space_id",
		"version",
		"status",
		"target_type",
		"target_ref",
		"asset_key",
		"meta",
		"created_at",
		"published_at"
	)
	SELECT
		"id",
		"space_id",
		1,
		"status",
		"target_type",
		"target_ref",
		"asset_key",
		'{"reason":"backfill"}'::jsonb,
		COALESCE("published_at", "created_at", now()),
		"published_at"
	FROM "v2"."works"
	WHERE "status" = 'published'
	RETURNING "id", "work_id"
)
UPDATE "v2"."works"
SET
	"current_version_id" = inserted_versions."id",
	"latest_version" = 1
FROM inserted_versions
WHERE "v2"."works"."id" = inserted_versions."work_id";
