DROP INDEX IF EXISTS "v2"."v2_idx_work_versions_space_id";

ALTER TABLE "v2"."work_versions" DROP COLUMN IF EXISTS "space_id";
ALTER TABLE "v2"."work_versions" DROP COLUMN IF EXISTS "status";
ALTER TABLE "v2"."work_versions" DROP COLUMN IF EXISTS "meta";
ALTER TABLE "v2"."work_versions" DROP COLUMN IF EXISTS "published_at";
