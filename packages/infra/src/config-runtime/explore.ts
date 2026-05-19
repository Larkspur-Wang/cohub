export const EXPLORE_REDIS_KEY_VERSION = "v2";
export const PLATFORM_EXPLORE_REDIS_KEY = `configs:explore:${EXPLORE_REDIS_KEY_VERSION}:platform`;
export const EXPLORE_CACHE_TTL_SEC = 24 * 60 * 60;

export type ExploreSpaceConfig = {
  spaceId: string;
  rank?: number;
  category?: string;
  label?: string;
};

export type ExploreSectionConfig = {
  key: string;
  title?: string;
  subtitle?: string;
  description?: string;
  spaces: ExploreSpaceConfig[];
};

export type ExploreConfig = {
  version: number;
  sections?: ExploreSectionConfig[];
  spaces?: ExploreSpaceConfig[];
};

export type CachedExploreConfig = {
  rev: string;
  updatedAt: string;
  content: ExploreConfig | null;
};

function isExploreSpaceConfig(value: unknown): value is ExploreSpaceConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.spaceId === "string" &&
    (record.rank === undefined || typeof record.rank === "number") &&
    (record.category === undefined || typeof record.category === "string") &&
    (record.label === undefined || typeof record.label === "string");
}

function isExploreSectionConfig(value: unknown): value is ExploreSectionConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.key === "string" &&
    (record.title === undefined || typeof record.title === "string") &&
    (record.subtitle === undefined || typeof record.subtitle === "string") &&
    (record.description === undefined || typeof record.description === "string") &&
    Array.isArray(record.spaces) &&
    record.spaces.every(isExploreSpaceConfig);
}

export function isExploreConfig(value: unknown): value is ExploreConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "number") return false;

  const hasSpaces = record.spaces === undefined || (Array.isArray(record.spaces) && record.spaces.every(isExploreSpaceConfig));
  const hasSections = record.sections === undefined || (Array.isArray(record.sections) && record.sections.every(isExploreSectionConfig));
  return hasSpaces && hasSections;
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
