import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeWorkPromotionStatsRedisField,
  encodeWorkPromotionStatsRedisField,
  WORK_PROMOTION_EVENT_KEYS,
  WORK_PROMOTION_STATS_ACTIVE_REDIS_KEY,
  WORK_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY,
} from "./src/work-promotion-stats.js";

const dimensions = {
  promotionId: "11111111-1111-4111-8111-111111111111",
  workVersionId: "22222222-2222-4222-8222-222222222222",
  bucketStartAtMs: Date.UTC(2026, 7, 17, 9),
  eventKey: "ready" as const,
};

test("keeps promotion stats Redis keys in one cluster hash slot", () => {
  assert.match(WORK_PROMOTION_STATS_ACTIVE_REDIS_KEY, /\{work-promotion-stats-v1\}/);
  assert.match(WORK_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY, /\{work-promotion-stats-v1\}/);
});

test("round-trips every promotion event dimension", () => {
  for (const eventKey of WORK_PROMOTION_EVENT_KEYS) {
    const value = { ...dimensions, eventKey };
    assert.deepEqual(
      decodeWorkPromotionStatsRedisField(encodeWorkPromotionStatsRedisField(value)),
      value,
    );
  }
});

test("rejects malformed promotion stats dimensions", () => {
  assert.equal(decodeWorkPromotionStatsRedisField("not-json"), null);
  assert.equal(decodeWorkPromotionStatsRedisField(JSON.stringify([
    dimensions.promotionId,
    dimensions.workVersionId,
    dimensions.bucketStartAtMs,
    "purchase",
  ])), null);
});
