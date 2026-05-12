CREATE INDEX "v2_idx_session_turns_user_text_trgm" ON "v2"."session_turns" USING gin ("user_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "v2_idx_space_members_user_space" ON "v2"."space_members" USING btree ("user_id","space_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sessions_title_trgm" ON "v2"."space_sessions" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "v2_idx_space_sessions_space_last_message_id" ON "v2"."space_sessions" USING btree ("space_id","last_message_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "v2_idx_spaces_name_trgm" ON "v2"."spaces" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "v2_idx_spaces_description_trgm" ON "v2"."spaces" USING gin ("description" gin_trgm_ops);