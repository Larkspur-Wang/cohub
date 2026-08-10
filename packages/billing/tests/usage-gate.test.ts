import assert from "node:assert/strict";
import { test } from "node:test";
import { BillingUsageGateUnavailableError } from "../src/errors.js";
import { createBillingUsageGate, type BillingUsageGateInput } from "../src/usage-gate.js";

const gateInput = (usageKind: BillingUsageGateInput["usageKind"]): BillingUsageGateInput => ({
  userId: "user-1",
  usageKind,
  source: "generation_task",
});

const gateWithBalance = (netUsd: number) => createBillingUsageGate({
  operations: {
    getCreditStatus: async () => ({ netUsd, groups: [] }),
  },
});

test("video generation requires at least $0.80", async () => {
  const blocked = await gateWithBalance(0.79).evaluate(gateInput("generation.video"));
  assert.equal(blocked.status, "blocked");
  if (blocked.status !== "blocked") return;
  assert.equal(blocked.balanceState, "positive");
  assert.equal("minimumBalanceUsd" in blocked && blocked.minimumBalanceUsd, 0.8);
  assert.equal(blocked.conversion.reason, "minimum_balance_not_met");
  assert.equal(blocked.conversion.title, "Insufficient balance");
  assert.equal(blocked.conversion.message, "Video generation requires a balance of at least $0.80.");

  const allowed = await gateWithBalance(0.8).evaluate(gateInput("generation.video"));
  assert.equal(allowed.status, "allowed");
});

test("minimum video balance does not affect other usage kinds", async () => {
  const decision = await gateWithBalance(0).evaluate(gateInput("generation.image"));
  assert.deepEqual(decision, { status: "allowed", balanceState: "zero", netUsd: 0 });
});

test("video balance lookup failures are fail-closed", async () => {
  const error = new Error("billing unavailable");
  const gate = createBillingUsageGate({
    operations: {
      getCreditStatus: async () => { throw error; },
    },
  });

  await assert.rejects(
    gate.evaluate(gateInput("generation.video")),
    (cause: unknown) => cause instanceof BillingUsageGateUnavailableError && cause.cause === error,
  );
});

test("other balance lookup failures preserve fail-open behavior", async () => {
  const gate = createBillingUsageGate({
    operations: {
      getCreditStatus: async () => { throw new Error("billing unavailable"); },
    },
  });

  assert.deepEqual(
    await gate.evaluate(gateInput("generation.image")),
    { status: "allowed", balanceState: "zero", netUsd: 0 },
  );
});
