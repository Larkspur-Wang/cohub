import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SPACE_HOOKS_CACHE_TTL_SEC,
  SPACE_HOOKS_DIR,
  getSpaceHooksRedisKey,
} from "@cohub/protocol";
import {
  isSpaceHookFileName,
  parseSpaceHookDefinition,
} from "./parse.js";
import type { CachedSpaceHooksConfig, SpaceHookDefinition } from "./types.js";

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createCachedSpaceHooksConfig(input: {
  spaceId: string;
  definitions: SpaceHookDefinition[];
  updatedAt?: string;
}): CachedSpaceHooksConfig {
  return {
    version: 1,
    spaceId: input.spaceId,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    definitions: input.definitions,
  };
}

export function parseCachedSpaceHooksConfig(raw: string): CachedSpaceHooksConfig | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    if (typeof parsed.spaceId !== "string" || !parsed.spaceId.trim()) return null;
    if (!Array.isArray(parsed.definitions)) return null;
    return parsed as CachedSpaceHooksConfig;
  } catch {
    return null;
  }
}

export async function loadSpaceHookDefinitionsFromDir(dir: string): Promise<SpaceHookDefinition[]> {
  const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error?.code === "ENOENT") return [] as string[];
    throw error;
  });

  const definitions: SpaceHookDefinition[] = [];
  for (const entry of entries.sort()) {
    if (!isSpaceHookFileName(entry)) continue;
    const path = join(dir, entry);
    const relativePath = `${SPACE_HOOKS_DIR}/${entry}`;
    try {
      const raw = await readFile(path, "utf8");
      definitions.push(parseSpaceHookDefinition(raw, relativePath));
    } catch (error) {
      // Invalid declarations are skipped for matching, but kept out of cache
      // so the next successful read can refresh after a fix.
      console.warn(`[SpaceHooks] skipping invalid hook file ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return definitions;
}

export async function loadSpaceHookDefinitions(input: {
  spaceId: string;
  workspaceDir: string;
  redis?: RedisLike | null;
  allowCache?: boolean;
}): Promise<SpaceHookDefinition[]> {
  const redisKey = getSpaceHooksRedisKey(input.spaceId);
  if (input.allowCache !== false && input.redis) {
    const cached = await input.redis.get(redisKey).catch(() => null);
    if (cached) {
      const parsed = parseCachedSpaceHooksConfig(cached);
      if (parsed) return parsed.definitions;
    }
  }

  const definitions = await loadSpaceHookDefinitionsFromDir(join(input.workspaceDir, SPACE_HOOKS_DIR));
  if (input.redis) {
    const payload = createCachedSpaceHooksConfig({
      spaceId: input.spaceId,
      definitions,
    });
    await input.redis
      .set(redisKey, JSON.stringify(payload), "EX", SPACE_HOOKS_CACHE_TTL_SEC)
      .catch(() => undefined);
  }
  return definitions;
}

export async function invalidateSpaceHooksCache(input: {
  spaceId: string;
  redis: Pick<RedisLike, "del">;
}) {
  await input.redis.del(getSpaceHooksRedisKey(input.spaceId)).catch(() => undefined);
}

export function shouldInvalidateSpaceHooksCache(paths: string[]): boolean {
  return paths.some((path) => {
    const normalized = path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
    return normalized === SPACE_HOOKS_DIR || normalized.startsWith(`${SPACE_HOOKS_DIR}/`);
  });
}

export function buildHookEventFileContent(input: {
  event: {
    id: string;
    type: string;
    timestamp: number;
    spaceId: string;
    sessionId?: string | null;
    payload: Record<string, unknown>;
  };
  hookPath: string;
  taskRunId: string;
  eventActorUserId?: string | null;
  executionUserId: string;
}) {
  return JSON.stringify({
    schema: "cohub.space-event.v1",
    id: input.event.id,
    type: input.event.type,
    spaceId: input.event.spaceId,
    sessionId: input.event.sessionId ?? null,
    occurredAt: new Date(input.event.timestamp).toISOString(),
    actor: input.eventActorUserId ? { type: "user", id: input.eventActorUserId } : null,
    execution: { userId: input.executionUserId },
    hookPath: input.hookPath,
    taskRunId: input.taskRunId,
    payload: input.event.payload,
  }, null, 2);
}

export function buildHookRunCommand(input: {
  run: string;
  event: {
    id: string;
    type: string;
    timestamp: number;
    spaceId: string;
    sessionId?: string | null;
    payload: Record<string, unknown>;
  };
  hookPath: string;
  taskRunId: string;
  eventActorUserId?: string | null;
  executionUserId: string;
}) {
  const eventJson = buildHookEventFileContent(input);
  const shellSingleQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
  return [
    "set -euo pipefail",
    `export COHUB_HOOK_PATH=${shellSingleQuote(input.hookPath)}`,
    `export COHUB_HOOK_TASK_RUN_ID=${shellSingleQuote(input.taskRunId)}`,
    `export COHUB_HOOK_EVENT_ID=${shellSingleQuote(input.event.id)}`,
    `export COHUB_HOOK_EVENT_TYPE=${shellSingleQuote(input.event.type)}`,
    "export COHUB_HOOK_EVENT_FILE=\"$(mktemp /tmp/cohub-hook-event.XXXXXX.json)\"",
    `printf '%s' ${shellSingleQuote(eventJson)} > "$COHUB_HOOK_EVENT_FILE"`,
    "trap 'rm -f \"$COHUB_HOOK_EVENT_FILE\"' EXIT",
    input.run,
  ].join("\n");
}
