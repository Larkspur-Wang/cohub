import { Hono } from "hono";
import { redisCommandClient } from "../redis.js";

const MODELS_CATALOG_URL = "https://gitea.cohub.run/global/configs/raw/branch/main/.pi/agent/models.json";
const MODELS_REDIS_KEY = "configs:models";
const MODELS_CACHE_TTL_SEC = 30 * 60;

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
    const response = await fetch(MODELS_CATALOG_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch models catalog: ${response.status} ${response.statusText}`);
    }
    const raw = await response.json() as { providers: Record<string, { models?: Array<Record<string, unknown>> }> };
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
    return c.json({ message: error instanceof Error ? error.message : "Failed to fetch models catalog" }, 502);
  }
});

export default router;
