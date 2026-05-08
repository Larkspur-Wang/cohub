ALTER TABLE "v2"."session_turns" RENAME COLUMN "usage" TO "total_usage";--> statement-breakpoint
ALTER TABLE "v2"."session_turns" ADD COLUMN "final_usage" jsonb;--> statement-breakpoint
WITH final_messages AS (
  SELECT DISTINCT ON (message.meta->>'turnId')
    message.meta->>'turnId' AS turn_id,
    message.usage
  FROM "v2"."session_messages" AS message
  WHERE message.role = 'assistant'
    AND message.meta->>'turnId' IS NOT NULL
    AND message.meta->>'messageKind' IN ('assistant_final', 'assistant_error')
  ORDER BY message.meta->>'turnId', message.sequence DESC, message.created_at DESC
)
UPDATE "v2"."session_turns" AS turn
SET "final_usage" = final_messages.usage
FROM final_messages
WHERE turn.id::text = final_messages.turn_id
  AND final_messages.usage IS NOT NULL;
