ALTER TABLE "v2"."works" ALTER COLUMN "status" SET DEFAULT 'disabled';--> statement-breakpoint
WITH inserted_versions AS (
	INSERT INTO "v2"."work_versions" (
		"work_id",
		"version",
		"target_type",
		"target_ref",
		"asset_key",
		"created_at"
	)
	SELECT
		"v2"."works"."id",
		COALESCE(MAX("v2"."work_versions"."version"), 0) + 1,
		"v2"."works"."target_type",
		"v2"."works"."target_ref",
		"v2"."works"."asset_key",
		COALESCE("v2"."works"."published_at", "v2"."works"."updated_at", "v2"."works"."created_at", now())
	FROM "v2"."works"
	LEFT JOIN "v2"."work_versions" ON "v2"."work_versions"."work_id" = "v2"."works"."id"
	WHERE "v2"."works"."status" = 'published'
		AND "v2"."works"."current_version_id" IS NULL
	GROUP BY
		"v2"."works"."id",
		"v2"."works"."target_type",
		"v2"."works"."target_ref",
		"v2"."works"."asset_key",
		"v2"."works"."published_at",
		"v2"."works"."updated_at",
		"v2"."works"."created_at"
	RETURNING "id", "work_id", "version"
)
UPDATE "v2"."works"
SET
	"current_version_id" = inserted_versions."id",
	"latest_version" = inserted_versions."version"
FROM inserted_versions
WHERE "v2"."works"."id" = inserted_versions."work_id";--> statement-breakpoint
UPDATE "v2"."works" SET "status" = 'disabled' WHERE "status" = 'draft';--> statement-breakpoint
ALTER TABLE "v2"."works" ADD CONSTRAINT "v2_chk_works_status" CHECK ("v2"."works"."status" in ('published', 'disabled'));
