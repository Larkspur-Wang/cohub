ALTER TABLE "user_git_accounts" RENAME COLUMN "gitea_access_token" TO "gitea_access_token_encrypted";
--> statement-breakpoint
ALTER TABLE "user_git_accounts" ADD COLUMN "gitea_password_encrypted" text NOT NULL DEFAULT '';
