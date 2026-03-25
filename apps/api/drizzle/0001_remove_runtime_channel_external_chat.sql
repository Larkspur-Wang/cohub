ALTER TABLE "runtime_channels" DROP CONSTRAINT IF EXISTS "uq_runtime_channel_chat";
DROP INDEX IF EXISTS "idx_runtime_channels_external_chat";
DROP INDEX IF EXISTS "idx_runtime_channels_channel";
ALTER TABLE "runtime_channels" DROP COLUMN IF EXISTS "external_chat_id";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_runtime_channels_channel" ON "runtime_channels" USING btree ("channel_id");
