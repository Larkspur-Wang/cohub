ALTER TABLE "v2"."task_runs" ADD COLUMN "turn_id" uuid;--> statement-breakpoint
CREATE INDEX "v2_idx_task_runs_turn_id" ON "v2"."task_runs" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "v2_idx_task_runs_session_turn" ON "v2"."task_runs" USING btree ("session_id","turn_id");