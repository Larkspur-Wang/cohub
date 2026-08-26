import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createCachedPromptTemplatesConfig,
  getUserPromptsRedisKey,
  parsePromptTemplateFromText,
  PLATFORM_PROMPTS_REDIS_KEY,
  PROMPTS_CACHE_TTL_SEC,
  type CachedPromptTemplatesConfig,
  type PromptTemplate,
  type PromptTemplatesConfig,
  type PromptTemplateScope,
} from "@cohub/infra/config-runtime/prompts";
import { redisCommandClient } from "./redis.js";

function parseTemplateFromText(raw: string, filePath: string, scope: PromptTemplateScope): PromptTemplate {
  return parsePromptTemplateFromText(raw, filePath, scope);
}

async function readPromptsConfigFromDir(dir: string, scope: PromptTemplateScope): Promise<{ rawText: string; content: PromptTemplatesConfig }> {
  const entries = await readdir(dir);
  const templates: PromptTemplate[] = [];
  const rawParts: string[] = [];

  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;
    const path = join(dir, entry);
    const rawText = await readFile(path, "utf-8");
    rawParts.push(`${entry}\n${rawText}`);
    templates.push(parseTemplateFromText(rawText, path, scope));
  }

  templates.sort((a, b) => a.name.localeCompare(b.name));
  return { rawText: rawParts.join("\n---\n"), content: { templates } };
}

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

  let cached: CachedPromptTemplatesConfig;
  try {
    const { rawText, content } = await readPromptsConfigFromDir(input.promptsDir, input.scope);
    cached = createCachedPromptTemplatesConfig({
      rawText,
      content,
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (code !== "ENOENT") throw error;
    cached = createCachedPromptTemplatesConfig({
      rawText: "",
      content: { templates: [] },
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  }

  await redisCommandClient.set(redisKey, JSON.stringify(cached), "EX", PROMPTS_CACHE_TTL_SEC);
  return cached;
}

export const getPromptsDir = (configRoot: string) => join(configRoot, ".agents", "prompts");
