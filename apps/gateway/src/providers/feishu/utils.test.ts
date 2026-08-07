import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeishuBindingKey,
  filterFeishuProviderEvent,
  resolveFeishuMessageRelations,
} from "./utils.js";

test("p2p replies without a thread stay in the chat conversation", () => {
  const relations = resolveFeishuMessageRelations({
    chat_type: "p2p",
    parent_id: "message-parent",
    root_id: "message-root",
  });

  assert.deepEqual(relations, {
    conversationThreadId: null,
    parentMessageId: "message-parent",
    rootMessageId: "message-root",
    threadId: null,
  });
  assert.equal(buildFeishuBindingKey("chat-1", relations.conversationThreadId), "feishu:conversation:chat-1");
});

test("p2p thread messages use the explicit thread id", () => {
  const relations = resolveFeishuMessageRelations({
    chat_type: "p2p",
    parent_id: "message-parent",
    root_id: "message-root",
    thread_id: "thread-1",
  });

  assert.equal(relations.conversationThreadId, "thread-1");
  assert.equal(buildFeishuBindingKey("chat-1", relations.conversationThreadId), "feishu:conversation:chat-1:thread-1");
});

test("group replies without a thread stay in the chat conversation", () => {
  const relations = resolveFeishuMessageRelations({
    chat_type: "group",
    parent_id: "message-parent",
    root_id: "message-root",
  });

  assert.equal(relations.conversationThreadId, null);
  assert.equal(relations.parentMessageId, "message-parent");
  assert.equal(relations.rootMessageId, "message-root");
});

test("group thread messages use only the explicit thread id", () => {
  const relations = resolveFeishuMessageRelations({
    chat_type: "group",
    parent_id: "message-parent",
    root_id: "message-root",
    thread_id: "thread-1",
  });

  assert.equal(relations.conversationThreadId, "thread-1");
  assert.equal(buildFeishuBindingKey("chat-1", relations.conversationThreadId), "feishu:conversation:chat-1:thread-1");
});

test("Feishu provider events omit only sensitive top-level fields", () => {
  const nested = { token: "nested-token", tenant_key: "nested-tenant", value: 1 };
  const providerEvent = filterFeishuProviderEvent({
    token: "top-level-token",
    tenant_key: "top-level-tenant",
    event_id: "event-1",
    nested,
  });

  assert.deepEqual(providerEvent, {
    event_id: "event-1",
    nested,
  });
  assert.equal((providerEvent as { nested: unknown }).nested, nested);
});

test("Feishu provider event filtering preserves non-object values", () => {
  assert.equal(filterFeishuProviderEvent(null), null);
  assert.equal(filterFeishuProviderEvent("event"), "event");
});
