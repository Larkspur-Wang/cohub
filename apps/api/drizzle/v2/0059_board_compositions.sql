ALTER TABLE "v2"."board_sequences" RENAME TO "board_compositions";
ALTER TABLE "v2"."board_compositions"
  RENAME CONSTRAINT "board_sequences_board_id_boards_id_fk"
  TO "board_compositions_board_id_boards_id_fk";
ALTER INDEX "v2"."v2_uq_board_sequences_board_id" RENAME TO "v2_uq_board_compositions_board_id";
ALTER INDEX "v2"."v2_idx_board_sequences_board_id" RENAME TO "v2_idx_board_compositions_board_id";

ALTER TABLE "v2"."board_compositions"
  ADD COLUMN "playback" jsonb NOT NULL DEFAULT '{"loop":false,"endBehavior":"hold","reducedMotion":{"mode":"base"}}'::jsonb,
  ADD COLUMN "markers" jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE "v2"."board_compositions"
SET "metadata" = "metadata" || jsonb_build_object(
  '_sourceSequence', jsonb_build_object('seed', "seed", 'restPose', "rest_pose")
);

ALTER TABLE "v2"."board_compositions"
  DROP COLUMN "seed",
  DROP COLUMN "rest_pose";

ALTER TABLE "v2"."board_clips" RENAME COLUMN "sequence_id" TO "composition_id";
ALTER INDEX "v2"."v2_uq_board_clips_sequence_id" RENAME TO "v2_uq_board_clips_composition_id";

UPDATE "v2"."board_clips"
SET "params" = CASE
  WHEN jsonb_array_length("keyframes") > 0
    THEN "params" || jsonb_build_object('_sourceKeyframes', "keyframes")
  ELSE "params"
END,
"target" = CASE
  WHEN "target"->>'type' = 'node'
    THEN jsonb_build_object('type', 'item', 'itemId', "target"->'nodeId')
  ELSE "target"
END;

ALTER TABLE "v2"."board_clips" DROP COLUMN "keyframes";

UPDATE "v2"."board_effects"
SET "target_type" = 'item'
WHERE "target_type" = 'node';

CREATE TABLE "v2"."board_tracks" (
  "id" text NOT NULL,
  "board_id" uuid NOT NULL REFERENCES "v2"."boards"("id") ON DELETE CASCADE,
  "composition_id" text NOT NULL,
  "target" jsonb NOT NULL,
  "channel" varchar(160) NOT NULL,
  "channel_version" integer NOT NULL,
  "interpolation" varchar(20) NOT NULL,
  "fill" varchar(20) NOT NULL,
  "keyframes" jsonb NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX "v2_uq_board_tracks_composition_id"
  ON "v2"."board_tracks" ("board_id", "composition_id", "id");
CREATE INDEX "v2_idx_board_tracks_composition_id"
  ON "v2"."board_tracks" ("board_id", "composition_id");

ALTER TABLE "v2"."board_playback_states"
  RENAME COLUMN "sequence_id" TO "composition_id";
ALTER TABLE "v2"."board_playback_states"
  RENAME COLUMN "sequence_revision" TO "composition_revision";

ALTER TABLE "v2"."board_transactions"
  ADD COLUMN "receipt" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "v2"."board_transactions"
  ALTER COLUMN "receipt" DROP DEFAULT;
