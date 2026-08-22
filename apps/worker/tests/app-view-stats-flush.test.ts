import assert from "node:assert/strict";
import test from "node:test";
import { encodeAppViewStatsRedisField } from "@cohub/protocol";
import { parseAppViewStatsBatch } from "../src/system/jobs/app-view-stats-flush/batch.js";

test("parses aggregated Work view counters for a DB batch", () => {
  const field = encodeAppViewStatsRedisField({
    appId: "11111111-1111-4111-8111-111111111111",
    appVersionId: "22222222-2222-4222-8222-222222222222",
    bucketStartAtMs: Date.parse("2026-08-07T14:00:00.000Z"),
    source: "cli",
  });
  const updatedAt = new Date("2026-08-07T14:01:00.000Z");
  const result = parseAppViewStatsBatch({
    [field]: "42",
    invalid: "3",
  }, updatedAt);

  assert.equal(result.invalid, 1);
  assert.deepEqual(result.rows, [{
    appId: "11111111-1111-4111-8111-111111111111",
    appVersionId: "22222222-2222-4222-8222-222222222222",
    bucketStartAt: new Date("2026-08-07T14:00:00.000Z"),
    source: "cli",
    viewCount: 42,
    updatedAt,
  }]);
});

test("rejects non-positive or unsafe Work view counters", () => {
  const field = encodeAppViewStatsRedisField({
    appId: "11111111-1111-4111-8111-111111111111",
    appVersionId: "22222222-2222-4222-8222-222222222222",
    bucketStartAtMs: 0,
    source: "api",
  });
  assert.deepEqual(parseAppViewStatsBatch({ [field]: "0" }), { rows: [], invalid: 1 });
  assert.deepEqual(parseAppViewStatsBatch({ [field]: String(Number.MAX_SAFE_INTEGER + 1) }), {
    rows: [],
    invalid: 1,
  });
});
