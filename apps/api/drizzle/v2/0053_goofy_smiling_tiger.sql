CREATE TABLE "v2"."board_connections" (
	"board_id" uuid NOT NULL,
	"connection_id" text NOT NULL,
	"source_node_id" text NOT NULL,
	"target_node_id" text NOT NULL,
	"relation" varchar(64) DEFAULT 'related' NOT NULL,
	"direction" varchar(16) DEFAULT 'forward' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"source_anchor" jsonb DEFAULT '{"kind":"auto"}'::jsonb NOT NULL,
	"target_anchor" jsonb DEFAULT '{"kind":"auto"}'::jsonb NOT NULL,
	"routing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_connections_board_connection" ON "v2"."board_connections" USING btree ("board_id","connection_id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_connections_board_id" ON "v2"."board_connections" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_connections_source" ON "v2"."board_connections" USING btree ("board_id","source_node_id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_connections_target" ON "v2"."board_connections" USING btree ("board_id","target_node_id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_connections_relation" ON "v2"."board_connections" USING btree ("board_id","relation");