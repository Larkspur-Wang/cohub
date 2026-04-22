import assert from "node:assert/strict";

process.env.SESSIONS_NAMESPACE ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.WORKSPACE_ROOT ??= "/tmp";
process.env.SESSIONS_DIR ??= "/tmp";
process.env.PLATFORM_CONFIG_ROOT ??= "/tmp";
process.env.ENV ??= "dev";

const { normalizeAssistantTurn } = await import("../api.js");

const case1 = normalizeAssistantTurn(
  {
    content: [
      { type: "thinking", thinking: "need tool" },
      { type: "tool_result", tool_use_id: "tool-1", content: "README exists", is_error: false },
      { type: "text", text: "Done." },
    ],
  },
  [
    {
      toolCallId: "tool-1",
      toolName: "read",
      input: { path: "/workspace/README.md" },
      content: [{ type: "text", text: "README exists" }],
      isError: false,
    },
  ],
);

assert.deepEqual(
  case1.content.map((block) => block.type),
  ["thinking", "tool_use", "tool_result", "text"],
  "should inject tool_use before tool_result when SDK content lacks toolCall",
);
assert.equal(case1.toolCallRenderStates.length, 1);
assert.equal(case1.toolCallRenderStates[0]?.status, "done");
assert.equal(case1.thinking, "need tool");

const case2 = normalizeAssistantTurn(
  {
    content: [
      { type: "text", text: "Let me check." },
      { type: "toolCall", id: "tool-2", name: "bash", arguments: { command: "pwd" } },
      { type: "tool_result", tool_use_id: "tool-2", content: " /workspace\n", is_error: false },
    ],
  },
  [
    {
      toolCallId: "tool-2",
      toolName: "bash",
      input: { command: "pwd" },
      content: [{ type: "text", text: "/workspace" }],
      isError: false,
    },
  ],
);

assert.equal(case2.content.filter((block) => block.type === "tool_use").length, 1, "should dedupe tool_use");
assert.equal(case2.content.filter((block) => block.type === "tool_result").length, 1, "should dedupe tool_result");
assert.equal(case2.toolCallRenderStates[0]?.summary, "pwd");

const case3 = normalizeAssistantTurn(
  {
    content: [{ type: "text", text: "Working..." }],
  },
  [
    {
      toolCallId: "tool-3",
      toolName: "read",
      input: { path: "/workspace/package.json" },
      isError: false,
    },
  ],
);

assert.deepEqual(
  case3.content.map((block) => block.type),
  ["text", "tool_use"],
  "should append running tool_use even when no tool_result exists yet",
);
assert.equal(case3.toolCallRenderStates[0]?.status, "running");

console.log("normalizeAssistantTurn checks passed");
