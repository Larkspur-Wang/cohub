ALTER TABLE "session_messages" ADD COLUMN "idempotency_key" varchar(255);
CREATE UNIQUE INDEX "uq_session_messages_session_id_idempotency_key" ON "session_messages" USING btree ("session_id","idempotency_key");
