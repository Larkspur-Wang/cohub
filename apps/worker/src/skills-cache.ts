import {
  createCachedSkillsConfig,
  loadSkillsFromDirectory,
  PLATFORM_SKILLS_REDIS_KEY,
  getUserSkillsRedisKey,
  SKILLS_CACHE_TTL_SEC,
  type CachedSkillsConfig,
  type SkillScope,
} from "@cohub/infra/config-runtime/skills";
import { join } from "node:path";
import { redisCommandClient } from "./redis.js";

export async function publishSkillsCacheFromDir(input: {
  skillsDir: string;
  scope: "platform" | "user";
  userId?: string;
  sourceCheckpointId?: string | null;
  sandboxDir: string;
}): Promise<CachedSkillsConfig> {
  const redisKey = input.scope === "platform"
    ? PLATFORM_SKILLS_REDIS_KEY
    : getUserSkillsRedisKey(input.userId ?? "");

  if (input.scope === "user" && !input.userId) {
    throw new Error("userId is required when publishing user skills cache");
  }

  let cached: CachedSkillsConfig;
  try {
    const { rawText, content } = await loadSkillsFromDirectory({
      dir: input.skillsDir,
      sandboxDir: input.sandboxDir,
      scope: input.scope as SkillScope,
    });
    cached = createCachedSkillsConfig({
      rawText,
      content,
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (code !== "ENOENT") throw error;
    cached = createCachedSkillsConfig({
      rawText: "",
      content: { skills: [] },
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  }

  await redisCommandClient.set(redisKey, JSON.stringify(cached), "EX", SKILLS_CACHE_TTL_SEC);
  return cached;
}

export const getSkillsDir = (configRoot: string) => join(configRoot, ".agents", "skills");
