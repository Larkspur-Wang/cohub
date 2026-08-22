-- Re-applied after fixing inversed journal `when` ordering on merge (0063 < 0062).
-- Semantics unchanged; this marker ensures the file diffs so CI re-runs migrate.
-- Rename the Work storage layer to App: tables, columns, indexes, and checks
-- are pure metadata renames, so no row data moves. All identifiers keep the
-- v2_ naming convention.
ALTER TABLE "v2"."works" RENAME TO "apps";--> statement-breakpoint
ALTER TABLE "v2"."apps" RENAME COLUMN "work_scopes" TO "app_scopes";--> statement-breakpoint
ALTER INDEX "v2_idx_works_space_id" RENAME TO "v2_idx_apps_space_id";--> statement-breakpoint
ALTER INDEX "v2_idx_works_user_uuid" RENAME TO "v2_idx_apps_user_uuid";--> statement-breakpoint
ALTER INDEX "v2_idx_works_status" RENAME TO "v2_idx_apps_status";--> statement-breakpoint
ALTER INDEX "v2_idx_works_visibility" RENAME TO "v2_idx_apps_visibility";--> statement-breakpoint
ALTER INDEX "v2_uq_works_space_slug" RENAME TO "v2_uq_apps_space_slug";--> statement-breakpoint
ALTER TABLE "v2"."apps" RENAME CONSTRAINT "v2_chk_works_status" TO "v2_chk_apps_status";--> statement-breakpoint
ALTER TABLE "v2"."apps" RENAME CONSTRAINT "v2_chk_works_visibility" TO "v2_chk_apps_visibility";--> statement-breakpoint
ALTER TABLE "v2"."apps" RENAME CONSTRAINT "v2_chk_works_slug_format" TO "v2_chk_apps_slug_format";--> statement-breakpoint
ALTER TABLE "v2"."work_versions" RENAME TO "app_versions";--> statement-breakpoint
ALTER TABLE "v2"."app_versions" RENAME COLUMN "work_id" TO "app_id";--> statement-breakpoint
ALTER INDEX "v2_idx_work_versions_work_id" RENAME TO "v2_idx_app_versions_app_id";--> statement-breakpoint
ALTER INDEX "v2_uq_work_versions_work_version" RENAME TO "v2_uq_app_versions_app_version";--> statement-breakpoint
ALTER TABLE "v2"."app_versions" RENAME CONSTRAINT "v2_chk_work_versions_content_kind" TO "v2_chk_app_versions_content_kind";--> statement-breakpoint
ALTER TABLE "v2"."work_view_stats_hourly" RENAME TO "app_view_stats_hourly";--> statement-breakpoint
ALTER TABLE "v2"."app_view_stats_hourly" RENAME COLUMN "work_id" TO "app_id";--> statement-breakpoint
ALTER TABLE "v2"."app_view_stats_hourly" RENAME COLUMN "work_version_id" TO "app_version_id";--> statement-breakpoint
ALTER INDEX "v2_uq_work_view_stats_hourly_bucket_dims" RENAME TO "v2_uq_app_view_stats_hourly_bucket_dims";--> statement-breakpoint
ALTER INDEX "v2_idx_work_view_stats_hourly_work_bucket" RENAME TO "v2_idx_app_view_stats_hourly_app_bucket";--> statement-breakpoint
ALTER INDEX "v2_idx_work_view_stats_hourly_work_version" RENAME TO "v2_idx_app_view_stats_hourly_app_version";--> statement-breakpoint
ALTER TABLE "v2"."work_promotions" RENAME TO "app_promotions";--> statement-breakpoint
ALTER TABLE "v2"."app_promotions" RENAME COLUMN "work_id" TO "app_id";--> statement-breakpoint
ALTER INDEX "v2_idx_work_promotions_work_id" RENAME TO "v2_idx_app_promotions_app_id";--> statement-breakpoint
ALTER TABLE "v2"."app_promotions" RENAME CONSTRAINT "v2_chk_work_promotions_provider" TO "v2_chk_app_promotions_provider";--> statement-breakpoint
ALTER TABLE "v2"."work_promotion_stats_hourly" RENAME TO "app_promotion_stats_hourly";--> statement-breakpoint
ALTER TABLE "v2"."app_promotion_stats_hourly" RENAME COLUMN "work_version_id" TO "app_version_id";--> statement-breakpoint
ALTER INDEX "v2_uq_work_promotion_stats_hourly_dims" RENAME TO "v2_uq_app_promotion_stats_hourly_dims";--> statement-breakpoint
ALTER INDEX "v2_idx_work_promotion_stats_hourly_promotion_bucket" RENAME TO "v2_idx_app_promotion_stats_hourly_promotion_bucket";--> statement-breakpoint
ALTER TABLE "v2"."work_viewer_grants" RENAME TO "app_viewer_grants";--> statement-breakpoint
ALTER TABLE "v2"."app_viewer_grants" RENAME COLUMN "work_id" TO "app_id";--> statement-breakpoint
ALTER INDEX "v2_idx_work_viewer_grants_work_id" RENAME TO "v2_idx_app_viewer_grants_app_id";--> statement-breakpoint
ALTER INDEX "v2_idx_work_viewer_grants_space_id" RENAME TO "v2_idx_app_viewer_grants_space_id";--> statement-breakpoint
ALTER INDEX "v2_idx_work_viewer_grants_viewer_user_uuid" RENAME TO "v2_idx_app_viewer_grants_viewer_user_uuid";--> statement-breakpoint
ALTER INDEX "v2_uq_work_viewer_grants_work_viewer" RENAME TO "v2_uq_app_viewer_grants_app_viewer";--> statement-breakpoint
-- resource_references is a rebuildable index; rewrite stored mention edges to
-- the new app vocabulary so history keeps rendering without legacy readers.
UPDATE "v2"."resource_references" SET "target_type" = 'app' WHERE "target_type" = 'work';--> statement-breakpoint
UPDATE "v2"."resource_references" SET "source_type" = 'app' WHERE "source_type" = 'work';--> statement-breakpoint
UPDATE "v2"."resource_references"
SET "meta" = ("meta" - 'workSlug') || jsonb_build_object('appSlug', "meta"->'workSlug')
WHERE "meta" ? 'workSlug';
