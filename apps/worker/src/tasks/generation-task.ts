import {
  BillingAccessBlockedError,
  billingOperations,
  COHUB_BILLING_TOKEN_TYPES,
  contentTypesFromBlocks,
  createBillingUsageGate,
  generationUsageKind,
  normalizePositiveUsd,
  resolveGenerationUsageType,
} from "@cohub/billing";
import type { Job } from "bullmq";
import {
  createGenerationClient,
  GenerationConfigError,
  GenerationProviderError,
  GenerationUnsupportedAdapterError,
  GenerationValidationError,
} from "@neta-art/generation";
import { createGenerationDeclarationLoader } from "@cohub/infra/config-runtime/generation-declarations";
import {
  GENERATION_BILLING_RETRY_TASK_TYPE,
  GENERATION_TASK_TYPE,
  type GenerationBillingRetryTaskData,
  type GenerationTaskData,
  type GenerationTaskResult,
  type GenerationUsageBilling,
} from "@cohub/protocol/generation";
import type { TaskPayload } from "@cohub/protocol/task";
import { defaultJobRetention } from "@cohub/infra/bullmq";
import { config } from "../config.js";
import { recordGenerationUsageStatsHourly } from "../generation-usage-stats.js";
import { redisCommandClient } from "../redis.js";
import { enqueueTask } from "./enqueue.js";
import { registerTask } from "./registry.js";

const loader = createGenerationDeclarationLoader({
  platformConfigRoot: config.platformConfigRoot,
  redis: redisCommandClient,
});
const billingUsageGate = createBillingUsageGate({
  operations: billingOperations,
  onEvaluationError: (error, gateInput) => {
    console.warn("[BillingGate] fail-open after worker generation billing evaluation error", { error, gateInput });
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseGenerationTaskData(data: unknown): GenerationTaskData {
  if (!isRecord(data)) throw new Error("Invalid generation task payload: data is required");
  if (typeof data.model !== "string" || !data.model.trim()) {
    throw new Error("Invalid generation task payload: model is required");
  }
  if (!Array.isArray(data.content) || data.content.length === 0) {
    throw new Error("Invalid generation task payload: content is required");
  }
  if (data.parameters !== undefined && !isRecord(data.parameters)) {
    throw new Error("Invalid generation task payload: parameters must be an object");
  }
  if (data.meta !== undefined && !isRecord(data.meta)) {
    throw new Error("Invalid generation task payload: meta must be an object");
  }
  return {
    model: data.model,
    content: data.content as GenerationTaskData["content"],
    parameters: data.parameters,
    meta: data.meta,
  };
}

function getNetaRouterApiKey(): string {
  if (!config.netaRouterApiKey) throw new GenerationConfigError("Missing required env: NETA_ROUTER_API_KEY");
  return config.netaRouterApiKey;
}

function summarizeProviderBody(body: string | undefined): string | null {
  if (!body) return null;
  return body.replace(/\s+/g, " ").trim().slice(0, 500) || null;
}

function truncateProviderDetail(value: string, maxLength = 1_000): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function summarizeProviderDetails(details: Record<string, unknown> | undefined): string | null {
  if (!details) return null;
  try {
    const serialized = JSON.stringify(details);
    if (!serialized) return null;
    return `details ${truncateProviderDetail(serialized.replace(/\s+/g, " "))}`;
  } catch {
    return "details [unserializable]";
  }
}

function providerStatusMessage(status: number | undefined): string | null {
  if (status === undefined) return null;
  if (status === 401 || status === 403) return "Generation provider rejected the configured credentials";
  if (status === 429) return "Generation provider rate limit exceeded";
  if (status >= 500) return "Generation provider is temporarily unavailable";
  return "Generation provider request failed";
}

function mergeCohubMeta(
  meta: Record<string, unknown> | undefined,
  cohub: Record<string, unknown>,
): Record<string, unknown> {
  const existingCohub = meta?.cohub;
  return {
    ...(meta ?? {}),
    cohub: {
      ...(existingCohub && typeof existingCohub === "object" && !Array.isArray(existingCohub) ? existingCohub : {}),
      ...cohub,
    },
  };
}

function normalizeGenerationError(error: unknown): Error {
  if (error instanceof GenerationValidationError) {
    return new Error(`Invalid generation input: ${error.message}`);
  }
  if (error instanceof GenerationProviderError) {
    const parts = [providerStatusMessage(error.status) ?? error.message];
    if (error.status !== undefined) parts.push(`HTTP ${error.status}`);
    const details = summarizeProviderDetails(error.details);
    if (details) parts.push(details);
    const body = summarizeProviderBody(error.body);
    if (body) parts.push(body);
    return new Error(parts.join(" — "));
  }
  if (error instanceof GenerationConfigError || error instanceof GenerationUnsupportedAdapterError) {
    return new Error(error.message);
  }
  if (error instanceof Error) return error;
  return new Error(String(error));
}

async function recordGenerationStatsSafe(input: {
  taskRunId: string;
  userId: string;
  spaceId: string;
  sessionId?: string | null;
  usageType: string;
  adapterType?: string | null;
  model: string;
  costTotal: number;
}) {
  try {
    await recordGenerationUsageStatsHourly({
      taskRunId: input.taskRunId,
      userId: input.userId,
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      usageType: input.usageType,
      adapterType: input.adapterType ?? null,
      model: input.model,
      costTotal: input.costTotal,
    });
  } catch (error) {
    console.warn("[UsageStats] failed to record generation usage stats", {
      userId: input.userId,
      spaceId: input.spaceId,
      model: input.model,
      usageType: input.usageType,
      taskRunId: input.taskRunId,
      error,
    });
  }
}

/**
 * Record multimodal generation usage after a successful provider call.
 * Failures are logged and never fail the task (matches LLM billing).
 */
async function enqueueGenerationBillingRetry(input: {
  userId: string;
  taskRunId: string;
  amountUsd: number;
  usageType: string;
  model: string;
  adapterType?: string | null;
  spaceId: string;
  sessionId?: string | null;
}) {
  const data: GenerationBillingRetryTaskData = {
    taskRunId: input.taskRunId,
    userId: input.userId,
    amountUsd: input.amountUsd,
    usageType: input.usageType,
    model: input.model,
    adapterType: input.adapterType ?? null,
  };
  // Stable jobId so concurrent failures for the same generation collapse into one retry chain.
  await enqueueTask({
    type: GENERATION_BILLING_RETRY_TASK_TYPE,
    spaceId: input.spaceId,
    sessionId: input.sessionId ?? undefined,
    userId: input.userId,
    data,
  }, {
    jobId: `generation-billing-retry:${input.taskRunId}`,
    attempts: 8,
    backoff: { type: "exponential", delay: 5_000 },
    ...defaultJobRetention,
  });
}

async function recordGenerationUsageBilling(input: {
  userId: string;
  taskRunId: string;
  model: string;
  adapterType: string | null | undefined;
  amountUsd: number;
  usageType: ReturnType<typeof resolveGenerationUsageType>;
  spaceId: string;
  sessionId?: string | null;
}): Promise<GenerationUsageBilling> {
  const amountUsd = normalizePositiveUsd(input.amountUsd);
  if (!billingOperations.status.configured) {
    return { amountUsd, usageType: input.usageType, status: "skipped", reason: "billing_not_configured" };
  }
  if (amountUsd <= 0) {
    return { amountUsd: 0, usageType: input.usageType, status: "skipped", reason: "missing_cost" };
  }
  if (!input.taskRunId) {
    return { amountUsd, usageType: input.usageType, status: "skipped", reason: "missing_task_run_id" };
  }

  try {
    const result = await billingOperations.recordUsage({
      userId: input.userId,
      amountUsd,
      tokenType: COHUB_BILLING_TOKEN_TYPES.usdMicroCent,
      usageType: input.usageType,
      sourceId: input.taskRunId,
      operationId: `generation:${input.taskRunId}`,
      reason: `Generation ${input.model}`,
    });
    if (result.status === "overage") {
      console.warn("[Billing] generation usage recorded as overage", {
        userId: input.userId,
        taskRunId: input.taskRunId,
        amountUsd,
        model: input.model,
        usageType: input.usageType,
        adapterType: input.adapterType ?? null,
      });
    }
    if (result.status === "disabled" || result.status === "skipped") {
      return {
        amountUsd,
        usageType: input.usageType,
        status: "skipped",
        reason: result.status === "disabled" ? "billing_disabled" : "zero_amount",
      };
    }
    return {
      amountUsd,
      usageType: input.usageType,
      status: result.status === "overage" ? "overage" : "recorded",
    };
  } catch (error) {
    console.warn("[Billing] failed to record generation usage; enqueueing retry", {
      userId: input.userId,
      taskRunId: input.taskRunId,
      amountUsd,
      model: input.model,
      usageType: input.usageType,
      adapterType: input.adapterType ?? null,
      error,
    });
    await enqueueGenerationBillingRetry({
      userId: input.userId,
      taskRunId: input.taskRunId,
      amountUsd,
      usageType: input.usageType,
      model: input.model,
      adapterType: input.adapterType ?? null,
      spaceId: input.spaceId,
      sessionId: input.sessionId,
    }).catch((enqueueError) => {
      console.warn("[Billing] failed to enqueue generation billing retry", {
        userId: input.userId,
        taskRunId: input.taskRunId,
        amountUsd,
        error: enqueueError,
      });
    });
    return { amountUsd, usageType: input.usageType, status: "skipped", reason: "record_failed" };
  }
}

registerTask(GENERATION_TASK_TYPE, async (job: Job, context) => {
  const payload = job.data as TaskPayload;
  const spaceId = payload.spaceId;
  const sessionId = payload.sessionId;
  const turnId = payload.turnId;
  const userId = payload.userId;
  if (!spaceId) throw new Error("Invalid generation task payload: spaceId is required");
  if (!userId) throw new Error("Invalid generation task payload: userId is required");
  const data = parseGenerationTaskData(payload.data);
  const taskRunId = context?.taskRunId ?? String(job.id ?? "");
  const meta = mergeCohubMeta(data.meta, {
    taskRunId,
    spaceId,
    sessionId: sessionId ?? null,
    turnId: turnId ?? null,
  });

  try {
    const declaration = await loader.loadGenerationDeclaration(userId, data.model);
    if (!declaration) throw new Error(`Generation model is unavailable: ${data.model}`);

    // Gate uses request-side modality; billing/stats re-resolve with output after success.
    const gateUsageType = resolveGenerationUsageType({
      adapterType: declaration.adapter?.type,
      contentTypes: contentTypesFromBlocks(data.content),
    });
    const billingDecision = await billingUsageGate.evaluate({
      userId,
      usageKind: generationUsageKind(gateUsageType),
      source: "generation_task",
      model: data.model,
      spaceId,
      sessionId: sessionId ?? null,
      turnId: turnId ?? null,
    });
    if (billingDecision.status === "blocked") throw new BillingAccessBlockedError(billingDecision);

    const result = await createGenerationClient({
      models: [declaration],
      includeBuiltinModels: false,
      apiKey: getNetaRouterApiKey(),
    }).generateResult({
      model: data.model,
      content: data.content,
      parameters: data.parameters,
      meta,
    });

    const usageType = resolveGenerationUsageType({
      adapterType: declaration.adapter?.type,
      contentTypes: [
        ...contentTypesFromBlocks(result.content),
        ...contentTypesFromBlocks(data.content),
      ],
    });
    const billing = await recordGenerationUsageBilling({
      userId,
      taskRunId,
      model: data.model,
      adapterType: declaration.adapter?.type,
      amountUsd: result.cost ?? 0,
      usageType,
      spaceId,
      sessionId,
    });
    if (billing.status === "skipped" && billing.reason === "missing_cost") {
      console.warn("[Billing] generation completed without provider cost", {
        userId,
        taskRunId,
        model: data.model,
        usageType,
        adapterType: declaration.adapter?.type ?? null,
      });
    }

    // Success-only rollup (idempotent via taskRunId). Failures stay out to avoid retry noise.
    await recordGenerationStatsSafe({
      taskRunId,
      userId,
      spaceId,
      sessionId,
      usageType,
      adapterType: declaration.adapter?.type,
      model: data.model,
      costTotal: result.cost ?? 0,
    });

    return {
      model: data.model,
      output: result.content,
      ...(result.requestId !== undefined ? { requestId: result.requestId } : {}),
      ...(result.cost !== undefined ? { cost: result.cost } : {}),
      billing,
      meta,
    } satisfies GenerationTaskResult;
  } catch (error) {
    throw normalizeGenerationError(error);
  }
});
