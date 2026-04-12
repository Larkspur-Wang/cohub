CREATE TABLE "cron_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"task_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"cron_expression" varchar(100) NOT NULL,
	"timezone" varchar(50) DEFAULT 'Asia/Shanghai' NOT NULL,
	"bull_job_key" varchar(500) NOT NULL,
	"workspace_id" uuid,
	"runtime_id" uuid,
	"session_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar(255) NOT NULL,
	"cron_job_id" uuid,
	"task_type" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"workspace_id" uuid,
	"runtime_id" uuid,
	"session_id" uuid,
	"user_uuid" varchar(255),
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_cron_jobs_user_uuid" ON "cron_jobs" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "idx_cron_jobs_runtime_id" ON "cron_jobs" USING btree ("runtime_id");--> statement-breakpoint
CREATE INDEX "idx_cron_jobs_enabled" ON "cron_jobs" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_cron_jobs_created_at" ON "cron_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_task_runs_job_id" ON "task_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_task_runs_cron_job_id" ON "task_runs" USING btree ("cron_job_id");--> statement-breakpoint
CREATE INDEX "idx_task_runs_workspace_id" ON "task_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_task_runs_runtime_id" ON "task_runs" USING btree ("runtime_id");--> statement-breakpoint
CREATE INDEX "idx_task_runs_session_id" ON "task_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_task_runs_user_uuid" ON "task_runs" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "idx_task_runs_status" ON "task_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_task_runs_created_at" ON "task_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_task_runs_scheduled_at" ON "task_runs" USING btree ("scheduled_at");