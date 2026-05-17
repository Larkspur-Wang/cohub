import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  createCachedGenerationsConfig,
  GENERATIONS_CACHE_TTL_SEC,
  getUserGenerationsRedisKey,
  isGenerationDeclaration,
  mergeGenerationsConfigs,
  parseCachedGenerationsConfig,
  PLATFORM_GENERATIONS_REDIS_KEY,
  type GenerationsConfig,
} from "@cohub/infra/config-runtime/generations";
import type { GenerationDeclaration, PublicGenerationDeclaration } from "@cohub/protocol/generation";
import { config } from "../config.js";
import { redisCommandClient } from "../redis.js";

const GENERATIONS_DIR = ".cohub/generations";
const DECLARATION_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);

const platformGenerationsDir = () => join(config.platformConfigRoot, "platform", GENERATIONS_DIR);
const userGenerationsDir = (userId: string) => join(config.platformConfigRoot, "users", userId, GENERATIONS_DIR);

const inflightByKey = new Map<string, Promise<GenerationsConfig | null>>();

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

async function loadGenerationsFromDir(input: {
  dir: string;
  redisKey: string;
  allowMissing: boolean;
}): Promise<GenerationsConfig | null> {
  try {
    const { rawText, content } = await readGenerationsConfigFromDir(input.dir);
    const cached = createCachedGenerationsConfig({ rawText, content });
    await redisCommandClient.set(input.redisKey, JSON.stringify(cached), "EX", GENERATIONS_CACHE_TTL_SEC).catch(() => undefined);
    return content;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (code === "ENOENT" && input.allowMissing) {
      const cached = createCachedGenerationsConfig({ content: null });
      await redisCommandClient.set(input.redisKey, JSON.stringify(cached), "EX", GENERATIONS_CACHE_TTL_SEC).catch(() => undefined);
      return null;
    }
    throw error;
  }
}

async function loadCachedGenerations(input: {
  redisKey: string;
  dir: string;
  allowMissing: boolean;
}): Promise<GenerationsConfig | null> {
  const inflight = inflightByKey.get(input.redisKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const cached = await redisCommandClient.get(input.redisKey).catch(() => null);
    if (cached) {
      const parsed = parseCachedGenerationsConfig(cached);
      if (parsed) return parsed.content;
    }
    return loadGenerationsFromDir(input);
  })();

  inflightByKey.set(input.redisKey, promise);
  try {
    return await promise;
  } finally {
    inflightByKey.delete(input.redisKey);
  }
}

export async function loadGenerationDeclarations(userId: string): Promise<GenerationDeclaration[]> {
  const platformGenerations = await loadCachedGenerations({
    redisKey: PLATFORM_GENERATIONS_REDIS_KEY,
    dir: platformGenerationsDir(),
    allowMissing: false,
  });
  if (!platformGenerations) throw new Error("Generation declarations directory not found");

  const userGenerations = await loadCachedGenerations({
    redisKey: getUserGenerationsRedisKey(userId),
    dir: userGenerationsDir(userId),
    allowMissing: true,
  });

  return mergeGenerationsConfigs(platformGenerations, userGenerations).declarations;
}

export async function loadGenerationDeclaration(userId: string, model: string): Promise<GenerationDeclaration | null> {
  const declarations = await loadGenerationDeclarations(userId);
  return declarations.find((declaration) => declaration.model === model) ?? null;
}

export async function loadPublicGenerationModels(userId: string): Promise<{ models: PublicGenerationDeclaration[] }> {
  return {
    models: (await loadGenerationDeclarations(userId)).map(toPublicGenerationDeclaration),
  };
}

export function toPublicGenerationDeclaration(declaration: GenerationDeclaration): PublicGenerationDeclaration {
  const { adapter: _adapter, ...rest } = declaration;
  return rest;
}

export function resolveDeclarationApiKey(value: string): string {
  const envPrefix = "$env:";
  if (!value.startsWith(envPrefix)) return value;
  const envName = value.slice(envPrefix.length).trim();
  if (!envName) throw new Error("Generation adapter api_key env name is empty");
  const envValue = process.env[envName];
  if (!envValue) throw new Error(`Missing generation adapter API key environment variable: ${envName}`);
  return envValue;
}
