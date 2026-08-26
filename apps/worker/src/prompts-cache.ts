import { join } from "node:path";
import {
  createCachedPromptTemplatesConfig,
  getUserPromptsRedisKey,
  loadPromptTemplatesFromDirectory,
  PLATFORM_PROMPTS_REDIS_KEY,
  PROMPTS_CACHE_TTL_SEC,
  type CachedPromptTemplatesConfig,
} from "@cohub/infra/config-runtime/prompts";
import { redisCommandClient } from "./redis.js";

export async function publishPromptsCacheFromDir(input: {
  promptsDir: string;
  scope: "platform" | "user";
  userId?: string;
  sourceCheckpointId?: string | null;
}): Promise<CachedPromptTemplatesConfig> {
  const redisKey = input.scope === "platform"
    ? PLATFORM_PROMPTS_REDIS_KEY
    : getUserPromptsRedisKey(input.userId ?? "");

  if (input.scope === "user" && !input.userId) {
    throw new Error("userId is required when publishing user prompts cache");
  }

  const { rawText, content } = await loadPromptTemplatesFromDirectory({
    dir: input.promptsDir,
    scope: input.scope,
    allowMissing: true,
  });
  const cached: CachedPromptTemplatesConfig = createCachedPromptTemplatesConfig({
    rawText,
    content,
    sourceCheckpointId: input.sourceCheckpointId ?? null,
  });

  await redisCommandClient.set(redisKey, JSON.stringify(cached), "EX", PROMPTS_CACHE_TTL_SEC);
  return cached;
}

export const getPromptsDir = (configRoot: string) => join(configRoot, ".agents", "prompts");
