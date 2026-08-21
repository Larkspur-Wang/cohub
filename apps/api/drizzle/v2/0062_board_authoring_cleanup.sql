-- Repair only values that can survive the published 0059 schema migration.
-- 0059 is immutable and already migrated the dropped Sequence/Clip columns.
UPDATE "v2"."board_clips"
SET "target" = jsonb_build_object('type', 'item', 'itemId', "target"->'nodeId')
WHERE "target"->>'type' = 'node';

UPDATE "v2"."board_effects"
SET "target_type" = 'item'
WHERE "target_type" = 'node';
