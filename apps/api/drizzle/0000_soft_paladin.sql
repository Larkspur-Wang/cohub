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
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"world_id" uuid,
	"world_commit_hash" varchar(40),
	"agent_id" uuid,
	"agent_commit_hash" varchar(40),
	"title" varchar(255),
	"status" varchar(50) DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worlds" (
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
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agents_user_uuid" ON "agents" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_uuid" ON "sessions" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "idx_worlds_user_uuid" ON "worlds" USING btree ("user_uuid");