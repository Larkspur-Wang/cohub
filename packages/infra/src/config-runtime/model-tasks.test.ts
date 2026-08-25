import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCachedModelTasksConfig,
  createModelTasksConfigLoader,
  parseCachedModelTasksConfig,
  parseModelTasksConfigOverride,
  PLATFORM_MODEL_TASKS_REDIS_KEY,
} from "./model-tasks.js";
import {
  createCachedModelsConfig,
  PLATFORM_MODELS_REDIS_KEY,
} from "./models.js";

const models = {
  providers: {
    cohub: {
      api: "openai-responses",
      baseUrl: "https://example.com/v1",
      apiKey: "COHUB_API_KEY",
      headers: { "x-provider": "base" },
      models: [{ id: "fast", input: ["text", "image"] as Array<"text" | "image"> }],
    },
  },
};

function createRedis(values: Record<string, string>) {
  return {
    get: async (key: string) => values[key] ?? null,
    set: async () => "OK",
  };
}

test("model task references a catalog model and applies standard model overrides", async () => {
  const tasks = {
    sessionTitle: {
      model: { provider: "cohub", id: "fast", headers: { "x-task": "title" } },
      prompt: "Write a concise title.",
    },
  };
  const load = createModelTasksConfigLoader({
    platformConfigRoot: "/missing",
    redis: createRedis({
      [PLATFORM_MODEL_TASKS_REDIS_KEY]: JSON.stringify(createCachedModelTasksConfig({
        rawText: JSON.stringify(tasks),
        content: tasks,
      })),
      [PLATFORM_MODELS_REDIS_KEY]: JSON.stringify(createCachedModelsConfig({
        rawText: JSON.stringify(models),
        content: models,
      })),
    }),
  });

  const config = await load();
  assert.equal(config.sessionTitle?.model.api, "openai-responses");
  assert.equal(config.sessionTitle?.model.baseUrl, "https://example.com/v1");
  assert.deepEqual(config.sessionTitle?.model.headers, {
    "x-provider": "base",
    "x-task": "title",
  });
});

test("model task accepts a standalone model", async () => {
  const tasks = parseModelTasksConfigOverride(JSON.stringify({
    imageToText: {
      model: {
        provider: "custom",
        id: "vision",
        api: "openai-responses",
        baseUrl: "https://vision.example.com/v1",
        apiKey: "VISION_KEY",
        input: ["text", "image"],
      },
      prompt: "Describe the image.",
    },
  }));
  const load = createModelTasksConfigLoader({
    platformConfigRoot: "/missing",
    redis: createRedis({
      [PLATFORM_MODEL_TASKS_REDIS_KEY]: JSON.stringify(createCachedModelTasksConfig({ content: tasks })),
      [PLATFORM_MODELS_REDIS_KEY]: JSON.stringify(createCachedModelsConfig({ content: null })),
    }),
  });

  const config = await load();
  assert.equal(config.imageToText?.model.provider, "custom");
  assert.equal(config.imageToText?.model.apiKey, "VISION_KEY");
});

test("disabled user task overrides the platform task", async () => {
  const platform = { imageToText: { model: { provider: "cohub", id: "fast" }, prompt: "Describe." } };
  const user = { imageToText: { enabled: false } };
  const load = createModelTasksConfigLoader({
    platformConfigRoot: "/missing",
    redis: createRedis({
      [PLATFORM_MODEL_TASKS_REDIS_KEY]: JSON.stringify(createCachedModelTasksConfig({ content: platform })),
      "configs:model-tasks:v1:user:user-1": JSON.stringify(createCachedModelTasksConfig({ content: user })),
      [PLATFORM_MODELS_REDIS_KEY]: JSON.stringify(createCachedModelsConfig({ content: models })),
      "configs:models:v2:user:user-1": JSON.stringify(createCachedModelsConfig({ content: null })),
    }),
  });

  assert.equal((await load("user-1")).imageToText, undefined);
});

test("image-to-text requires an image-capable model", async () => {
  const tasks = {
    imageToText: {
      model: { provider: "cohub", id: "text-only" },
      prompt: "Describe the image.",
    },
  };
  const textModels = {
    providers: {
      cohub: {
        api: "openai-responses",
        baseUrl: "https://example.com/v1",
        models: [{ id: "text-only", input: ["text"] as Array<"text"> }],
      },
    },
  };
  const load = createModelTasksConfigLoader({
    platformConfigRoot: "/missing",
    redis: createRedis({
      [PLATFORM_MODEL_TASKS_REDIS_KEY]: JSON.stringify(createCachedModelTasksConfig({ content: tasks })),
      [PLATFORM_MODELS_REDIS_KEY]: JSON.stringify(createCachedModelsConfig({ content: textModels })),
    }),
  });

  await assert.rejects(load(), /image-capable model/);
});

test("model task parser rejects invalid known model fields", () => {
  const invalidModels = [
    { provider: "cohub", id: "fast", api: "" },
    { provider: "cohub", id: "fast", baseUrl: "not-a-url" },
    { provider: "cohub", id: "fast", apiKey: "" },
    { provider: "cohub", id: "fast", reasoning: "yes" },
    { provider: "cohub", id: "fast", cost: { input: -1 } },
    { provider: "cohub", id: "fast", cost: { typo: 1 } },
    { provider: "cohub", id: "fast", contextWindow: 0 },
    { provider: "cohub", id: "fast", maxTokens: 1.5 },
    { provider: "cohub", id: "fast", compat: [] },
  ];

  for (const model of invalidModels) {
    assert.throws(
      () => parseModelTasksConfigOverride(JSON.stringify({
        sessionTitle: { model, prompt: "Write a title." },
      })),
      /invalid schema/,
    );
  }
});

test("model task parser accepts partial cost overrides", () => {
  const parsed = parseModelTasksConfigOverride(JSON.stringify({
    sessionTitle: {
      model: { provider: "cohub", id: "fast", cost: { output: 0.2 } },
      prompt: "Write a title.",
    },
  }));
  assert.deepEqual(parsed.sessionTitle?.model?.cost, { output: 0.2 });
});

test("cached model tasks reject invalid content", () => {
  assert.equal(parseCachedModelTasksConfig(JSON.stringify({ rev: "bad", content: { unknown: {} } })), null);
});
