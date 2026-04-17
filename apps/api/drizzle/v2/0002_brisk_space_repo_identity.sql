ALTER TABLE "v2"."spaces" RENAME COLUMN "gitea_repo_name" TO "storage_repo_name";
--> statement-breakpoint
ALTER TABLE "v2"."spaces" ADD COLUMN "head_checkpoint_id" uuid;
--> statement-breakpoint
DROP INDEX IF EXISTS "v2"."v2_uq_spaces_user_repo_name";
--> statement-breakpoint
CREATE INDEX "v2_idx_spaces_head_checkpoint_id" ON "v2"."spaces" USING btree ("head_checkpoint_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_spaces_storage_repo_name" ON "v2"."spaces" USING btree ("storage_repo_name");
