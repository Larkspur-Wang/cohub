import { readFile } from "node:fs/promises";
import {
  createCachedModelTasksConfig,
  getUserModelTasksRedisKey,
  MODEL_TASKS_CACHE_TTL_SEC,
  parseModelTasksConfigOverride,
  PLATFORM_MODEL_TASKS_REDIS_KEY,
  type CachedModelTasksConfig,
} from "@cohub/infra/config-runtime/model-tasks";
import { redisCommandClient } from "./redis.js";

type ModelTasksCacheClient = Pick<typeof redisCommandClient, "set">;
type ReadModelTasksFile = (path: string, encoding: "utf-8") => Promise<string>;

export async function publishModelTasksCacheFromFile(
  input: {
    configPath: string;
    scope: "platform" | "user";
    userId?: string;
    sourceCheckpointId?: string | null;
  },
  deps: { cache: ModelTasksCacheClient; readFile: ReadModelTasksFile } = {
    cache: redisCommandClient,
    readFile,
  },
): Promise<CachedModelTasksConfig> {
  if (input.scope === "user" && !input.userId) {
    throw new Error("userId is required when publishing user model tasks cache");
  }

  const redisKey = input.scope === "platform"
    ? PLATFORM_MODEL_TASKS_REDIS_KEY
    : getUserModelTasksRedisKey(input.userId ?? "");

  let cached: CachedModelTasksConfig;
  try {
    const rawText = await deps.readFile(input.configPath, "utf-8");
    cached = createCachedModelTasksConfig({
      rawText,
      content: parseModelTasksConfigOverride(rawText),
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (code !== "ENOENT") throw error;
    cached = createCachedModelTasksConfig({
      content: null,
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  }

  await deps.cache.set(redisKey, JSON.stringify(cached), "EX", MODEL_TASKS_CACHE_TTL_SEC);
  return cached;
}
