import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeAppPromotionStatsRedisField,
  encodeAppPromotionStatsRedisField,
  APP_PROMOTION_EVENT_KEYS,
  APP_PROMOTION_STATS_ACTIVE_REDIS_KEY,
  APP_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY,
} from "./src/app-promotion-stats.js";

const dimensions = {
  promotionId: "11111111-1111-4111-8111-111111111111",
  appVersionId: "22222222-2222-4222-8222-222222222222",
  bucketStartAtMs: Date.UTC(2026, 7, 17, 9),
  eventKey: "ready" as const,
};

test("keeps promotion stats Redis keys in one cluster hash slot", () => {
  assert.match(APP_PROMOTION_STATS_ACTIVE_REDIS_KEY, /\{app-promotion-stats-v1\}/);
  assert.match(APP_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY, /\{app-promotion-stats-v1\}/);
});

test("round-trips every promotion event dimension", () => {
  for (const eventKey of APP_PROMOTION_EVENT_KEYS) {
    const value = { ...dimensions, eventKey };
    assert.deepEqual(
      decodeAppPromotionStatsRedisField(encodeAppPromotionStatsRedisField(value)),
      value,
    );
  }
});

test("rejects malformed promotion stats dimensions", () => {
  assert.equal(decodeAppPromotionStatsRedisField("not-json"), null);
  assert.equal(decodeAppPromotionStatsRedisField(JSON.stringify([
    dimensions.promotionId,
    dimensions.appVersionId,
    dimensions.bucketStartAtMs,
    "purchase",
  ])), null);
});
