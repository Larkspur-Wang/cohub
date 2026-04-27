import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { config } from "../config.js";
import { redisCommandClient } from "../redis.js";

const MODELS_REDIS_KEY = "configs:models";
const MODELS_CACHE_TTL_SEC = 30 * 60;
const MODELS_PATH = join(config.platformConfigRoot, "platform", ".cohub", "models.json");

type ModelCatalogEntry = {
  provider: string;
  id: string;
  model: Record<string, unknown>;
};

let modelsCachePromise: Promise<ModelCatalogEntry[]> | null = null;

async function fetchModelsCatalog(): Promise<ModelCatalogEntry[]> {
  if (modelsCachePromise) return modelsCachePromise;
  modelsCachePromise = (async () => {
    const cached = await redisCommandClient.get(MODELS_REDIS_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as ModelCatalogEntry[];
      } catch {
        // ignore parse error, fall through to fetch
      }
    }

    let rawText: string;
    try {
      rawText = await readFile(MODELS_PATH, "utf-8");
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
      if (code === "ENOENT") {
        throw new Error("Models catalog file not found");
      }
      throw error;
    }

    let raw: { providers: Record<string, { models?: Array<Record<string, unknown>> }> };
    try {
      raw = JSON.parse(rawText) as { providers: Record<string, { models?: Array<Record<string, unknown>> }> };
    } catch {
      throw new Error("Models catalog file is invalid JSON");
    }

    const entries: ModelCatalogEntry[] = [];
    for (const [provider, providerConfig] of Object.entries(raw.providers ?? {})) {
      for (const model of providerConfig.models ?? []) {
        entries.push({ provider, id: String(model.id), model });
      }
    }
    await redisCommandClient.set(MODELS_REDIS_KEY, JSON.stringify(entries), "EX", MODELS_CACHE_TTL_SEC);
    return entries;
  })();
  try {
    return await modelsCachePromise;
  } finally {
    modelsCachePromise = null;
  }
}

const router = new Hono();

router.get("/", async (c) => {
  try {
    const catalog = await fetchModelsCatalog();
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
