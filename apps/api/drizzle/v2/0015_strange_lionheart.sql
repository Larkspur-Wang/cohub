DROP INDEX "v2"."v2_uq_space_mods_space_mount_slug";--> statement-breakpoint
ALTER TABLE "v2"."space_mods" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "v2"."space_mods" DROP COLUMN "mount_slug";