import assert from "node:assert/strict";
import { getAgentTracer } from "@cohub/tracing/agent";

process.env.SESSIONS_NAMESPACE ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.WORKSPACE_ROOT ??= "/tmp";
process.env.SESSIONS_DIR ??= "/tmp";
process.env.PLATFORM_CONFIG_ROOT ??= "/tmp";
process.env.ENV ??= "dev";
process.env.AGENT_INSTANCE_ID ??= "test-agent";

import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { AssistantMessage, AssistantMessageEvent } from "@mariozechner/pi-ai";
const { subscribeSessionEvents } = await import("../session.js");
const { closeRedisConnections } = await import("../redis.js");
const { createAssistantStreamState } = await import("../stream/assistant-stream-state.js");

type SessionHandle = import("../session.js").SessionHandle;
type SessionEvent = Parameters<SessionHandle["session"]["subscribe"]>[0] extends (event: infer T) => void ? T : unknown;

type SessionEventListener = (event: SessionEvent) => void;

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

  emit(event: SessionEvent) {
    if (!this.listener) throw new Error("listener not registered");
    this.listener(event);
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
    currentTurnPatchSeq: null,
    currentAssistantMessageOrdinal: null,
    currentStreamMessageId: null,
    currentLlmRound: null,
    ownerEpoch: 0,
    lastActiveAt: Date.now(),
    idleTimer: null,
    onIdle: null,
    pendingUserMessages: [],
    pendingExecutionAuths: [],
    steerDrainPromise: null,
    pendingSteerCompletions: [],
    currentUserMessageId: null,
    currentUserMessageContent: null,
    currentUserMessageMeta: null,
    persistenceChain: Promise.resolve(),
    operationChain: Promise.resolve(),
    streamState: {
      assistantState: createAssistantStreamState(),
      content: [],
      preferredDisplayMode: "compact",
      lastSent: [],
      pendingFlush: false,
      pendingBoundary: false,
      flushPromise: null,
    },
  };
}

const session = new FakeSession();
const handle = createHandle(session);
subscribeSessionEvents(handle);

session.emit({
  type: "message_start",
  message: createAssistantMessage(),
});

session.emit(createMessageUpdateEvent({
  type: "thinking_start",
  contentIndex: 0,
  partial: createAssistantPartial([{ type: "thinking", thinking: "" }]),
}));

session.emit(createMessageUpdateEvent({
  type: "thinking_delta",
  contentIndex: 0,
  delta: "need files",
  partial: createAssistantPartial([{ type: "thinking", thinking: "need files" }]),
}));

session.emit(createMessageUpdateEvent({
  type: "toolcall_start",
  contentIndex: 1,
  partial: createAssistantPartial([
    { type: "thinking", thinking: "need files" },
    { type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/a" } },
  ]),
}));



session.emit({
  type: "tool_execution_start",
  toolCallId: "t1",
  toolName: "read",
  args: { path: "/tmp/a" },
});

session.emit(createMessageUpdateEvent({
  type: "toolcall_end",
  contentIndex: 1,
  toolCall: { type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/a" } },
  partial: createAssistantPartial([
    { type: "thinking", thinking: "need files" },
    { type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/a" } },
  ]),
}));



session.emit({
  type: "tool_execution_end",
  toolCallId: "t1",
  toolName: "read",
  result: { content: [{ type: "text", text: "hello" }] },
  isError: false,
});

session.emit(createMessageUpdateEvent({
  type: "text_start",
  contentIndex: 2,
  partial: createAssistantPartial([
    { type: "thinking", thinking: "need files" },
    { type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/a" } },
    { type: "text", text: "" },
  ]),
}));

session.emit(createMessageUpdateEvent({
  type: "text_end",
  contentIndex: 2,
  content: "done",
  partial: createAssistantPartial([
    { type: "thinking", thinking: "need files" },
    { type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/a" } },
    { type: "text", text: "done" },
  ]),
}));



assert.deepEqual(
  handle.streamState.content.map((block) => block.type),
  ["thinking", "tool_use", "tool_result", "text"],
  "session integration should keep assistant order and tool result placement",
);

const toolUse = handle.streamState.content.find((block) => block.type === "tool_use") as Extract<ContentBlock, { type: "tool_use" }>;
const toolResult = handle.streamState.content.find((block) => block.type === "tool_result") as Extract<ContentBlock, { type: "tool_result" }>;
const thinking = handle.streamState.content.find((block) => block.type === "thinking") as Extract<ContentBlock, { type: "thinking" }>;
const text = handle.streamState.content.find((block) => block.type === "text") as Extract<ContentBlock, { type: "text" }>;

assert.equal(thinking.thinking, "need files");
assert.equal(toolUse.id, "t1");
assert.equal(toolUse.name, "read");
assert.equal(toolUse._meta?.toolStatus, "done");
assert.equal(toolUse._meta?.summary, "/tmp/a");
assert.equal(toolResult.content, "hello");
assert.equal(text.text, "done");

await closeRedisConnections();

console.log("session stream integration checks passed");
process.exit(0);
