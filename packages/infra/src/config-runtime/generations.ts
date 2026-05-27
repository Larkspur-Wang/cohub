import {
  isGenerationModelDeclaration,
  type GenerationModelDeclaration,
} from "@neta-art/generation";

export const GENERATIONS_CACHE_REDIS_KEY_VERSION = "v1";
export const PLATFORM_GENERATIONS_REDIS_KEY = `configs:generations:${GENERATIONS_CACHE_REDIS_KEY_VERSION}:platform`;
export const USER_GENERATIONS_REDIS_KEY_PREFIX = `configs:generations:${GENERATIONS_CACHE_REDIS_KEY_VERSION}:user`;
export const GENERATIONS_CACHE_TTL_SEC = 24 * 60 * 60;

const SAFE_REDIS_KEY_SEGMENT_REGEX = /^[0-9a-zA-Z_-]+$/;

export type GenerationsConfig = {
  declarations: GenerationModelDeclaration[];
};

export type CachedGenerationsConfig = {
  rev: string;
  updatedAt: string;
  sourceCheckpointId?: string | null;
  content: GenerationsConfig | null;
};

export function assertSafeRedisKeySegment(value: string, label = "value"): string {
  const trimmed = value.trim();
  if (!SAFE_REDIS_KEY_SEGMENT_REGEX.test(trimmed)) {
    throw new Error(`Invalid ${label} for Redis key`);
  }
  return trimmed;
}

export function getUserGenerationsRedisKey(userId: string): string {
  return `${USER_GENERATIONS_REDIS_KEY_PREFIX}:${assertSafeRedisKeySegment(userId, "userId")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export const isGenerationDeclaration = isGenerationModelDeclaration;

export function isGenerationsConfig(value: unknown): value is GenerationsConfig {
  if (!isRecord(value) || !Array.isArray(value.declarations)) return false;
  return value.declarations.every(isGenerationModelDeclaration);
}

export function parseGenerationsConfig(rawText: string): GenerationsConfig {
  const parsed = JSON.parse(rawText) as unknown;
  if (!isGenerationsConfig(parsed)) {
    throw new Error("Generations config has invalid schema: missing declarations array");
  }
  return parsed;
}

function createFastContentHash(rawText: string): string {
  let hash = 2166136261;
  for (let i = 0; i < rawText.length; i++) {
    hash ^= rawText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}:${rawText.length}`;
}

export function createCachedGenerationsConfig(input: {
  rawText?: string;
  content: GenerationsConfig | null;
  sourceCheckpointId?: string | null;
  rev?: string;
  updatedAt?: string;
}): CachedGenerationsConfig {
  return {
    rev: input.rev ?? (input.rawText ? createFastContentHash(input.rawText) : `missing:${input.sourceCheckpointId ?? "unknown"}`),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    sourceCheckpointId: input.sourceCheckpointId ?? null,
    content: input.content,
  };
}

export function parseCachedGenerationsConfig(rawText: string): CachedGenerationsConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const content = parsed.content;
  if (content !== null && !isGenerationsConfig(content)) return null;
  return {
    rev: typeof parsed.rev === "string" ? parsed.rev : "unknown",
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    sourceCheckpointId: typeof parsed.sourceCheckpointId === "string" ? parsed.sourceCheckpointId : null,
    content,
  };
}

export function mergeGenerationsConfigs(...configs: Array<GenerationsConfig | null | undefined>): GenerationsConfig {
  const declarations = new Map<string, GenerationModelDeclaration>();
  for (const config of configs) {
    for (const declaration of config?.declarations ?? []) declarations.set(declaration.model, declaration);
  }
  return { declarations: [...declarations.values()].sort((a, b) => a.model.localeCompare(b.model)) };
}
