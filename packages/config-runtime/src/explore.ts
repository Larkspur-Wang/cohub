export const EXPLORE_REDIS_KEY_VERSION = "v1";
export const PLATFORM_EXPLORE_REDIS_KEY = `configs:explore:${EXPLORE_REDIS_KEY_VERSION}:platform`;
export const EXPLORE_CACHE_TTL_SEC = 24 * 60 * 60;

export type ExploreSpaceConfig = {
  spaceId: string;
  rank?: number;
  category?: string;
  label?: string;
};

export type ExploreConfig = {
  version: number;
  spaces: ExploreSpaceConfig[];
};

export type CachedExploreConfig = {
  rev: string;
  updatedAt: string;
  content: ExploreConfig | null;
};

export function isExploreConfig(value: unknown): value is ExploreConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "number") return false;
  if (!Array.isArray(record.spaces)) return false;
  return record.spaces.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const space = item as Record<string, unknown>;
    return typeof space.spaceId === "string" &&
      (space.rank === undefined || typeof space.rank === "number") &&
      (space.category === undefined || typeof space.category === "string") &&
      (space.label === undefined || typeof space.label === "string");
  });
}

export function parseExploreConfig(rawText: string): ExploreConfig {
  const parsed = JSON.parse(rawText) as unknown;
  if (!isExploreConfig(parsed)) {
    throw new Error("Explore config file has invalid schema");
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

export function createCachedExploreConfig(input: {
  rawText?: string;
  content: ExploreConfig | null;
  rev?: string;
  updatedAt?: string;
}): CachedExploreConfig {
  return {
    rev: input.rev ?? (input.rawText ? createFastContentHash(input.rawText) : "missing:explore"),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    content: input.content,
  };
}

export function parseCachedExploreConfig(rawText: string): CachedExploreConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const content = record.content;
  if (content !== null && !isExploreConfig(content)) return null;
  return {
    rev: typeof record.rev === "string" ? record.rev : "unknown",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    content,
  };
}
