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
--> statement-breakpoint
CREATE TABLE "gateway_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" varchar(10) NOT NULL,
	"provider" varchar(50) NOT NULL,
	"channel_id" uuid,
	"external_chat_id" varchar(255),
	"raw_payload" jsonb NOT NULL,
	"normalized_payload" jsonb,
	"status" varchar(20) DEFAULT 'success',
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "runtime_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runtime_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_chat_id" varchar(255) NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "runtime_session_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runtime_id" uuid NOT NULL,
	"runtime_session_id" uuid NOT NULL,
	"runtime_channel_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"binding_key" varchar(255) NOT NULL,
	"external_chat_id" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'active',
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"last_message_at" timestamp with time zone
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "user_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"provider" varchar(50) NOT NULL,
	"name" varchar(255),
	"credentials" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_git_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"provider" varchar(50) DEFAULT 'gitea' NOT NULL,
	"gitea_user_id" integer NOT NULL,
	"gitea_username" varchar(255) NOT NULL,
	"gitea_password_encrypted" text NOT NULL,
	"gitea_access_token_encrypted" text NOT NULL,
	"status" varchar(20) DEFAULT 'active',
	"last_verified_at" timestamp with time zone,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX "idx_agents_user_uuid" ON "agents" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "idx_gateway_logs_channel" ON "gateway_logs" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_gateway_logs_direction" ON "gateway_logs" USING btree ("direction");--> statement-breakpoint
CREATE INDEX "idx_gateway_logs_created" ON "gateway_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_runtime_channels_runtime" ON "runtime_channels" USING btree ("runtime_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_channels_channel" ON "runtime_channels" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_channels_external_chat" ON "runtime_channels" USING btree ("external_chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_runtime_channel_chat" ON "runtime_channels" USING btree ("channel_id","external_chat_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_session_bindings_runtime" ON "runtime_session_bindings" USING btree ("runtime_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_session_bindings_session" ON "runtime_session_bindings" USING btree ("runtime_session_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_session_bindings_channel" ON "runtime_session_bindings" USING btree ("runtime_channel_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_session_bindings_binding_key" ON "runtime_session_bindings" USING btree ("binding_key");--> statement-breakpoint
CREATE INDEX "idx_runtime_session_bindings_external_chat" ON "runtime_session_bindings" USING btree ("external_chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_runtime_session_bindings_channel_binding" ON "runtime_session_bindings" USING btree ("runtime_channel_id","binding_key");--> statement-breakpoint
CREATE INDEX "idx_runtime_sessions_runtime_id" ON "runtime_sessions" USING btree ("runtime_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_sessions_protocol" ON "runtime_sessions" USING btree ("protocol");--> statement-breakpoint
CREATE INDEX "idx_runtime_sessions_current_leaf_message_id" ON "runtime_sessions" USING btree ("current_leaf_message_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_sessions_last_message_at" ON "runtime_sessions" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "idx_runtimes_user_uuid" ON "runtimes" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "idx_runtimes_workspace_id" ON "runtimes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_runtimes_agent_id" ON "runtimes" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_runtimes_current_session_id" ON "runtimes" USING btree ("current_session_id");--> statement-breakpoint
CREATE INDEX "idx_session_messages_session_id" ON "session_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_session_messages_parent_message_id" ON "session_messages" USING btree ("parent_message_id");--> statement-breakpoint
CREATE INDEX "idx_session_messages_source" ON "session_messages" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_session_messages_external_message_id" ON "session_messages" USING btree ("external_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_session_messages_session_id_idempotency_key" ON "session_messages" USING btree ("session_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_session_messages_branch_id" ON "session_messages" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_session_messages_session_branch_created_at" ON "session_messages" USING btree ("session_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_session_messages_session_is_leaf" ON "session_messages" USING btree ("session_id","is_leaf");--> statement-breakpoint
CREATE INDEX "idx_session_messages_session_depth" ON "session_messages" USING btree ("session_id","depth");--> statement-breakpoint
CREATE INDEX "idx_session_tool_calls_session_id" ON "session_tool_calls" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_session_tool_calls_message_id" ON "session_tool_calls" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_session_tool_calls_tool_name" ON "session_tool_calls" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "idx_session_tool_calls_kind" ON "session_tool_calls" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_session_tool_calls_status" ON "session_tool_calls" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_session_tool_calls_session_tool_call_id" ON "session_tool_calls" USING btree ("session_id","tool_call_id");--> statement-breakpoint
CREATE INDEX "idx_user_channels_user_uuid" ON "user_channels" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "idx_user_channels_provider" ON "user_channels" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_git_accounts_user_provider" ON "user_git_accounts" USING btree ("user_uuid","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_git_accounts_gitea_username" ON "user_git_accounts" USING btree ("gitea_username");--> statement-breakpoint
CREATE INDEX "idx_user_git_accounts_user_uuid" ON "user_git_accounts" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "idx_user_git_accounts_provider" ON "user_git_accounts" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_workspaces_user_uuid" ON "workspaces" USING btree ("user_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspaces_user_name" ON "workspaces" USING btree ("user_uuid","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspaces_user_repo_name" ON "workspaces" USING btree ("user_uuid","gitea_repo_name");