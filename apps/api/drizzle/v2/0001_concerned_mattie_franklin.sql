ALTER TABLE "v2"."space_sandboxes" ADD COLUMN "desired_image" text;--> statement-breakpoint
ALTER TABLE "v2"."space_sandboxes" ADD COLUMN "reported_image_version" varchar(255);--> statement-breakpoint
ALTER TABLE "v2"."space_sandboxes" ADD COLUMN "reported_at" timestamp with time zone;--> statement-breakpoint
UPDATE "v2"."space_sandboxes"
SET
  "reported_image_version" = CASE
    WHEN jsonb_typeof("meta") = 'object' AND COALESCE(NULLIF(BTRIM("meta"->>'imageVersion'), ''), '') <> ''
      THEN BTRIM("meta"->>'imageVersion')
    ELSE NULL
  END,
  "reported_at" = CASE
    WHEN jsonb_typeof("meta") = 'object' AND COALESCE(NULLIF(BTRIM("meta"->>'imageVersion'), ''), '') <> ''
      THEN "last_heartbeat_at"
    ELSE NULL
  END;--> statement-breakpoint
CREATE INDEX "v2_idx_space_sandboxes_desired_image" ON "v2"."space_sandboxes" USING btree ("desired_image");--> statement-breakpoint
CREATE INDEX "v2_idx_space_sandboxes_reported_image_version" ON "v2"."space_sandboxes" USING btree ("reported_image_version");
