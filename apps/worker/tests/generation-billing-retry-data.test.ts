import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGenerationBillingRetryData } from "../src/tasks/generation-billing-retry-data.js";

const common = {
  taskRunId: "task_1",
  userId: "user_1",
  amountUsd: 0.024,
  usageType: "generation.image",
  model: "gpt-image-2",
};

test("legacy retry payload preserves its already accepted full-price amount", () => {
  assert.deepEqual(parseGenerationBillingRetryData(common), {
    schemaVersion: 2,
    ...common,
    adapterType: null,
    officialCostUsd: 0.024,
    modelDiscount: {
      multiplier: 1,
      resolvedAt: "1970-01-01T00:00:00.000Z",
    },
  });
});

test("version 2 retry payload preserves the accepted Pro pricing snapshot", () => {
  const data = {
    schemaVersion: 2,
    ...common,
    officialCostUsd: 0.04,
    modelDiscount: {
      multiplier: 0.6,
      resolvedAt: "2026-07-13T00:00:00.000Z",
    },
  };
  assert.deepEqual(parseGenerationBillingRetryData(data), { ...data, adapterType: null });
});

test("version 2 retry rejects an amount that does not match the pricing snapshot", () => {
  assert.throws(() => parseGenerationBillingRetryData({
    schemaVersion: 2,
    ...common,
    amountUsd: 0.04,
    officialCostUsd: 0.04,
    modelDiscount: {
      multiplier: 0.6,
      resolvedAt: "2026-07-13T00:00:00.000Z",
    },
  }), /amountUsd does not match/);
});
