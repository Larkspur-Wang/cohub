import type { ReferenceInput } from "./types.js";

/** System queue job name for indexing resource references. */
export const INDEX_REFERENCES_JOB = "references.index";

/** Payload carried by the index-references job. */
export type IndexReferencesJobData = {
  references: ReferenceInput[];
  trace?: Record<string, unknown>;
};

export type IndexReferencesJobResult = {
  ok: true;
  written: number;
};

/** Minimal shape of a BullMQ-style queue `add`, injected by each producer. */
export type ReferenceQueueAdd = (
  name: string,
  data: IndexReferencesJobData,
  options?: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Enqueue references for asynchronous indexing on the system queue. Producers
 * build the references at the behavior point and hand them off; the worker
 * persists them with retries. Never throws on empty input.
 *
 * This decouples the write from the primary transaction (fork, mod, checkpoint,
 * turn) without the data-loss risk of a bare fire-and-forget DB write: BullMQ
 * retries transient failures, and the backfill script remains the full-rebuild
 * fallback.
 */
export const enqueueReferenceIndex = async (
  add: ReferenceQueueAdd,
  references: readonly ReferenceInput[],
  options?: { trace?: Record<string, unknown>; jobId?: string },
): Promise<void> => {
  if (references.length === 0) return;
  await add(
    INDEX_REFERENCES_JOB,
    { references: [...references], trace: options?.trace },
    options?.jobId ? { jobId: options.jobId } : undefined,
  );
};
