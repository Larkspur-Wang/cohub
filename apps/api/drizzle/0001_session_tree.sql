ALTER TABLE "sessions" ADD COLUMN "root_message_id" uuid;
ALTER TABLE "sessions" ADD COLUMN "current_leaf_message_id" uuid;
ALTER TABLE "sessions" ADD COLUMN "latest_message_text" text;
ALTER TABLE "sessions" ADD COLUMN "last_message_at" timestamp with time zone;
ALTER TABLE "sessions" ADD COLUMN "total_messages" integer DEFAULT 0 NOT NULL;
ALTER TABLE "sessions" ADD COLUMN "total_tool_calls" integer DEFAULT 0 NOT NULL;
ALTER TABLE "sessions" ADD COLUMN "total_branches" integer DEFAULT 1 NOT NULL;
ALTER TABLE "sessions" ADD COLUMN "total_input_tokens" integer DEFAULT 0 NOT NULL;
ALTER TABLE "sessions" ADD COLUMN "total_output_tokens" integer DEFAULT 0 NOT NULL;
ALTER TABLE "sessions" ADD COLUMN "total_cost" numeric(18, 8) DEFAULT '0' NOT NULL;
ALTER TABLE "sessions" ADD COLUMN "raw_session_oss_key" text;
CREATE INDEX "idx_sessions_current_leaf_message_id" ON "sessions" USING btree ("current_leaf_message_id");
CREATE INDEX "idx_sessions_last_message_at" ON "sessions" USING btree ("last_message_at");

CREATE TABLE "session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" jsonb NOT NULL,
	"text" text,
	"parent_message_id" uuid,
	"depth" integer DEFAULT 0 NOT NULL,
	"branch_id" uuid NOT NULL,
	"branch_index" integer,
	"child_count" integer DEFAULT 0 NOT NULL,
	"is_branch_point" boolean DEFAULT false NOT NULL,
	"is_leaf" boolean DEFAULT true NOT NULL,
	"provider" varchar(100),
	"model" varchar(255),
	"stop_reason" varchar(50),
	"error_message" text,
	"usage_input" integer,
	"usage_output" integer,
	"usage_total_tokens" integer,
	"cost_total" numeric(18, 8),
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "session_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action
);
CREATE INDEX "idx_session_messages_session_id" ON "session_messages" USING btree ("session_id");
CREATE INDEX "idx_session_messages_parent_message_id" ON "session_messages" USING btree ("parent_message_id");
CREATE INDEX "idx_session_messages_branch_id" ON "session_messages" USING btree ("branch_id");
CREATE INDEX "idx_session_messages_session_branch_created_at" ON "session_messages" USING btree ("session_id","branch_id","created_at");
CREATE INDEX "idx_session_messages_session_is_leaf" ON "session_messages" USING btree ("session_id","is_leaf");
CREATE INDEX "idx_session_messages_session_depth" ON "session_messages" USING btree ("session_id","depth");

CREATE TABLE "session_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"tool_call_id" varchar(255) NOT NULL,
	"tool_name" varchar(255) NOT NULL,
	"args" jsonb,
	"result" jsonb,
	"result_preview" text,
	"is_error" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "session_tool_calls_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "session_tool_calls_message_id_session_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."session_messages"("id") ON DELETE cascade ON UPDATE no action
);
CREATE INDEX "idx_session_tool_calls_session_id" ON "session_tool_calls" USING btree ("session_id");
CREATE INDEX "idx_session_tool_calls_message_id" ON "session_tool_calls" USING btree ("message_id");
CREATE INDEX "idx_session_tool_calls_tool_name" ON "session_tool_calls" USING btree ("tool_name");
CREATE UNIQUE INDEX "uq_session_tool_calls_session_tool_call_id" ON "session_tool_calls" USING btree ("session_id","tool_call_id");
