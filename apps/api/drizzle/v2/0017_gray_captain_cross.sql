ALTER TABLE "v2"."checkpoints" ADD COLUMN "root_checkpoint_id" uuid;--> statement-breakpoint
CREATE INDEX "v2_idx_checkpoints_root_id" ON "v2"."checkpoints" USING btree ("root_checkpoint_id");