CREATE TABLE IF NOT EXISTS "v2"."labels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope_type" varchar(30) NOT NULL,
  "scope_id" text NOT NULL,
  "name" varchar(80) NOT NULL,
  "slug" varchar(100) NOT NULL,
  "parent_id" uuid,
  "depth" integer DEFAULT 0 NOT NULL,
  "source" varchar(30) DEFAULT 'user' NOT NULL,
  "system_key" varchar(120),
  "rank" integer DEFAULT 0 NOT NULL,
  "created_by" varchar(255),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "v2"."label_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "label_id" uuid NOT NULL,
  "scope_type" varchar(30) NOT NULL,
  "scope_id" text NOT NULL,
  "resource_type" varchar(30) NOT NULL,
  "resource_ref" text NOT NULL,
  "rank" integer DEFAULT 0 NOT NULL,
  "source" varchar(30) DEFAULT 'user' NOT NULL,
  "created_by" varchar(255),
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "v2_idx_labels_scope_rank" ON "v2"."labels" USING btree ("scope_type","scope_id","rank");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "v2_idx_labels_scope_parent" ON "v2"."labels" USING btree ("scope_type","scope_id","parent_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "v2_uq_labels_scope_system_key" ON "v2"."labels" USING btree ("scope_type","scope_id","system_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "v2_uq_label_assignments_label_resource" ON "v2"."label_assignments" USING btree ("label_id","resource_type","resource_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "v2_idx_label_assignments_label_rank" ON "v2"."label_assignments" USING btree ("label_id","rank");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "v2_idx_label_assignments_scope_resource" ON "v2"."label_assignments" USING btree ("scope_type","scope_id","resource_type","resource_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "v2_idx_label_assignments_scope_label" ON "v2"."label_assignments" USING btree ("scope_type","scope_id","label_id");
--> statement-breakpoint
WITH pinned_spaces AS (
  SELECT
    space_id,
    min(created_by) AS created_by,
    min(created_at) AS created_at
  FROM "v2"."space_marks"
  WHERE kind = 'pin'
  GROUP BY space_id
), migrated_labels AS (
  INSERT INTO "v2"."labels" (
    scope_type,
    scope_id,
    name,
    slug,
    parent_id,
    depth,
    source,
    system_key,
    rank,
    created_by,
    created_at,
    updated_at
  )
  SELECT
    'space',
    space_id::text,
    'Pinned',
    'pinned',
    NULL,
    0,
    'migration',
    'legacy:pinned',
    0,
    created_by,
    created_at,
    now()
  FROM pinned_spaces
  ON CONFLICT (scope_type, scope_id, system_key) DO UPDATE SET
    updated_at = "v2"."labels"."updated_at"
  RETURNING id, scope_id
)
INSERT INTO "v2"."label_assignments" (
  label_id,
  scope_type,
  scope_id,
  resource_type,
  resource_ref,
  rank,
  source,
  created_by,
  created_at,
  updated_at
)
SELECT
  ml.id,
  'space',
  sm.space_id::text,
  sm.resource_type,
  sm.resource_ref,
  sm.rank,
  'migration',
  sm.created_by,
  sm.created_at,
  sm.updated_at
FROM "v2"."space_marks" sm
JOIN migrated_labels ml ON ml.scope_id = sm.space_id::text
WHERE sm.kind = 'pin'
ON CONFLICT (label_id, resource_type, resource_ref) DO NOTHING;
