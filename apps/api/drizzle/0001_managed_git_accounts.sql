CREATE TABLE "user_git_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"provider" varchar(50) DEFAULT 'gitea' NOT NULL,
	"gitea_user_id" integer NOT NULL,
	"gitea_username" varchar(255) NOT NULL,
	"gitea_access_token" text NOT NULL,
	"status" varchar(20) DEFAULT 'active',
	"last_verified_at" timestamp with time zone,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_git_accounts_user_provider" ON "user_git_accounts" USING btree ("user_uuid","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_git_accounts_gitea_username" ON "user_git_accounts" USING btree ("gitea_username");--> statement-breakpoint
CREATE INDEX "idx_user_git_accounts_user_uuid" ON "user_git_accounts" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "idx_user_git_accounts_provider" ON "user_git_accounts" USING btree ("provider");
