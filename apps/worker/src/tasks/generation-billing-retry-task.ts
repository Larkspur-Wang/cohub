import {
  billingOperations,
  COHUB_BILLING_TOKEN_TYPES,
  normalizePositiveUsd,
  type CohubBillingUsageType,
} from "@cohub/billing";
import type { Job } from "bullmq";
import {
  GENERATION_BILLING_RETRY_TASK_TYPE,
  type GenerationBillingRetryTaskData,
} from "@cohub/protocol/generation";
import type { TaskPayload } from "@cohub/protocol/task";
import { registerTask } from "./registry.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseRetryData(data: unknown): GenerationBillingRetryTaskData {
  if (!isRecord(data)) throw new Error("Invalid generation billing retry payload: data is required");
  if (typeof data.taskRunId !== "string" || !data.taskRunId.trim()) {
    throw new Error("Invalid generation billing retry payload: taskRunId is required");
  }
  if (typeof data.userId !== "string" || !data.userId.trim()) {
    throw new Error("Invalid generation billing retry payload: userId is required");
  }
  if (typeof data.model !== "string" || !data.model.trim()) {
    throw new Error("Invalid generation billing retry payload: model is required");
  }
  if (typeof data.usageType !== "string" || !data.usageType.trim()) {
    throw new Error("Invalid generation billing retry payload: usageType is required");
  }
  if (typeof data.amountUsd !== "number" || !Number.isFinite(data.amountUsd) || data.amountUsd <= 0) {
    throw new Error("Invalid generation billing retry payload: amountUsd must be a positive number");
  }
  return {
    taskRunId: data.taskRunId,
    userId: data.userId,
    amountUsd: data.amountUsd,
    usageType: data.usageType,
    model: data.model,
    adapterType: typeof data.adapterType === "string" ? data.adapterType : null,
  };
}

/**
 * Retry post-success generation charging. Safe to re-run: recordUsage is
 * idempotent via operationId `generation:${taskRunId}`.
 */
registerTask(GENERATION_BILLING_RETRY_TASK_TYPE, async (job: Job) => {
  const payload = job.data as TaskPayload;
  const data = parseRetryData(payload.data);
  const amountUsd = normalizePositiveUsd(data.amountUsd);
  if (amountUsd <= 0) {
    return { status: "skipped", reason: "zero_amount", taskRunId: data.taskRunId };
  }
  if (!billingOperations.status.configured) {
    return { status: "skipped", reason: "billing_not_configured", taskRunId: data.taskRunId };
  }

  const result = await billingOperations.recordUsage({
    userId: data.userId,
    amountUsd,
    tokenType: COHUB_BILLING_TOKEN_TYPES.usdMicroCent,
    usageType: data.usageType as CohubBillingUsageType,
    sourceId: data.taskRunId,
    operationId: `generation:${data.taskRunId}`,
    reason: `Generation ${data.model}`,
  });

  if (result.status === "overage") {
    console.warn("[Billing] generation usage retry recorded as overage", {
      userId: data.userId,
      taskRunId: data.taskRunId,
      amountUsd,
      model: data.model,
      usageType: data.usageType,
      adapterType: data.adapterType ?? null,
    });
  }

  return {
    status: result.status,
    amountUsd,
    usageType: data.usageType,
    taskRunId: data.taskRunId,
  };
});
