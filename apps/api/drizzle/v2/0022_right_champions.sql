CREATE TABLE "v2"."canvas_checkpoint_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"source_document_id" uuid NOT NULL,
	"source_space_id" uuid NOT NULL,
	"source_file_path" text NOT NULL,
	"source_version" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v2"."canvas_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "v2"."canvas_nodes" (
	"document_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"type" varchar(40) NOT NULL,
	"parent_id" text,
	"order_key" text,
	"x" double precision DEFAULT 0 NOT NULL,
	"y" double precision DEFAULT 0 NOT NULL,
	"width" double precision DEFAULT 240 NOT NULL,
	"height" double precision DEFAULT 160 NOT NULL,
	"rotation" double precision DEFAULT 0 NOT NULL,
	"ref_kind" varchar(40),
	"ref_path" text,
	"ref_url" text,
	"view" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"animation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "v2"."canvas_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"client_id" text,
	"type" varchar(80) NOT NULL,
	"payload" jsonb NOT NULL,
	"undo_group_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_canvas_checkpoint_snapshots_path" ON "v2"."canvas_checkpoint_snapshots" USING btree ("checkpoint_id","source_file_path");--> statement-breakpoint
CREATE INDEX "v2_idx_canvas_checkpoint_snapshots_checkpoint_id" ON "v2"."canvas_checkpoint_snapshots" USING btree ("checkpoint_id");--> statement-breakpoint
CREATE INDEX "v2_idx_canvas_documents_space_id" ON "v2"."canvas_documents" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_canvas_documents_space_path" ON "v2"."canvas_documents" USING btree ("space_id","file_path");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_canvas_nodes_document_node" ON "v2"."canvas_nodes" USING btree ("document_id","node_id");--> statement-breakpoint
CREATE INDEX "v2_idx_canvas_nodes_document_id" ON "v2"."canvas_nodes" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "v2_idx_canvas_nodes_viewport" ON "v2"."canvas_nodes" USING btree ("document_id","x","y","width","height");--> statement-breakpoint
CREATE INDEX "v2_idx_canvas_nodes_ref_path" ON "v2"."canvas_nodes" USING btree ("document_id","ref_path");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_canvas_updates_document_version" ON "v2"."canvas_updates" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "v2_idx_canvas_updates_document_id" ON "v2"."canvas_updates" USING btree ("document_id");