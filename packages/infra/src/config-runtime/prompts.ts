import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const PROMPTS_REDIS_KEY_VERSION = "v2";
export const PLATFORM_PROMPTS_REDIS_KEY = `configs:prompts:${PROMPTS_REDIS_KEY_VERSION}:platform`;
export const USER_PROMPTS_REDIS_KEY_PREFIX = `configs:prompts:${PROMPTS_REDIS_KEY_VERSION}:user`;
export const MOD_PROMPTS_REDIS_KEY_PREFIX = `configs:prompts:${PROMPTS_REDIS_KEY_VERSION}:mod`;
export const SPACE_MOD_PROMPTS_REDIS_KEY_PREFIX = `configs:prompts:${PROMPTS_REDIS_KEY_VERSION}:space-mods`;
export const PROMPTS_CACHE_TTL_SEC = 24 * 60 * 60;

const SAFE_REDIS_KEY_SEGMENT_REGEX = /^[0-9a-zA-Z_-]+$/;

export type PromptTemplateScope = "platform" | "mod" | "user" | "project";

export type PromptTemplate = {
  name: string;
  description: string;
  argumentHint?: string;
  category?: string;
  /** When true, web surfaces this prompt as a quick action button above the chat composer. */
  quickAction?: boolean;
  /** Optional override label for the quick action button. */
  buttonLabel?: string;
  /** Optional sort weight for quick action buttons (ascending, lower first). */
  order?: number;
  content: string;
  filePath: string;
  scope: PromptTemplateScope;
};

export type PromptTemplateCatalogEntry = {
  name: string;
  description: string;
  argumentHint?: string;
  category?: string;
  quickAction?: boolean;
  buttonLabel?: string;
  order?: number;
  scope: PromptTemplateScope;
};

export type PromptTemplatesConfig = {
  templates: PromptTemplate[];
};

export async function loadPromptTemplatesFromDirectory(input: {
  dir: string;
  scope: PromptTemplateScope;
  allowMissing?: boolean;
}): Promise<{ rawText: string; content: PromptTemplatesConfig }> {
  try {
    const entries = await readdir(input.dir);
    const templates: PromptTemplate[] = [];
    const rawParts: string[] = [];

    for (const entry of entries.sort()) {
      if (!entry.endsWith(".md")) continue;
      const path = join(input.dir, entry);
      const rawText = await readFile(path, "utf-8");
      rawParts.push(`${entry}\n${rawText}`);
      templates.push(parsePromptTemplateFromText(rawText, path, input.scope));
    }

    templates.sort((a, b) => a.name.localeCompare(b.name));
    return { rawText: rawParts.join("\n---\n"), content: { templates } };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code !== "ENOENT" || !input.allowMissing) throw error;
    return { rawText: "", content: { templates: [] } };
  }
}

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

export function getModPromptsRedisKey(modSpaceId: string, revision: string): string {
  return `${MOD_PROMPTS_REDIS_KEY_PREFIX}:${assertSafeRedisKeySegment(modSpaceId, "modSpaceId")}:${createFastContentHash(revision)}`;
}

export function getSpaceModPromptsRedisKey(spaceId: string, fingerprint: string): string {
  return `${SPACE_MOD_PROMPTS_REDIS_KEY_PREFIX}:${assertSafeRedisKeySegment(spaceId, "spaceId")}:${createFastContentHash(fingerprint)}`;
}

export function parsePromptFrontmatter(markdown: string): {
  attributes: Record<string, string>;
  body: string;
} {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { attributes: {}, body: markdown };

  const attributes: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) attributes[key] = value;
  }

  return {
    attributes,
    body: markdown.slice(match[0].length),
  };
}

function parseBooleanAttribute(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  return undefined;
}

function parseNumberAttribute(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripSurroundingQuotes(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (
    (normalized.startsWith('"') && normalized.endsWith('"'))
    || (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1).trim() || undefined;
  }
  return normalized;
}

export function parsePromptTemplateFromText(raw: string, filePath: string, scope: PromptTemplateScope): PromptTemplate {
  const { attributes, body } = parsePromptFrontmatter(raw);
  const fileName = filePath.split(/[/\\]/).at(-1) ?? "";
  const name = fileName.replace(/\.md$/i, "");

  let description = attributes.description?.trim() ?? "";
  if (!description) {
    const firstLine = body.split("\n").find((line) => line.trim());
    description = firstLine?.trim().slice(0, 80) ?? name;
  }

  return {
    name,
    description,
    argumentHint: attributes["argument-hint"]?.trim() || undefined,
    category: attributes.category?.trim() || undefined,
    quickAction: parseBooleanAttribute(attributes["quick-action"] ?? attributes.quickAction) || undefined,
    buttonLabel: stripSurroundingQuotes(attributes["button-label"] ?? attributes.buttonLabel),
    order: parseNumberAttribute(attributes.order),
    content: body,
    filePath,
    scope,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isPromptTemplate(value: unknown): value is PromptTemplate {
  if (!isRecord(value)) return false;
  if (value.scope !== "platform" && value.scope !== "mod" && value.scope !== "user" && value.scope !== "project") return false;
  return typeof value.name === "string"
    && typeof value.description === "string"
    && typeof value.content === "string"
    && typeof value.filePath === "string"
    && (value.argumentHint === undefined || typeof value.argumentHint === "string")
    && (value.category === undefined || typeof value.category === "string")
    && (value.quickAction === undefined || typeof value.quickAction === "boolean")
    && (value.buttonLabel === undefined || typeof value.buttonLabel === "string")
    && (value.order === undefined || typeof value.order === "number");
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
    rev: input.rev ?? (input.rawText !== undefined ? createFastContentHash(input.rawText) : `missing:${input.sourceCheckpointId ?? "unknown"}`),
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
