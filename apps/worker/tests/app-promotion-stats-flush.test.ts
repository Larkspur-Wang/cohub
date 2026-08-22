import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAppPromotionStatsRedisField } from "@cohub/protocol";
import { parseAppPromotionStatsBatch } from "../src/system/jobs/app-promotion-stats-flush/batch.js";

const field = encodeAppPromotionStatsRedisField({
  promotionId: "11111111-1111-4111-8111-111111111111",
  appVersionId: "22222222-2222-4222-8222-222222222222",
  bucketStartAtMs: Date.UTC(2026, 7, 17, 9),
  eventKey: "landing",
});

test("parses aggregated Work promotion counters", () => {
  const now = new Date("2026-08-17T10:00:00.000Z");
  assert.deepEqual(parseAppPromotionStatsBatch({ [field]: "3" }, now), {
    rows: [{
      promotionId: "11111111-1111-4111-8111-111111111111",
      appVersionId: "22222222-2222-4222-8222-222222222222",
      bucketStartAt: new Date("2026-08-17T09:00:00.000Z"),
      eventKey: "landing",
      eventCount: 3,
      updatedAt: now,
    }],
    invalid: 0,
  });
});

test("rejects invalid Work promotion counters", () => {
  assert.deepEqual(parseAppPromotionStatsBatch({ [field]: "0" }), { rows: [], invalid: 1 });
  assert.deepEqual(parseAppPromotionStatsBatch({ invalid: "1" }), { rows: [], invalid: 1 });
});
