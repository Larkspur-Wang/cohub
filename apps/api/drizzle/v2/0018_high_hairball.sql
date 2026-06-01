ALTER TABLE "v2"."space_sessions" ADD COLUMN "user_uuid" varchar(255);--> statement-breakpoint
CREATE INDEX "v2_idx_space_sessions_user_uuid" ON "v2"."space_sessions" USING btree ("user_uuid");