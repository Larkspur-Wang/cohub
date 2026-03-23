CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"gitea_repo_name" varchar(255) NOT NULL,
	"default_branch" varchar(50) DEFAULT 'main',
	"visibility" varchar(20) DEFAULT 'public',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX "idx_agents_user_uuid" ON "agents" USING btree ("user_uuid");

CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"gitea_repo_name" varchar(255) NOT NULL,
	"default_branch" varchar(50) DEFAULT 'main',
	"visibility" varchar(20) DEFAULT 'public',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX "idx_workspaces_user_uuid" ON "workspaces" USING btree ("user_uuid");

CREATE TABLE "runtimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"workspace_id" uuid,
	"workspace_commit_hash" varchar(40),
	"agent_id" uuid,
	"agent_commit_hash" varchar(40),
	"title" varchar(255),
	"status" varchar(50) DEFAULT 'active',
	"current_session_id" uuid,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX "idx_runtimes_user_uuid" ON "runtimes" USING btree ("user_uuid");
CREATE INDEX "idx_runtimes_workspace_id" ON "runtimes" USING btree ("workspace_id");
CREATE INDEX "idx_runtimes_agent_id" ON "runtimes" USING btree ("agent_id");
CREATE INDEX "idx_runtimes_current_session_id" ON "runtimes" USING btree ("current_session_id");

CREATE TABLE "runtime_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runtime_id" uuid NOT NULL,
	"title" varchar(255),
	"status" varchar(50) DEFAULT 'active',
	"cwd" text,
	"protocol" varchar(30),
	"external_session_id" text,
	"meta" jsonb,
	"root_message_id" uuid,
	"current_leaf_message_id" uuid,
	"latest_message_text" text,
	"last_message_at" timestamp with time zone,
	"total_messages" integer DEFAULT 0 NOT NULL,
	"total_tool_calls" integer DEFAULT 0 NOT NULL,
	"total_branches" integer DEFAULT 1 NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric(18, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX "idx_runtime_sessions_runtime_id" ON "runtime_sessions" USING btree ("runtime_id");
CREATE INDEX "idx_runtime_sessions_protocol" ON "runtime_sessions" USING btree ("protocol");
CREATE INDEX "idx_runtime_sessions_current_leaf_message_id" ON "runtime_sessions" USING btree ("current_leaf_message_id");
CREATE INDEX "idx_runtime_sessions_last_message_at" ON "runtime_sessions" USING btree ("last_message_at");

CREATE TABLE "session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"source" varchar(30),
	"external_message_id" text,
	"content" jsonb NOT NULL,
	"text" text,
	"meta" jsonb,
	"parent_message_id" uuid,
	"idempotency_key" varchar(255),
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
	"created_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX "idx_session_messages_session_id" ON "session_messages" USING btree ("session_id");
CREATE INDEX "idx_session_messages_parent_message_id" ON "session_messages" USING btree ("parent_message_id");
CREATE INDEX "idx_session_messages_source" ON "session_messages" USING btree ("source");
CREATE INDEX "idx_session_messages_external_message_id" ON "session_messages" USING btree ("external_message_id");
CREATE UNIQUE INDEX "uq_session_messages_session_id_idempotency_key" ON "session_messages" USING btree ("session_id","idempotency_key");
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
	"title" text,
	"kind" varchar(50),
	"status" varchar(30),
	"args" jsonb,
	"result" jsonb,
	"content" jsonb,
	"locations" jsonb,
	"raw_input" jsonb,
	"raw_output" jsonb,
	"result_preview" text,
	"is_error" boolean DEFAULT false NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX "idx_session_tool_calls_session_id" ON "session_tool_calls" USING btree ("session_id");
CREATE INDEX "idx_session_tool_calls_message_id" ON "session_tool_calls" USING btree ("message_id");
CREATE INDEX "idx_session_tool_calls_tool_name" ON "session_tool_calls" USING btree ("tool_name");
CREATE INDEX "idx_session_tool_calls_kind" ON "session_tool_calls" USING btree ("kind");
CREATE INDEX "idx_session_tool_calls_status" ON "session_tool_calls" USING btree ("status");
CREATE UNIQUE INDEX "uq_session_tool_calls_session_tool_call_id" ON "session_tool_calls" USING btree ("session_id","tool_call_id");
