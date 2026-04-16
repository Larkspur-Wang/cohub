CREATE SCHEMA "v2";
--> statement-breakpoint
CREATE TABLE "v2"."checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"commit_hash" varchar(40) NOT NULL,
	"description" text NOT NULL,
	"parent_checkpoint_id" uuid,
	"fork_count" integer DEFAULT 0 NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."cron_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"task_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"cron_expression" varchar(100) NOT NULL,
	"timezone" varchar(50) DEFAULT 'Asia/Shanghai' NOT NULL,
	"bull_job_key" varchar(500) NOT NULL,
	"space_id" uuid,
	"session_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."gateway_logs" (
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
CREATE TABLE "v2"."proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"source_checkpoint_id" uuid NOT NULL,
	"target_space_id" uuid NOT NULL,
	"source_branch_name" varchar(255),
	"target_branch_name" varchar(255),
	"external_pr_id" varchar(255),
	"status" varchar(20) DEFAULT 'open',
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."provider_message_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(50) NOT NULL,
	"space_id" uuid NOT NULL,
	"space_session_id" uuid NOT NULL,
	"space_channel_id" uuid,
	"session_message_id" uuid,
	"direction" varchar(20) NOT NULL,
	"external_conversation_id" varchar(255) NOT NULL,
	"external_message_id" varchar(255) NOT NULL,
	"parent_external_conversation_id" varchar(255),
	"parent_external_message_id" varchar(255),
	"external_author_id" varchar(255),
	"external_author_name" varchar(255),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."resource_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" varchar(20) NOT NULL,
	"resource_id" uuid NOT NULL,
	"grantee_uuid" varchar(255),
	"level" varchar(20) DEFAULT 'read' NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" jsonb NOT NULL,
	"text" text,
	"provider" varchar(100),
	"model" varchar(255),
	"stop_reason" varchar(50),
	"error_message" text,
	"sequence" integer NOT NULL,
	"idempotency_key" varchar(255),
	"usage_input" integer,
	"usage_output" integer,
	"cost_total" numeric(18, 8),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."space_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."space_session_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"space_session_id" uuid NOT NULL,
	"space_channel_id" uuid NOT NULL,
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
CREATE TABLE "v2"."space_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"title" varchar(255),
	"source" varchar(255),
	"status" varchar(50) DEFAULT 'active',
	"cwd" text,
	"protocol" varchar(30),
	"external_session_id" text,
	"meta" jsonb,
	"parent_session_id" uuid,
	"forked_from_message_id" uuid,
	"lineage_root_session_id" uuid,
	"fork_depth" integer DEFAULT 0 NOT NULL,
	"latest_message_text" text,
	"last_message_at" timestamp with time zone,
	"last_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"gitea_repo_name" varchar(255) NOT NULL,
	"base_checkpoint_id" uuid,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."task_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar(255) NOT NULL,
	"cron_job_id" uuid,
	"task_type" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"space_id" uuid,
	"session_id" uuid,
	"user_uuid" varchar(255),
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."user_channels" (
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
CREATE TABLE "v2"."user_git_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"provider" varchar(50) DEFAULT 'gitea' NOT NULL,
	"gitea_user_id" integer NOT NULL,
	"gitea_username" varchar(255) NOT NULL,
	"gitea_password_encrypted" text NOT NULL,
	"gitea_access_token_encrypted" text NOT NULL,
	"status" varchar(20) DEFAULT 'active',
	"last_verified_at" timestamp with time zone,
	"ssh_public_keys" jsonb,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "v2_idx_checkpoints_space_id" ON "v2"."checkpoints" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "v2_idx_checkpoints_parent_id" ON "v2"."checkpoints" USING btree ("parent_checkpoint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_checkpoints_space_commit" ON "v2"."checkpoints" USING btree ("space_id","commit_hash");--> statement-breakpoint
CREATE INDEX "v2_idx_cron_jobs_user_uuid" ON "v2"."cron_jobs" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "v2_idx_cron_jobs_space_id" ON "v2"."cron_jobs" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "v2_idx_cron_jobs_enabled" ON "v2"."cron_jobs" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "v2_idx_cron_jobs_created_at" ON "v2"."cron_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "v2_idx_gateway_logs_channel" ON "v2"."gateway_logs" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "v2_idx_gateway_logs_direction" ON "v2"."gateway_logs" USING btree ("direction");--> statement-breakpoint
CREATE INDEX "v2_idx_gateway_logs_created" ON "v2"."gateway_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "v2_idx_proposals_target_space_id" ON "v2"."proposals" USING btree ("target_space_id");--> statement-breakpoint
CREATE INDEX "v2_idx_proposals_source_checkpoint_id" ON "v2"."proposals" USING btree ("source_checkpoint_id");--> statement-breakpoint
CREATE INDEX "v2_idx_proposals_status" ON "v2"."proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "v2_idx_provider_message_refs_provider_conversation" ON "v2"."provider_message_refs" USING btree ("provider","external_conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_provider_message_refs_provider_message" ON "v2"."provider_message_refs" USING btree ("provider","external_conversation_id","external_message_id","direction");--> statement-breakpoint
CREATE INDEX "v2_idx_provider_message_refs_space_session" ON "v2"."provider_message_refs" USING btree ("space_session_id");--> statement-breakpoint
CREATE INDEX "v2_idx_provider_message_refs_session_message" ON "v2"."provider_message_refs" USING btree ("session_message_id");--> statement-breakpoint
CREATE INDEX "v2_idx_provider_message_refs_parent_message" ON "v2"."provider_message_refs" USING btree ("provider","parent_external_conversation_id","parent_external_message_id");--> statement-breakpoint
CREATE INDEX "v2_idx_provider_message_refs_space_channel" ON "v2"."provider_message_refs" USING btree ("space_channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_resource_permissions_resource_grantee" ON "v2"."resource_permissions" USING btree ("resource_type","resource_id","grantee_uuid");--> statement-breakpoint
CREATE INDEX "v2_idx_session_messages_session_id" ON "v2"."session_messages" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_session_messages_session_sequence" ON "v2"."session_messages" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_session_messages_session_id_idempotency_key" ON "v2"."session_messages" USING btree ("session_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "v2_idx_space_channels_space" ON "v2"."space_channels" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_space_channels_channel" ON "v2"."space_channels" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_session_bindings_space" ON "v2"."space_session_bindings" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_session_bindings_session" ON "v2"."space_session_bindings" USING btree ("space_session_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_session_bindings_channel" ON "v2"."space_session_bindings" USING btree ("space_channel_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_session_bindings_binding_key" ON "v2"."space_session_bindings" USING btree ("binding_key");--> statement-breakpoint
CREATE INDEX "v2_idx_space_session_bindings_external_chat" ON "v2"."space_session_bindings" USING btree ("external_chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_space_session_bindings_channel_binding" ON "v2"."space_session_bindings" USING btree ("space_channel_id","binding_key");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sessions_space_id" ON "v2"."space_sessions" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sessions_parent_session_id" ON "v2"."space_sessions" USING btree ("parent_session_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sessions_lineage_root_session_id" ON "v2"."space_sessions" USING btree ("lineage_root_session_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sessions_forked_from_message_id" ON "v2"."space_sessions" USING btree ("forked_from_message_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sessions_last_message_id" ON "v2"."space_sessions" USING btree ("last_message_id");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sessions_last_message_at" ON "v2"."space_sessions" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "v2_idx_spaces_user_uuid" ON "v2"."spaces" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "v2_idx_spaces_base_checkpoint_id" ON "v2"."spaces" USING btree ("base_checkpoint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_spaces_user_name" ON "v2"."spaces" USING btree ("user_uuid","name");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_spaces_user_repo_name" ON "v2"."spaces" USING btree ("user_uuid","gitea_repo_name");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_task_runs_job_id" ON "v2"."task_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "v2_idx_task_runs_cron_job_id" ON "v2"."task_runs" USING btree ("cron_job_id");--> statement-breakpoint
CREATE INDEX "v2_idx_task_runs_space_id" ON "v2"."task_runs" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "v2_idx_task_runs_session_id" ON "v2"."task_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "v2_idx_task_runs_user_uuid" ON "v2"."task_runs" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "v2_idx_task_runs_status" ON "v2"."task_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "v2_idx_task_runs_created_at" ON "v2"."task_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "v2_idx_task_runs_scheduled_at" ON "v2"."task_runs" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "v2_idx_user_channels_user_uuid" ON "v2"."user_channels" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "v2_idx_user_channels_provider" ON "v2"."user_channels" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_user_git_accounts_user_provider" ON "v2"."user_git_accounts" USING btree ("user_uuid","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_user_git_accounts_gitea_username" ON "v2"."user_git_accounts" USING btree ("gitea_username");--> statement-breakpoint
CREATE INDEX "v2_idx_user_git_accounts_user_uuid" ON "v2"."user_git_accounts" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "v2_idx_user_git_accounts_provider" ON "v2"."user_git_accounts" USING btree ("provider");