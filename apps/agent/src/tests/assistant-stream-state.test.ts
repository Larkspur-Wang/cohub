import assert from "node:assert/strict";

process.env.SESSIONS_NAMESPACE ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.WORKSPACE_ROOT ??= "/tmp";
process.env.SESSIONS_DIR ??= "/tmp";
process.env.PLATFORM_CONFIG_ROOT ??= "/tmp";
process.env.ENV ??= "dev";

import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import {
  applyAssistantMessageEvent,
  applyToolExecutionEnd,
  applyToolExecutionStart,
  createAssistantStreamState,
  projectAssistantStreamState,
} from "../stream/assistant-stream-state.js";

{
  let state = createAssistantStreamState();
  state = applyAssistantMessageEvent(state, {
    type: "toolcall_start",
    contentIndex: 0,
    partial: {
      content: [{ type: "toolCall", id: "t0", name: "read", arguments: { path: "/tmp/early" } }],
    },
  });

  const content = projectAssistantStreamState(state);
  assert.deepEqual(
    content.map((block) => block.type),
    ["tool_use"],
    "should project tool_use early when partial already contains toolCall details",
  );
  const toolUse = content[0] as Extract<ContentBlock, { type: "tool_use" }>;
  assert.equal(toolUse.id, "t0");
  assert.equal(toolUse.name, "read");
  assert.deepEqual(toolUse.input, { path: "/tmp/early" });
}

{
  let state = createAssistantStreamState();
  state = applyAssistantMessageEvent(state, { type: "toolcall_start", contentIndex: 0 });

  const content = projectAssistantStreamState(state);
  assert.deepEqual(content, [], "should not project empty shell tool_use blocks");
}

{
  let state = createAssistantStreamState();
  state = applyAssistantMessageEvent(state, { type: "thinking_start", contentIndex: 0 });
  state = applyAssistantMessageEvent(state, { type: "thinking_delta", contentIndex: 0, delta: "need " });
  state = applyAssistantMessageEvent(state, { type: "thinking_delta", contentIndex: 0, delta: "files" });
  state = applyAssistantMessageEvent(state, {
    type: "thinking_end",
    contentIndex: 0,
    content: "need files",
  });
  state = applyAssistantMessageEvent(state, { type: "text_start", contentIndex: 1 });
  state = applyAssistantMessageEvent(state, { type: "text_delta", contentIndex: 1, delta: "hello" });
  state = applyAssistantMessageEvent(state, { type: "text_end", contentIndex: 1, content: "hello" });
  state = applyAssistantMessageEvent(state, { type: "text_start", contentIndex: 2 });
  state = applyAssistantMessageEvent(state, { type: "text_delta", contentIndex: 2, delta: "world" });
  state = applyAssistantMessageEvent(state, { type: "text_end", contentIndex: 2, content: "world" });

  const content = projectAssistantStreamState(state);
  assert.deepEqual(
    content.map((block) => block.type),
    ["thinking", "text", "text"],
    "should preserve multiple text blocks and ordering",
  );
  assert.equal((content[0] as Extract<ContentBlock, { type: "thinking" }>).thinking, "need files");
  assert.equal((content[1] as Extract<ContentBlock, { type: "text" }>).text, "hello");
  assert.equal((content[2] as Extract<ContentBlock, { type: "text" }>).text, "world");
}

{
  let state = createAssistantStreamState();
  state = applyAssistantMessageEvent(state, { type: "toolcall_start", contentIndex: 0 });
  state = applyToolExecutionStart(state, { toolCallId: "t1", summary: "/tmp/a" });
  state = applyAssistantMessageEvent(state, {
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: { id: "t1", name: "read", arguments: { path: "/tmp/a" } },
  });
  state = applyToolExecutionEnd(state, { toolCallId: "t1", content: "file content", isError: false });

  const content = projectAssistantStreamState(state);
  assert.deepEqual(
    content.map((block) => block.type),
    ["tool_use", "tool_result"],
    "should insert tool_result directly after tool_use",
  );
  const toolUse = content[0] as Extract<ContentBlock, { type: "tool_use" }>;
  const toolResult = content[1] as Extract<ContentBlock, { type: "tool_result" }>;
  assert.equal(toolUse._meta?.toolStatus, "done");
  assert.equal(toolUse._meta?.summary, "/tmp/a");
  assert.equal(toolResult.content, "file content");
}

{
  let state = createAssistantStreamState();
  state = applyToolExecutionStart(state, { toolCallId: "t2", summary: "/tmp/b" });
  state = applyAssistantMessageEvent(state, {
    type: "toolcall_end",
    contentIndex: 1,
    toolCall: { id: "t2", name: "read", arguments: { path: "/tmp/b" } },
  });
  state = applyToolExecutionEnd(state, { toolCallId: "t2", content: "boom", isError: true });

  const content = projectAssistantStreamState(state);
  const toolUse = content.find((block) => block.type === "tool_use") as Extract<ContentBlock, { type: "tool_use" }>;
  const toolResult = content.find((block) => block.type === "tool_result") as Extract<ContentBlock, { type: "tool_result" }>;
  assert.equal(toolUse._meta?.toolStatus, "failed", "should preserve failed tool status");
  assert.equal(toolUse._meta?.summary, "/tmp/b", "should preserve summary when tool_use appears after start event");
  assert.equal(toolResult.is_error, true);
}

{
  let state = createAssistantStreamState();
  state = applyAssistantMessageEvent(state, { type: "text_start", contentIndex: 0 });
  state = applyAssistantMessageEvent(state, { type: "text_delta", contentIndex: 0, delta: "before" });
  state = applyAssistantMessageEvent(state, { type: "toolcall_start", contentIndex: 1 });
  state = applyAssistantMessageEvent(state, {
    type: "toolcall_end",
    contentIndex: 1,
    toolCall: { id: "t3", name: "bash", arguments: { command: "pwd" } },
  });
  state = applyToolExecutionStart(state, { toolCallId: "t3", summary: "pwd" });
  state = applyToolExecutionEnd(state, { toolCallId: "t3", content: "/workspace", isError: false });
  state = applyAssistantMessageEvent(state, { type: "text_start", contentIndex: 2 });
  state = applyAssistantMessageEvent(state, { type: "text_end", contentIndex: 2, content: "after" });

  const content = projectAssistantStreamState(state);
  assert.deepEqual(
    content.map((block) => block.type),
    ["text", "tool_use", "tool_result", "text"],
    "full flow should preserve assistant order and injected tool result position",
  );
}

console.log("assistant-stream-state checks passed");
