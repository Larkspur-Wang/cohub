import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "./config.js";
import { redisCommandClient } from "./redis.js";

const PROMPTS_CACHE_TTL_SEC = 5 * 60;
const PROMPTS_CACHE_KEY_PREFIX = "configs:prompts:v1";

type PromptTemplate = {
  name: string;
  description: string;
  argumentHint?: string;
  category?: string;
  content: string;
  filePath: string;
  scope: "platform" | "user" | "project";
};

export type PromptTemplateCatalogEntry = {
  name: string;
  description: string;
  argumentHint?: string;
  category?: string;
  scope: "platform" | "user" | "project";
};

export type ExpandedPromptTemplate = {
  renderedText: string;
  template: PromptTemplateCatalogEntry;
  args: string[];
  rawInput: string;
};

export type LoadPromptTemplatesOptions = {
  userId?: string | null;
  spaceId?: string | null;
};

const inflightByCacheKey = new Map<string, Promise<PromptTemplate[]>>();

function getPlatformPromptsDir() {
  return join(config.platformConfigRoot, "platform", ".pi", "agent", "prompts");
}

function getUserPromptsDir(userId: string) {
  return join(config.platformConfigRoot, "users", userId, ".pi", "agent", "prompts");
}

function getProjectPromptsDir(spaceId: string) {
  return resolve(config.spaceStorageRoot, spaceId, "workspace", ".pi", "agent", "prompts");
}

function getCacheKey(options: LoadPromptTemplatesOptions) {
  return `${PROMPTS_CACHE_KEY_PREFIX}:user:${options.userId ?? "-"}:space:${options.spaceId ?? "-"}`;
}

function parseFrontmatter(markdown: string): {
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

function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = char;
      continue;
    }

    if (char === " " || char === "\t") {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) args.push(current);
  return args;
}

function substituteArgs(content: string, args: string[]): string {
  let result = content;

  result = result.replace(/\$(\d+)/g, (_, num) => {
    const index = Number.parseInt(num, 10) - 1;
    return args[index] ?? "";
  });

  result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, startStr, lengthStr) => {
    let start = Number.parseInt(startStr, 10) - 1;
    if (start < 0) start = 0;
    if (lengthStr) {
      const length = Number.parseInt(lengthStr, 10);
      return args.slice(start, start + length).join(" ");
    }
    return args.slice(start).join(" ");
  });

  const allArgs = args.join(" ");
  result = result.replace(/\$ARGUMENTS/g, allArgs);
  result = result.replace(/\$@/g, allArgs);
  return result;
}

function loadTemplateFromFile(filePath: string, scope: PromptTemplate["scope"]): PromptTemplate | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const { attributes, body } = parseFrontmatter(raw);
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
      content: body,
      filePath,
      scope,
    };
  } catch {
    return null;
  }
}

function loadTemplatesFromDir(dirPath: string, scope: PromptTemplate["scope"]): PromptTemplate[] {
  if (!dirPath || !existsSync(dirPath)) return [];

  let entries: string[] = [];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }

  return entries
    .filter((name) => name.endsWith(".md"))
    .map((name) => loadTemplateFromFile(join(dirPath, name), scope))
    .filter((item): item is PromptTemplate => item !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mergePromptTemplates(options: LoadPromptTemplatesOptions): PromptTemplate[] {
  const merged = new Map<string, PromptTemplate>();

  for (const template of loadTemplatesFromDir(getPlatformPromptsDir(), "platform")) {
    merged.set(template.name, template);
  }

  if (options.userId) {
    for (const template of loadTemplatesFromDir(getUserPromptsDir(options.userId), "user")) {
      merged.set(template.name, template);
    }
  }

  if (options.spaceId && config.spaceStorageRoot) {
    for (const template of loadTemplatesFromDir(getProjectPromptsDir(options.spaceId), "project")) {
      merged.set(template.name, template);
    }
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchPromptTemplates(options: LoadPromptTemplatesOptions): Promise<PromptTemplate[]> {
  const cacheKey = getCacheKey(options);
  const inflight = inflightByCacheKey.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const cached = await redisCommandClient.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as PromptTemplate[];
      } catch {
        // ignore cache parse errors
      }
    }

    const templates = mergePromptTemplates(options);
    await redisCommandClient.set(cacheKey, JSON.stringify(templates), "EX", PROMPTS_CACHE_TTL_SEC);
    return templates;
  })();

  inflightByCacheKey.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inflightByCacheKey.delete(cacheKey);
  }
}

export async function listPromptTemplates(options: LoadPromptTemplatesOptions = {}): Promise<PromptTemplateCatalogEntry[]> {
  const templates = await fetchPromptTemplates(options);
  return templates.map((template) => ({
    name: template.name,
    description: template.description,
    argumentHint: template.argumentHint,
    category: template.category,
    scope: template.scope,
  }));
}

export async function expandPromptTemplate(text: string, options: LoadPromptTemplatesOptions = {}): Promise<ExpandedPromptTemplate | null> {
  if (!text.startsWith("/")) return null;

  const spaceIndex = text.indexOf(" ");
  const templateName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
  const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
  const template = (await fetchPromptTemplates(options)).find((item) => item.name === templateName);
  if (!template) return null;

  const args = parseCommandArgs(argsString);
  return {
    renderedText: substituteArgs(template.content, args),
    template: {
      name: template.name,
      description: template.description,
      argumentHint: template.argumentHint,
      category: template.category,
      scope: template.scope,
    },
    args,
    rawInput: text,
  };
}
