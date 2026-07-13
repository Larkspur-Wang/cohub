import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeTaskRunPricingForViewer } from "../src/task-run-privacy.js";

function generationRun() {
  return {
    taskType: "generation",
    userUuid: "creator_1",
    payload: {
      type: "generation",
      data: {
        model: "gpt-image-2",
        modelDiscount: { multiplier: 0, resolvedAt: "2026-07-13T00:00:00.000Z" },
      },
    },
    result: {
      model: "gpt-image-2",
      cost: 0.04,
      billing: {
        officialCostUsd: 0.04,
        amountUsd: 0,
        discountMultiplier: 0,
        status: "skipped",
        reason: "discounted_free",
      },
    },
  };
}

test("generation creator can view their own pricing", () => {
  const run = generationRun();
  assert.equal(sanitizeTaskRunPricingForViewer(run, "creator_1"), run);
});

test("generation pricing is removed from collaborator task views without mutating storage", () => {
  const run = generationRun();
  const sanitized = sanitizeTaskRunPricingForViewer(run, "collaborator_1");

  assert.deepEqual(sanitized.payload, {
    type: "generation",
    data: { model: "gpt-image-2" },
  });
  assert.deepEqual(sanitized.result, {
    model: "gpt-image-2",
    cost: 0.04,
  });
  assert.equal((run.payload.data as Record<string, unknown>).modelDiscount !== undefined, true);
  assert.equal((run.result as Record<string, unknown>).billing !== undefined, true);
});

test("non-generation task responses are unchanged", () => {
  const run = {
    taskType: "echo",
    userUuid: "creator_1",
    payload: { data: { modelDiscount: { multiplier: 0 } } },
    result: { billing: { amountUsd: 0 } },
  };
  assert.equal(sanitizeTaskRunPricingForViewer(run, "collaborator_1"), run);
});

test("generation billing retry pricing is removed from collaborator task views", () => {
  const run = {
    taskType: "generation.billing_retry",
    userUuid: "creator_1",
    payload: {
      data: {
        taskRunId: "generation_1",
        model: "gpt-image-2",
        officialCostUsd: 0.04,
        amountUsd: 0.024,
        modelDiscount: { multiplier: 0.6, resolvedAt: "2026-07-13T00:00:00.000Z" },
      },
    },
    result: {
      status: "recorded",
      taskRunId: "generation_1",
      officialCostUsd: 0.04,
      amountUsd: 0.024,
      discountMultiplier: 0.6,
    },
  };

  assert.deepEqual(sanitizeTaskRunPricingForViewer(run, "collaborator_1"), {
    ...run,
    payload: { data: { taskRunId: "generation_1", model: "gpt-image-2" } },
    result: { status: "recorded", taskRunId: "generation_1" },
  });
});
