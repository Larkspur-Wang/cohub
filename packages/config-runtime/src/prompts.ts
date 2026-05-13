export const PROMPTS_REDIS_KEY_VERSION = "v1";
export const PLATFORM_PROMPTS_REDIS_KEY = `configs:prompts:${PROMPTS_REDIS_KEY_VERSION}:platform`;
export const USER_PROMPTS_REDIS_KEY_PREFIX = `configs:prompts:${PROMPTS_REDIS_KEY_VERSION}:user`;
export const PROMPTS_CACHE_TTL_SEC = 24 * 60 * 60;

const SAFE_REDIS_KEY_SEGMENT_REGEX = /^[0-9a-zA-Z_-]+$/;

export type PromptTemplateScope = "platform" | "user" | "project";

export type PromptTemplate = {
  name: string;
  description: string;
  argumentHint?: string;
  category?: string;
  content: string;
  filePath: string;
  scope: PromptTemplateScope;
};

export type PromptTemplateCatalogEntry = {
  name: string;
  description: string;
  argumentHint?: string;
  category?: string;
  scope: PromptTemplateScope;
};

export type PromptTemplatesConfig = {
  templates: PromptTemplate[];
};

export type CachedPromptTemplatesConfig = {
  rev: string;
  updatedAt: string;
  sourceCheckpointId?: string | null;
  content: PromptTemplatesConfig | null;
};

export function assertSafeRedisKeySegment(value: string, label = "value"): string {
  const trimmed = value.trim();
  if (!SAFE_REDIS_KEY_SEGMENT_REGEX.test(trimmed)) {
    throw new Error(`Invalid ${label} for Redis key`);
  }
  return trimmed;
}

export function getUserPromptsRedisKey(userId: string): string {
  return `${USER_PROMPTS_REDIS_KEY_PREFIX}:${assertSafeRedisKeySegment(userId, "userId")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isPromptTemplate(value: unknown): value is PromptTemplate {
  if (!isRecord(value)) return false;
  if (value.scope !== "platform" && value.scope !== "user" && value.scope !== "project") return false;
  return typeof value.name === "string"
    && typeof value.description === "string"
    && typeof value.content === "string"
    && typeof value.filePath === "string"
    && (value.argumentHint === undefined || typeof value.argumentHint === "string")
    && (value.category === undefined || typeof value.category === "string");
}

export function isPromptTemplatesConfig(value: unknown): value is PromptTemplatesConfig {
  if (!isRecord(value) || !Array.isArray(value.templates)) return false;
  return value.templates.every(isPromptTemplate);
}

function createFastContentHash(rawText: string): string {
  let hash = 2166136261;
  for (let i = 0; i < rawText.length; i++) {
    hash ^= rawText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}:${rawText.length}`;
}

export function createCachedPromptTemplatesConfig(input: {
  rawText?: string;
  content: PromptTemplatesConfig | null;
  sourceCheckpointId?: string | null;
  rev?: string;
  updatedAt?: string;
}): CachedPromptTemplatesConfig {
  return {
    rev: input.rev ?? (input.rawText ? createFastContentHash(input.rawText) : `missing:${input.sourceCheckpointId ?? "unknown"}`),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    sourceCheckpointId: input.sourceCheckpointId ?? null,
    content: input.content,
  };
}

export function parseCachedPromptTemplatesConfig(rawText: string): CachedPromptTemplatesConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const content = parsed.content;
  if (content !== null && !isPromptTemplatesConfig(content)) return null;
  return {
    rev: typeof parsed.rev === "string" ? parsed.rev : "unknown",
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    sourceCheckpointId: typeof parsed.sourceCheckpointId === "string" ? parsed.sourceCheckpointId : null,
    content,
  };
}

export function mergePromptTemplatesConfigs(...configs: Array<PromptTemplatesConfig | null | undefined>): PromptTemplatesConfig {
  const templates = new Map<string, PromptTemplate>();
  for (const config of configs) {
    for (const template of config?.templates ?? []) {
      templates.set(template.name, template);
    }
  }
  return { templates: [...templates.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
