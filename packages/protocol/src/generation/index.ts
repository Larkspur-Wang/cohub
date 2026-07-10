import type { GenerationContentBlock, GenerationModelDeclaration } from "@neta-art/generation";
import type { BillingPayload } from "../billing.js";
export * from "./policy.js";

export type {
  GenerateRequest,
  GenerationContentBlock,
  GenerationContentBlockMeta,
  GenerationContentSpec,
  GenerationModelDeclaration,
  GenerationParameterSpec,
  GenerationResult,
  GenerationSource,
} from "@neta-art/generation";

export const GENERATION_TASK_TYPE = "generation" as const;
export const GENERATION_BILLING_RETRY_TASK_TYPE = "generation.billing_retry" as const;

export type CreateGenerationTaskRequest = {
  spaceId: string;
  sessionId?: string | null;
  turnId?: string | null;
  model: string;
  content: GenerationContentBlock[];
  parameters?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

export type CreateGenerationTaskResponse = {
  taskRunId: string;
  taskType: typeof GENERATION_TASK_TYPE;
  status: "pending";
  billing?: BillingPayload | null;
};

export type GenerationTaskData = {
  model: string;
  content: GenerationContentBlock[];
  parameters?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

/** Payload for async billing retry after a successful generation charge failure. */
export type GenerationBillingRetryTaskData = {
  taskRunId: string;
  userId: string;
  amountUsd: number;
  usageType: string;
  model: string;
  adapterType?: string | null;
};

/**
 * Final generation task payload stored on the task run.
 *
 * - `output` is the generated content blocks (SDK `GenerationResult.content`)
 * - `requestId` maps to the provider response body's top-level `request_id`
 * - `cost` maps to the official request price in `usage.cost`
 * - `billing` records post-success credit consumption (when attempted)
 * - `meta` is the request meta (including Cohub context such as taskRunId/spaceId)
 */
export type GenerationUsageBilling = {
  amountUsd: number;
  usageType: string;
  status: "recorded" | "overage" | "skipped";
  reason?: string | null;
};

export type GenerationTaskResult = {
  model: string;
  output: GenerationContentBlock[];
  requestId?: string;
  cost?: number;
  /** Post-success usage charge metadata. Distinct from gate `billing` on create. */
  billing?: GenerationUsageBilling | null;
  meta?: Record<string, unknown>;
};

export type GenerationExampleRequest = Omit<CreateGenerationTaskRequest, "spaceId">;
export type GenerationDeclaration = GenerationModelDeclaration;
export type PublicGenerationDeclaration = Omit<GenerationModelDeclaration, "adapter">;

export type ListGenerationModelsResponse = {
  models: PublicGenerationDeclaration[];
};
