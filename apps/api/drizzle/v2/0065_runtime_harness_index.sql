ALTER TABLE "v2"."session_turns" ADD COLUMN "harness_index" jsonb;
--> statement-breakpoint
CREATE INDEX "v2_idx_session_turns_active_local_runtime" ON "v2"."session_turns" ("session_id")
WHERE "execution_kind" = 'agent' AND "status" IN ('running', 'abort_requested') AND "meta"->>'harness' IN ('pi', 'codex');
--> statement-breakpoint
CREATE INDEX "v2_idx_session_messages_runtime_delivery" ON "v2"."session_messages" ("id")
WHERE "meta"->>'runtimeDeliveryPending' = 'true';
