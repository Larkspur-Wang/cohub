import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  getUserModelTasksRedisKey,
  MODEL_TASKS_CACHE_TTL_SEC,
  parseCachedModelTasksConfig,
  PLATFORM_MODEL_TASKS_REDIS_KEY,
  type ModelTasksConfigOverride,
} from "@cohub/infra/config-runtime/model-tasks";
import { publishModelTasksCacheFromFile } from "../src/model-tasks-cache.js";
import { redisCommandClient } from "../src/redis.js";

after(() => redisCommandClient.disconnect());

const override: ModelTasksConfigOverride = {
  sessionTitle: {
    model: { provider: "cohub", id: "fast" },
    prompt: "Write a concise title.",
  },
  imageToText: {
    model: { provider: "cohub", id: "vision" },
    prompt: "Describe the image.",
  },
};

type CacheWrite = [key: string, value: string, mode: "EX", ttl: number];

function createDeps(readFile: () => Promise<string>) {
  const writes: CacheWrite[] = [];
  return {
    writes,
    deps: {
      cache: {
        set: async (...args: CacheWrite) => {
          writes.push(args);
          return "OK";
        },
      },
      readFile: async () => readFile(),
    },
  };
}

test("publishes platform model tasks from the unified config", async () => {
  const { deps, writes } = createDeps(async () => JSON.stringify(override));
  const cached = await publishModelTasksCacheFromFile(
    { configPath: "/configs/platform/.cohub/model-tasks.json", scope: "platform", sourceCheckpointId: "checkpoint-1" },
    deps,
  );

  assert.equal(writes.length, 1);
  const [key, value, mode, ttl] = writes[0] as CacheWrite;
  assert.equal(key, PLATFORM_MODEL_TASKS_REDIS_KEY);
  assert.equal(mode, "EX");
  assert.equal(ttl, MODEL_TASKS_CACHE_TTL_SEC);
  assert.deepEqual(parseCachedModelTasksConfig(value)?.content, override);
  assert.equal(cached.sourceCheckpointId, "checkpoint-1");
});

test("publishes and removes per-user model tasks", async () => {
  const { deps, writes } = createDeps(async () => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });
  await publishModelTasksCacheFromFile(
    { configPath: "/configs/users/user-1/.cohub/model-tasks.json", scope: "user", userId: "user-1" },
    deps,
  );

  const [key, value] = writes[0] as CacheWrite;
  assert.equal(key, getUserModelTasksRedisKey("user-1"));
  assert.equal(parseCachedModelTasksConfig(value)?.content, null);
});

test("requires a user id for user-scoped publishing", async () => {
  const { deps, writes } = createDeps(async () => JSON.stringify(override));
  await assert.rejects(
    publishModelTasksCacheFromFile({
      configPath: "/configs/users/user-1/.cohub/model-tasks.json",
      scope: "user",
    }, deps),
    /userId is required/,
  );
  assert.equal(writes.length, 0);
});

test("rejects an invalid config without refreshing cache", async () => {
  const { deps, writes } = createDeps(async () => JSON.stringify({ sessionTitle: { enabled: "yes" } }));
  await assert.rejects(
    publishModelTasksCacheFromFile({ configPath: "/configs/platform/.cohub/model-tasks.json", scope: "platform" }, deps),
    /invalid schema/,
  );
  assert.equal(writes.length, 0);
});
