CREATE TABLE "v2"."session_forks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_session_id" uuid NOT NULL,
	"child_session_id" uuid NOT NULL,
	"root_session_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	"anchor_source_session_id" uuid NOT NULL,
	"anchor_turn_id" uuid NOT NULL,
	"anchor_sequence" integer NOT NULL,
	"ancestor_session_ids" uuid[] NOT NULL,
	"session_path" uuid[] NOT NULL,
	"created_by" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."session_turn_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"source_session_id" uuid NOT NULL,
	"from_sequence" integer NOT NULL,
	"to_sequence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "v2"."v2_idx_space_sessions_parent_session_id";--> statement-breakpoint
DROP INDEX "v2"."v2_idx_space_sessions_lineage_root_session_id";--> statement-breakpoint
DROP INDEX "v2"."v2_idx_space_sessions_forked_from_message_id";--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_session_forks_child" ON "v2"."session_forks" USING btree ("child_session_id");--> statement-breakpoint
CREATE INDEX "v2_idx_session_forks_parent" ON "v2"."session_forks" USING btree ("parent_session_id");--> statement-breakpoint
CREATE INDEX "v2_idx_session_forks_root_depth" ON "v2"."session_forks" USING btree ("root_session_id","depth","created_at");--> statement-breakpoint
CREATE INDEX "v2_idx_session_forks_anchor_turn" ON "v2"."session_forks" USING btree ("anchor_turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_session_turn_segments_session_ordinal" ON "v2"."session_turn_segments" USING btree ("session_id","ordinal");--> statement-breakpoint
CREATE INDEX "v2_idx_session_turn_segments_session" ON "v2"."session_turn_segments" USING btree ("session_id","ordinal");--> statement-breakpoint
CREATE INDEX "v2_idx_session_turn_segments_source" ON "v2"."session_turn_segments" USING btree ("source_session_id");--> statement-breakpoint
INSERT INTO "v2"."session_turn_segments" ("session_id", "ordinal", "source_session_id", "from_sequence", "to_sequence")
SELECT "id", 1, "id", 1, NULL
FROM "v2"."space_sessions";--> statement-breakpoint
ALTER TABLE "v2"."space_sessions" DROP COLUMN "parent_session_id";--> statement-breakpoint
ALTER TABLE "v2"."space_sessions" DROP COLUMN "forked_from_message_id";--> statement-breakpoint
ALTER TABLE "v2"."space_sessions" DROP COLUMN "lineage_root_session_id";--> statement-breakpoint
ALTER TABLE "v2"."space_sessions" DROP COLUMN "fork_depth";