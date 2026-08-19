DROP INDEX "v2"."v2_uq_board_transactions_board_version";
ALTER TABLE "v2"."board_transactions"
  ALTER COLUMN "result_version" DROP NOT NULL;
CREATE UNIQUE INDEX "v2_uq_board_transactions_board_version"
  ON "v2"."board_transactions" ("board_id", "result_version")
  WHERE "result_version" IS NOT NULL;
