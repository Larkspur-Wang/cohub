import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  createCachedGenerationsConfig,
  GENERATIONS_CACHE_TTL_SEC,
  getUserGenerationsRedisKey,
  isGenerationDeclaration,
  PLATFORM_GENERATIONS_REDIS_KEY,
  type CachedGenerationsConfig,
  type GenerationsConfig,
} from "@cohub/config-runtime/generations";
import type { GenerationDeclaration } from "@cohub/protocol";
import { redisCommandClient } from "./redis.js";

const DECLARATION_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);

function parseDeclaration(rawText: string, path: string): GenerationDeclaration {
  const parsed = extname(path) === ".json" ? JSON.parse(rawText) : parseYaml(rawText);
  if (!isGenerationDeclaration(parsed)) {
    throw new Error(`Generation declaration has invalid schema: ${path}`);
  }
  return parsed;
}

async function readGenerationsConfigFromDir(dir: string): Promise<{ rawText: string; content: GenerationsConfig }> {
  const entries = await readdir(dir);
  const declarations: GenerationDeclaration[] = [];
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
