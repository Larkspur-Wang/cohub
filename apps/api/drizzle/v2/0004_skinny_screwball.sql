CREATE TABLE "v2"."session_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_uuid" varchar(255),
	"sequence" integer NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"intent" varchar(20) DEFAULT 'steer' NOT NULL,
	"user_content" jsonb NOT NULL,
	"user_text" text,
	"assistant_content" jsonb,
	"assistant_text" text,
	"provider" varchar(100),
	"model" varchar(255),
	"stop_reason" varchar(50),
	"error_message" text,
	"usage" jsonb,
	"summary" jsonb,
	"intermediate_index" jsonb,
	"intermediate_summary" jsonb,
	"meta" jsonb,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "v2_idx_session_turns_session_id" ON "v2"."session_turns" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_session_turns_session_sequence" ON "v2"."session_turns" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "v2_idx_session_turns_user_uuid" ON "v2"."session_turns" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "v2_idx_session_turns_status" ON "v2"."session_turns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "v2_idx_session_turns_created_at" ON "v2"."session_turns" USING btree ("created_at");