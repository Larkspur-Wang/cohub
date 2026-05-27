import type { Job } from "bullmq";
import { createGenerationDeclarationLoader } from "@cohub/infra/config-runtime/generation-declarations";
import { GENERATION_TASK_TYPE, type GenerationTaskData, type GenerationTaskResult } from "@cohub/protocol/generation";
import type { TaskPayload } from "@cohub/protocol/task";
import {
  GenerationHttpError,
  GenerationProviderError,
  GenerationValidationError,
  getGenerationAdapter,
  resolveGenerationParameters,
  validateGenerationContent,
} from "@cohub/core/generations";
import { config } from "../config.js";
import { redisCommandClient } from "../redis.js";
import { resolveGenerationSource } from "../generation-source-resolver.js";
import { registerTask } from "./registry.js";

const loader = createGenerationDeclarationLoader({
  platformConfigRoot: config.platformConfigRoot,
  redis: redisCommandClient,
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
  return {
    model: data.model,
    content: data.content as GenerationTaskData["content"],
    parameters: isRecord(data.parameters) ? data.parameters : undefined,
    metadata: isRecord(data.metadata) ? data.metadata : undefined,
  };
}

function providerStatusMessage(status: number) {
  if (status === 401 || status === 403) return "Generation provider rejected the configured credentials";
  if (status === 429) return "Generation provider rate limit exceeded";
  if (status >= 500) return "Generation provider is temporarily unavailable";
  return null;
}

function truncateDetail(value: string, maxLength = 1000) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function formatProviderError(error: GenerationProviderError) {
  const details: string[] = [];
  if (error.provider?.status) details.push(`provider HTTP ${error.provider.status}`);
  if (error.provider?.taskId) details.push(`provider task ${error.provider.taskId}`);
  if (error.provider?.body) details.push(truncateDetail(error.provider.body));

  const message = error.provider?.status
    ? providerStatusMessage(error.provider.status) ?? error.message
    : error.message;
  return details.length > 0 ? `${message} (${details.join(" · ")})` : message;
}

function formatGenerationHttpError(error: GenerationHttpError) {
  return `${error.message} (${error.code})`;
}

function normalizeGenerationError(error: unknown): Error {
  if (error instanceof GenerationProviderError) {
    return new Error(formatProviderError(error));
  }
  if (error instanceof GenerationHttpError) {
    return new Error(formatGenerationHttpError(error));
  }
  if (error instanceof GenerationValidationError) {
    return new Error(`Invalid generation input: ${error.message}`);
  }
  if (error instanceof Error) return error;
  return new Error(String(error));
}

registerTask(GENERATION_TASK_TYPE, async (job: Job) => {
  const payload = job.data as TaskPayload;
  const spaceId = payload.spaceId;
  const userId = payload.userId;
  if (!spaceId) throw new Error("Invalid generation task payload: spaceId is required");
  if (!userId) throw new Error("Invalid generation task payload: userId is required");
  const data = parseGenerationTaskData(payload.data);

  try {
    const declaration = await loader.loadGenerationDeclaration(userId, data.model);
    if (!declaration) throw new Error(`Generation model is unavailable: ${data.model}`);

    validateGenerationContent(declaration, data.content);
    const parameters = resolveGenerationParameters(declaration, data.parameters);
    const adapter = getGenerationAdapter(declaration.adapter.type);
    const output = await adapter({
      declaration,
      user: { uuid: userId },
      request: {
        spaceId,
        model: data.model,
        content: data.content,
        parameters,
        metadata: data.metadata,
      },
      parameters,
      resolveSource: resolveGenerationSource,
    });

    return {
      model: data.model,
      output,
      metadata: data.metadata,
    } satisfies GenerationTaskResult;
  } catch (error) {
    throw normalizeGenerationError(error);
  }
});
