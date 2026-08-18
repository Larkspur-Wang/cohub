import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { GenerationSessionMessage } from "../generation-message-projection.js";
import { appendTerminalGenerationMessages } from "../generation-session-sync.js";

function generationMessage(input: {
  id: string;
  role: "user" | "assistant";
  taskId: string;
  status?: "queued" | "completed";
}): GenerationSessionMessage {
  return {
    id: input.id,
    turnId: `turn-${input.taskId}`,
    role: input.role,
    content: [{ type: "text", text: input.role === "user" ? "create" : "created" }],
    provider: "generation",
    model: "image-model",
    meta: {
      messageKind: input.role === "user" ? "generation_request" : "generation_result",
      generationTaskId: input.taskId,
      ...(input.status ? { generationStatus: input.status } : {}),
    },
    createdAt: new Date("2026-08-18T00:00:00.000Z"),
  };
}

test("appends only terminal generation pairs and deduplicates projected roles", async () => {
  const existing = new Set(["done:user"]);
  const appended: Array<{ message: AgentMessage; id?: string }> = [];
  let flushCount = 0;
  const sink = {
    getMessageMetaValues: () => existing,
    appendMessage: (message: AgentMessage, options?: { id?: string }) => {
      appended.push({ message, id: options?.id });
      return options?.id ?? "generated";
    },
    flush: async () => {
      flushCount += 1;
    },
  };

  const result = await appendTerminalGenerationMessages([
    generationMessage({ id: "pending-user", role: "user", taskId: "pending" }),
    generationMessage({ id: "pending-result", role: "assistant", taskId: "pending", status: "queued" }),
    generationMessage({ id: "done-user", role: "user", taskId: "done" }),
    generationMessage({ id: "done-result", role: "assistant", taskId: "done", status: "completed" }),
  ], sink);

  assert.equal(result.length, 1);
  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.message.role, "assistant");
  assert.equal(appended[0]?.id, "generation:done:assistant");
  assert.equal(flushCount, 1);
  assert.ok(existing.has("done:assistant"));
});
