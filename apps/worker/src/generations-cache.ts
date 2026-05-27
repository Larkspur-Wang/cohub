import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  parseGenerationModelDeclaration,
  type GenerationModelDeclaration,
} from "@neta-art/generation";
import {
  createCachedGenerationsConfig,
  GENERATIONS_CACHE_TTL_SEC,
  getUserGenerationsRedisKey,
  PLATFORM_GENERATIONS_REDIS_KEY,
  type CachedGenerationsConfig,
  type GenerationsConfig,
} from "@cohub/infra/config-runtime/generations";
import { redisCommandClient } from "./redis.js";

const DECLARATION_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);

function parseDeclaration(rawText: string, path: string): GenerationModelDeclaration {
  return parseGenerationModelDeclaration(rawText, path);
}

async function readGenerationsConfigFromDir(dir: string): Promise<{ rawText: string; content: GenerationsConfig }> {
  const entries = await readdir(dir);
  const declarations: GenerationModelDeclaration[] = [];
  const rawParts: string[] = [];
  for (const entry of entries.sort()) {
    if (!DECLARATION_EXTENSIONS.has(extname(entry))) continue;
    const path = join(dir, entry);
    const rawText = await readFile(path, "utf-8");
    rawParts.push(`${entry}\n${rawText}`);
    declarations.push(parseDeclaration(rawText, path));
  }
  declarations.sort((a, b) => a.model.localeCompare(b.model));
  return { rawText: rawParts.join("\n---\n"), content: { declarations } };
}

export async function publishGenerationsCacheFromDir(input: {
  generationsDir: string;
  scope: "platform" | "user";
  userId?: string;
  sourceCheckpointId?: string | null;
}): Promise<CachedGenerationsConfig> {
  const redisKey = input.scope === "platform"
    ? PLATFORM_GENERATIONS_REDIS_KEY
    : getUserGenerationsRedisKey(input.userId ?? "");

  if (input.scope === "user" && !input.userId) {
    throw new Error("userId is required when publishing user generations cache");
  }

  let cached: CachedGenerationsConfig;
  try {
    const { rawText, content } = await readGenerationsConfigFromDir(input.generationsDir);
    cached = createCachedGenerationsConfig({
      rawText,
      content,
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (code !== "ENOENT") throw error;
    cached = createCachedGenerationsConfig({
      content: null,
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  }

  await redisCommandClient.set(redisKey, JSON.stringify(cached), "EX", GENERATIONS_CACHE_TTL_SEC);
  return cached;
}

export const getGenerationsDir = (configRoot: string) => join(configRoot, ".cohub", "generations");
