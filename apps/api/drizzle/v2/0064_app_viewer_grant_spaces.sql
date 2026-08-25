-- Viewer grants become per-space: the unique key widens from (app, viewer)
-- to (app, viewer, space). Deploy order matters:
--   1. Deploy the new API code first — its authorize upsert is index-agnostic
--      and works under the old two-column index (multi-space grants return
--      409 "migration pending" until this migration lands).
--   2. Run this migration once every instance runs the new code.
-- The old code's ON CONFLICT (app_id, viewer_user_uuid) cannot run after this
-- migration, so do not migrate first.
DROP INDEX "v2"."v2_uq_app_viewer_grants_app_viewer";--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_app_viewer_grants_app_viewer_space" ON "v2"."app_viewer_grants" USING btree ("app_id","viewer_user_uuid","space_id");
