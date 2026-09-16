import { test } from "node:test";
import assert from "node:assert";
import {
  buildAgentSandboxFsMutationJobId,
  ensureRuntimeRecoverySchedule,
  sandboxFsMutationJobRetention,
  type AgentSandboxFsMutationOperation,
} from "./index.js";

test("Runtime recovery schedule is durable and shared across Agent replicas", async () => {
  const calls: unknown[][] = [];
  const queue = { upsertJobScheduler: async (...args: unknown[]) => { calls.push(args); } };
  await ensureRuntimeRecoverySchedule(queue as unknown as Parameters<typeof ensureRuntimeRecoverySchedule>[0]);
  await ensureRuntimeRecoverySchedule(queue as unknown as Parameters<typeof ensureRuntimeRecoverySchedule>[0]);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0]?.slice(0, 2), ["runtime_recovery_sweep", { every: 60_000 }]);
});

const writeA: AgentSandboxFsMutationOperation = { operation: "write", path: "a.txt", content: "hello" };
const writeB: AgentSandboxFsMutationOperation = { operation: "write", path: "a.txt", content: "world" };

test("sandbox fs mutation job id is scoped by spaceId and mutationId", () => {
  const id = buildAgentSandboxFsMutationJobId("space-1", "mutation-abc", writeA);
  // Stable for the same space + mutation + payload (idempotent retry).
  assert.equal(buildAgentSandboxFsMutationJobId("space-1", "mutation-abc", writeA), id);
  // Different space must not collide even with the same mutationId.
  assert.notEqual(buildAgentSandboxFsMutationJobId("space-2", "mutation-abc", writeA), id);
  // Different mutation must not collide.
  assert.notEqual(buildAgentSandboxFsMutationJobId("space-1", "mutation-def", writeA), id);
});

test("sandbox fs mutation job id is bound to the payload", () => {
  // The same mutationId reused with different content must not observe the
  // stale first result.
  const first = buildAgentSandboxFsMutationJobId("space-1", "mutation-abc", writeA);
  const second = buildAgentSandboxFsMutationJobId("space-1", "mutation-abc", writeB);
  assert.notEqual(first, second);
});

test("sandbox fs mutation retention preserves a bounded retry window", () => {
  assert.deepEqual(sandboxFsMutationJobRetention, {
    removeOnComplete: { age: 300, count: 200 },
    removeOnFail: { age: 300, count: 200 },
  });
});
