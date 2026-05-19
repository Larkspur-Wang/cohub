ALTER TABLE "v2"."user_profiles" ADD COLUMN "username" varchar(39);--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_user_profiles_username" ON "v2"."user_profiles" USING btree ("username");