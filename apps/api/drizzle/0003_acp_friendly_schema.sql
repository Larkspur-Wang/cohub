ALTER TABLE "sessions" ADD COLUMN "cwd" text;
ALTER TABLE "sessions" ADD COLUMN "protocol" varchar(30);
ALTER TABLE "sessions" ADD COLUMN "meta" jsonb;
CREATE INDEX "idx_sessions_protocol" ON "sessions" USING btree ("protocol");

ALTER TABLE "session_messages" ADD COLUMN "source" varchar(30);
ALTER TABLE "session_messages" ADD COLUMN "external_message_id" text;
ALTER TABLE "session_messages" ADD COLUMN "meta" jsonb;
CREATE INDEX "idx_session_messages_source" ON "session_messages" USING btree ("source");
CREATE INDEX "idx_session_messages_external_message_id" ON "session_messages" USING btree ("external_message_id");

ALTER TABLE "session_tool_calls" ADD COLUMN "title" text;
ALTER TABLE "session_tool_calls" ADD COLUMN "kind" varchar(50);
ALTER TABLE "session_tool_calls" ADD COLUMN "status" varchar(30);
ALTER TABLE "session_tool_calls" ADD COLUMN "content" jsonb;
ALTER TABLE "session_tool_calls" ADD COLUMN "locations" jsonb;
ALTER TABLE "session_tool_calls" ADD COLUMN "raw_input" jsonb;
ALTER TABLE "session_tool_calls" ADD COLUMN "raw_output" jsonb;
ALTER TABLE "session_tool_calls" ADD COLUMN "meta" jsonb;
CREATE INDEX "idx_session_tool_calls_kind" ON "session_tool_calls" USING btree ("kind");
CREATE INDEX "idx_session_tool_calls_status" ON "session_tool_calls" USING btree ("status");
