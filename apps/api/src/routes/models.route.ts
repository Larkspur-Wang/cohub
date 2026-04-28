import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import {
  createCachedModelsConfig,
  flattenModelsCatalog,
  getUserModelsRedisKey,
  mergeModelsConfigs,
  MODELS_CACHE_TTL_SEC,
  parseCachedModelsConfig,
  parseModelsConfig,
  PLATFORM_MODELS_REDIS_KEY,
  type CachedModelsConfig,
  type ModelCatalogEntry,
  type ModelsConfig,
} from "@cohub/config-runtime/models";
import { config } from "../config.js";
import { useAuth } from "../lib/middleware.js";
import { redisCommandClient } from "../redis.js";

const PLATFORM_MODELS_PATH = join(config.platformConfigRoot, "platform", ".cohub", "models.json");
const getUserModelsPath = (userId: string) => join(config.platformConfigRoot, "users", userId, ".cohub", "models.json");

const inflightByKey = new Map<string, Promise<ModelsConfig | null>>();

async function loadModelsFromFile(input: {
  modelsPath: string;
  redisKey: string;
  allowMissing: boolean;
}): Promise<CachedModelsConfig> {
  let rawText: string;
  try {
    rawText = await readFile(input.modelsPath, "utf-8");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (code === "ENOENT" && input.allowMissing) {
      const cached = createCachedModelsConfig({ content: null });
      await redisCommandClient.set(input.redisKey, JSON.stringify(cached), "EX", MODELS_CACHE_TTL_SEC);
      return cached;
    }
    if (code === "ENOENT") {
      throw new Error("Models catalog file not found");
    }
    throw error;
  }

  let content: ModelsConfig;
  try {
    content = parseModelsConfig(rawText);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Models catalog file is invalid JSON");
    throw error;
  }

  const cached = createCachedModelsConfig({ rawText, content });
  await redisCommandClient.set(input.redisKey, JSON.stringify(cached), "EX", MODELS_CACHE_TTL_SEC);
  return cached;
}

async function loadCachedModels(input: {
  redisKey: string;
  modelsPath: string;
  allowMissing: boolean;
}): Promise<ModelsConfig | null> {
  const inflight = inflightByKey.get(input.redisKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const cached = await redisCommandClient.get(input.redisKey);
    if (cached) {
      try {
        const parsed = parseCachedModelsConfig(cached);
        if (parsed) return parsed.content;
      } catch {
        // ignore cache parse errors and fall back to file
      }
    }

    return (await loadModelsFromFile(input)).content;
  })();

  inflightByKey.set(input.redisKey, promise);
  try {
    return await promise;
  } finally {
    inflightByKey.delete(input.redisKey);
  }
}

async function fetchModelsCatalog(userId: string): Promise<ModelCatalogEntry[]> {
  const platformModels = await loadCachedModels({
    redisKey: PLATFORM_MODELS_REDIS_KEY,
    modelsPath: PLATFORM_MODELS_PATH,
    allowMissing: false,
  });
  if (!platformModels) throw new Error("Models catalog file not found");

  const userModels = await loadCachedModels({
    redisKey: getUserModelsRedisKey(userId),
    modelsPath: getUserModelsPath(userId),
    allowMissing: true,
  });

  return flattenModelsCatalog(mergeModelsConfigs(platformModels, userModels));
}

const router = new Hono();

router.get("/", async (c) => {
  try {
    const user = useAuth(c);
    const catalog = await fetchModelsCatalog(user.uuid);
    const grouped: Record<string, ModelCatalogEntry[]> = {};
    for (const entry of catalog) {
      let list = grouped[entry.provider];
      if (!list) {
        list = [];
        grouped[entry.provider] = list;
      }
      list.push(entry);
    }
    return c.json(grouped);
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Failed to load models catalog" }, 502);
  }
});

export default router;
