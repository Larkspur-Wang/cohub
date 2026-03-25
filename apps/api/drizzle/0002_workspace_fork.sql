-- Add parent_id and fork_count columns to workspaces table for fork support
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "parent_id" uuid;
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "fork_count" integer NOT NULL DEFAULT 0;

-- Add index for parent_id to speed up fork origin lookups
CREATE INDEX IF NOT EXISTS "idx_workspaces_parent_id" ON "workspaces" USING btree ("parent_id");

-- Add index for visibility to speed up public workspace listings
CREATE INDEX IF NOT EXISTS "idx_workspaces_visibility" ON "workspaces" USING btree ("visibility");