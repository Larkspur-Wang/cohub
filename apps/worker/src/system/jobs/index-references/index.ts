import type { Job } from "bullmq";
import {
  INDEX_REFERENCES_JOB,
  writeReferences,
  type IndexReferencesJobData,
  type IndexReferencesJobResult,
} from "@cohub/core/references";
import { db } from "../../../db.js";
import { registerSystemJob } from "../../registry.js";

/**
 * Persist resource references idempotently. Running on the system queue gives us
 * BullMQ retries and failure recording, so a transient DB hiccup no longer drops
 * a reference the way a fire-and-forget write would. The backfill script remains
 * the full-rebuild fallback.
 */
registerSystemJob(INDEX_REFERENCES_JOB, async (job: Job): Promise<IndexReferencesJobResult> => {
  const data = job.data as IndexReferencesJobData;
  const references = data.references ?? [];
  await writeReferences(db, references);
  return { ok: true, written: references.length };
});
