ALTER TABLE "v2"."session_messages" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "v2"."session_messages" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "v2"."session_messages" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "v2"."session_turns" ADD COLUMN "duration_ms" integer;