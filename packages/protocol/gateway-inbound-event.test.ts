import assert from "node:assert/strict";
import test from "node:test";
import { gatewayInboundEventSchema } from "./src/gateway/index.js";

const baseEvent = {
  eventId: "event-1",
  timestamp: 1,
  eventType: "message_create" as const,
  channelId: "channel-1",
  provider: "feishu" as const,
  externalChatId: "chat-1",
  externalMessageId: "message-1",
  conversation: { id: "chat-1" },
  sender: { id: "user-1" },
  content: [{ type: "text" as const, text: "hello" }],
};

test("gateway inbound events preserve provider-owned raw events", () => {
  const providerEvent = {
    schema: "provider-specific",
    nested: { thread_id: "thread-1", values: [null, true, 42] },
  };

  const parsed = gatewayInboundEventSchema.parse({ ...baseEvent, providerEvent });

  assert.equal(parsed.providerEvent, providerEvent);
});

test("gateway inbound events do not require a provider event", () => {
  const parsed = gatewayInboundEventSchema.parse(baseEvent);

  assert.equal("providerEvent" in parsed, false);
});
