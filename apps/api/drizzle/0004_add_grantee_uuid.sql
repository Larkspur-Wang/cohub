-- Add granteeUuid column for collaborator support
ALTER TABLE "resource_permissions" ADD COLUMN "grantee_uuid" varchar(255);

-- Drop old unique index
DROP INDEX IF EXISTS "uq_resource_permissions_resource";

-- Create new composite unique index
CREATE UNIQUE INDEX "uq_resource_permissions_resource_grantee" ON "resource_permissions" ("resource_type", "resource_id", "grantee_uuid");
