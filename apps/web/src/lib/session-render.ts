import type { ContentBlock, MessageRecord } from "@cohub/protocol";
import type { PendingSessionMessage } from "$lib/stores/session-pending.svelte";

export function buildPendingMessage(
  sessionId: string,
  pending: PendingSessionMessage,
  fallbackSequence: number,
): MessageRecord {
  const pendingText =
    pending.status === "failed" ? `${pending.text}\n\n（发送失败）` : pending.text;

  return {
    id: `pending-${pending.clientMessageId}`,
    sessionId,
    role: "user",
    content: pending.content,
    text: pendingText,
    sequence: fallbackSequence,
    provider: null,
    model: null,
    stopReason: null,
    errorMessage:
      pending.status === "failed"
        ? pending.error ?? "Failed to send message"
        : null,
    usageInput: null,
    usageOutput: null,
    costTotal: null,
    meta: {
      messageKind: "user_pending",
      clientMessageId: pending.clientMessageId,
      pendingStatus: pending.status,
    },
    createdAt: pending.createdAt,
  };
}

export function mergeRenderableMessages(
  persisted: MessageRecord[],
  pending: PendingSessionMessage[],
): MessageRecord[] {
  const byId = new Map(persisted.map((message) => [message.id, message]));
  const persistedClientMessageIds = new Set(
    persisted
      .map((message) => {
        const clientMessageId =
          (message.meta as Record<string, unknown> | null | undefined)?.clientMessageId;
        return typeof clientMessageId === "string" && clientMessageId.trim()
          ? clientMessageId.trim()
          : null;
      })
      .filter((value): value is string => Boolean(value)),
  );

  let nextSequence = (persisted.at(-1)?.sequence ?? 0) + 1;
  for (const pendingMessage of pending) {
    if (persistedClientMessageIds.has(pendingMessage.clientMessageId)) continue;
    const renderable = buildPendingMessage(
      pendingMessage.sessionId,
      pendingMessage,
      nextSequence++,
    );
    byId.set(renderable.id, renderable);
  }

  return Array.from(byId.values()).sort((a, b) => a.sequence - b.sequence);
}

export function buildStreamingPreviewBlocks(
  streamingContentBlocks: ContentBlock[],
  options?: { truncatedStart?: boolean },
): ContentBlock[] {
  let accText = "";
  let accThinking = "";

  for (const block of streamingContentBlocks) {
    if (block.type === "thinking") {
      accThinking += (accThinking ? "\n" : "") + block.thinking;
    } else if (block.type === "text") {
      accText += (accText ? "\n\n" : "") + block.text;
    }
  }

  const trimmedText = accText.trim();
  const trimmedThinking = accThinking.trim();
  if (!trimmedText && !trimmedThinking) return [];

  const blocks: ContentBlock[] = [];
  if (trimmedThinking) blocks.push({ type: "thinking", thinking: trimmedThinking });
  if (trimmedText) {
    blocks.push({
      type: "text",
      text: options?.truncatedStart ? `…${trimmedText}` : trimmedText,
    });
  }
  return blocks;
}
