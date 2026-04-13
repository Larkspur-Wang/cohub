DROP INDEX "uq_resource_permissions_resource";--> statement-breakpoint
ALTER TABLE "resource_permissions" ADD COLUMN "grantee_uuid" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_resource_permissions_resource_grantee" ON "resource_permissions" USING btree ("resource_type","resource_id","grantee_uuid");