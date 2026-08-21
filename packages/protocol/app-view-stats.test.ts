import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeAppViewStatsRedisField,
  encodeAppViewStatsRedisField,
  APP_VIEW_STATS_ACTIVE_REDIS_KEY,
  APP_VIEW_STATS_FLUSH_LOCK_REDIS_KEY,
  APP_VIEW_STATS_PENDING_INDEX_REDIS_KEY,
  APP_VIEW_STATS_PENDING_REDIS_KEY_PREFIX,
} from "./src/app-view-stats.js";

test("keeps App view Redis keys in one cluster hash slot", () => {
  const keys = [
    APP_VIEW_STATS_ACTIVE_REDIS_KEY,
    APP_VIEW_STATS_FLUSH_LOCK_REDIS_KEY,
    APP_VIEW_STATS_PENDING_INDEX_REDIS_KEY,
    `${APP_VIEW_STATS_PENDING_REDIS_KEY_PREFIX}batch-1`,
  ];
  assert.deepEqual(keys.map((key) => key.match(/\{([^}]+)\}/)?.[1]), [
    "app-view-stats-v1",
    "app-view-stats-v1",
    "app-view-stats-v1",
    "app-view-stats-v1",
  ]);
});

test("round-trips App view Redis field dimensions", () => {
  const dimensions = {
    appId: "11111111-1111-4111-8111-111111111111",
    appVersionId: "22222222-2222-4222-8222-222222222222",
    bucketStartAtMs: Date.parse("2026-08-07T14:00:00.000Z"),
    source: "web" as const,
  };
  assert.deepEqual(
    decodeAppViewStatsRedisField(encodeAppViewStatsRedisField(dimensions)),
    dimensions,
  );
});

test("rejects malformed App view Redis fields", () => {
  assert.equal(decodeAppViewStatsRedisField("not-json"), null);
  assert.equal(decodeAppViewStatsRedisField(JSON.stringify(["work", "version", 1, "web"])), null);
  assert.equal(decodeAppViewStatsRedisField(JSON.stringify([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    -1,
    "web",
  ])), null);
  assert.equal(decodeAppViewStatsRedisField(JSON.stringify([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    1,
    "other",
  ])), null);
});
