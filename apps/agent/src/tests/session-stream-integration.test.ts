import assert from "node:assert/strict";
import { getAgentTracer } from "@cohub/infra/tracing/agent";

process.env.SESSIONS_NAMESPACE ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.WORKSPACE_ROOT ??= "/tmp";
process.env.SESSIONS_DIR ??= "/tmp";
process.env.PLATFORM_CONFIG_ROOT ??= "/tmp";
process.env.ENV ??= "dev";
process.env.AGENT_INSTANCE_ID ??= "test-agent";

import type { ContentBlock } from "@cohub/protocol/core";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
const { subscribeSessionEvents } = await import("../session.js");
const {
  createAssistantStreamState,
  projectAssistantStreamState,
} = await import("../stream/assistant-stream-state.js");

type SessionHandle = import("../session.js").SessionHandle;
type SessionEvent = Parameters<SessionHandle["session"]["subscribe"]>[0] extends (event: infer T) => void ? T : unknown;

type SessionEventListener = (event: SessionEvent) => void | Promise<void>;

function createAssistantMessage(content: AssistantMessage["content"] = []): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "openai",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

function createAssistantPartial(content: AssistantMessage["content"] = []) {
  return createAssistantMessage(content);
}

function createMessageUpdateEvent(
  assistantMessageEvent: Extract<AssistantMessageEvent, { type: Exclude<AssistantMessageEvent["type"], "done" | "error"> }> & { partial: AssistantMessage },
): SessionEvent {
  return {
    type: "message_update",
    message: createAssistantMessage(assistantMessageEvent.partial.content),
    assistantMessageEvent,
  } as SessionEvent;
}

class FakeSession {
  agent = { state: { model: { provider: "test-provider", id: "test-model" } } };
  listener: SessionEventListener | null = null;

  subscribe(listener: SessionEventListener) {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  async emit(event: SessionEvent) {
    if (!this.listener) throw new Error("listener not registered");
    await this.listener(event);
  }
}

function createHandle(session: FakeSession): SessionHandle {
  return {
    spaceId: "space-1",
    spaceOwnerUserId: null,
    sessionKey: "space-1:session-1",
    sessionId: "session-1",
    session: session as unknown as SessionHandle["session"],
    sessionManager: {} as SessionHandle["sessionManager"],
    turnTracer: getAgentTracer(),
    currentTurnId: null,
    currentTurnSeq: null,
    currentExecutionTurnIds: new Set(),
    currentTurnPatchSeq: null,
    currentAssistantMessageOrdinal: null,
    currentStreamMessageId: null,
    currentLlmRound: null,
    currentAccessMode: null,
    ownerEpoch: 0,
    lastActiveAt: Date.now(),
    idleTimer: null,
    onIdle: null,
    pendingUserMessages: [],
    pendingExecutionAuths: [],
    steerDrainPromise: null,
    pendingSteerCompletions: [],
    activeDirectShellCommand: null,
    currentUserMessageId: "00000000-0000-4000-8000-000000000001",
    currentUserMessageContent: null,
    currentUserMessageMeta: null,
    currentUserMessageStartedAt: null,
    toolExecutionStartedAtById: new Map(),
    activeAssistantContext: {
      turnId: "turn-1",
      turnSeq: 1,
      userMessageId: "00000000-0000-4000-8000-000000000001",
      userMeta: null,
      assistantOrdinal: 0,
      streamMessageId: "turn:turn-1:assistant:0",
      patchSeq: 0,
      streamStartedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    },
    persistenceChain: Promise.resolve(),
    operationChain: Promise.resolve(),
    interruptedSnapshotTurnIds: new Set(),
    streamState: {
      assistantState: createAssistantStreamState(),
      content: [],
      preferredDisplayMode: "compact",
      lastSent: [],
      pendingFlush: false,
      pendingBoundary: false,
      flushPromise: null,
      flushTimer: null,
      flushDelayMs: null,
    },
    sessionFileSignature: null,
  };
}

function toolResultText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => (
      block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block
        ? [String(block.text)]
        : []
    ))
    .join("");
}

const session = new FakeSession();
const handle = createHandle(session);
subscribeSessionEvents(handle);

await session.emit({
  type: "message_start",
  message: createAssistantMessage(),
});

await session.emit(createMessageUpdateEvent({
  type: "thinking_start",
  contentIndex: 0,
  partial: createAssistantPartial([{ type: "thinking", thinking: "" }]),
}));

await session.emit(createMessageUpdateEvent({
  type: "thinking_delta",
  contentIndex: 0,
  delta: "need files",
  partial: createAssistantPartial([{ type: "thinking", thinking: "need files" }]),
}));

await session.emit(createMessageUpdateEvent({
  type: "toolcall_start",
  contentIndex: 1,
  partial: createAssistantPartial([
    { type: "thinking", thinking: "need files" },
    { type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/a" } },
  ]),
}));

await session.emit({
  type: "tool_execution_start",
  toolCallId: "t1",
  toolName: "read",
  args: { path: "/tmp/a" },
});

await session.emit(createMessageUpdateEvent({
  type: "toolcall_end",
  contentIndex: 1,
  toolCall: { type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/a" } },
  partial: createAssistantPartial([
    { type: "thinking", thinking: "need files" },
    { type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/a" } },
  ]),
}));

await session.emit({
  type: "tool_execution_end",
  toolCallId: "t1",
  toolName: "read",
  result: { content: [{ type: "text", text: "hello" }] },
  isError: false,
});

await session.emit(createMessageUpdateEvent({
  type: "text_start",
  contentIndex: 2,
  partial: createAssistantPartial([
    { type: "thinking", thinking: "need files" },
    { type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/a" } },
    { type: "text", text: "" },
  ]),
}));

await session.emit(createMessageUpdateEvent({
  type: "text_end",
  contentIndex: 2,
  content: "done",
  partial: createAssistantPartial([
    { type: "thinking", thinking: "need files" },
    { type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/a" } },
    { type: "text", text: "done" },
  ]),
}));

// Cancel any debounced publish timer so this unit test never needs Redis.
if (handle.streamState.flushTimer) {
  clearTimeout(handle.streamState.flushTimer);
  handle.streamState.flushTimer = null;
  handle.streamState.flushDelayMs = null;
}

// Project from assistantState: flush only materializes content when publish succeeds.
const content = projectAssistantStreamState(handle.streamState.assistantState);

assert.deepEqual(
  content.map((block) => block.type),
  ["thinking", "tool_use", "tool_result", "text"],
  "session integration should keep assistant order and tool result placement",
);

const toolUse = content.find((block) => block.type === "tool_use") as Extract<ContentBlock, { type: "tool_use" }>;
const toolResult = content.find((block) => block.type === "tool_result") as Extract<ContentBlock, { type: "tool_result" }>;
const thinking = content.find((block) => block.type === "thinking") as Extract<ContentBlock, { type: "thinking" }>;
const text = content.find((block) => block.type === "text") as Extract<ContentBlock, { type: "text" }>;

assert.equal(thinking.thinking, "need files");
assert.equal(toolUse.id, "t1");
assert.equal(toolUse.name, "read");
assert.equal(toolUse._meta?.toolStatus, "done");
assert.equal(toolUse._meta?.summary, "/tmp/a");
assert.equal(toolResultText(toolResult.content), "hello");
assert.equal(text.text, "done");

console.log("session stream integration checks passed");
process.exit(0);
