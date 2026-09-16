import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { contextToPiMessages, type RuntimeContext } from "@cohub/protocol";
import type { SessionManager } from "./local-session-manager.js";
import { projectGenerationSessionMessage } from "../generation-message-projection.js";

/** Append only the missing durable tail; old compacted history must never re-enter context. */
export function syncCloudContext(manager: SessionManager, context: RuntimeContext): boolean {
  const marker = manager.getCustomEntries("cohub.context").at(-1)?.data as { revision?: string; throughTurnId?: string | null } | undefined;
  if (marker?.revision === context.revision) return false;
  let after = -1;
  if (marker?.throughTurnId) {
    for (let index = 0; index < context.messages.length; index++) {
      if (context.messages[index]?.turnId === marker.throughTurnId) after = index;
    }
  }
  {
    const entries = manager.getEntries();
    const entryIds = new Set(entries.map((entry) => entry.id));
    const messageIds = new Set(entries.flatMap((entry) => {
      if (entry.type !== "message") return [];
      const message = entry.message as unknown as { meta?: { messageId?: string }; id?: string };
      return [message.meta?.messageId, message.id].filter((id): id is string => Boolean(id));
    }));
    for (let index = 0; index < context.messages.length; index++) {
      const message = context.messages[index];
      if (message && (messageIds.has(message.id) || typeof message.meta?.agentSessionEntryId === "string" && entryIds.has(message.meta.agentSessionEntryId))) after = Math.max(after, index);
    }
  }
  const tail = context.messages.slice(after + 1);
  let compactIndex = -1;
  tail.forEach((message, index) => { if (message.role === "system" && message.content.some((block) => block.type === "system_note" && block.note_type === "compacted")) compactIndex = index; });
  const hasRetainedTail = compactIndex >= 0 && compactIndex < tail.length - 1;
  let firstKeptEntryId: string | null = null;
  const source = hasRetainedTail ? tail.slice(compactIndex + 1) : tail;
  const projected = source.flatMap((row): AgentMessage[] => row.meta?.generationTaskId
    ? [projectGenerationSessionMessage({ ...row, meta: row.meta ?? {}, provider: row.provider ?? null, model: row.model ?? null, createdAt: new Date(String(row.meta?.createdAt ?? 0)) })]
    : contextToPiMessages([row]) as unknown as AgentMessage[]);
  for (const agentMessage of projected) {
    const message = agentMessage as unknown as Record<string, unknown>;
    const id = typeof (message.meta as { messageId?: unknown } | undefined)?.messageId === "string"
      ? (message.meta as { messageId: string }).messageId : undefined;
    const appendedId = manager.appendMessage(message as unknown as AgentMessage, { id });
    firstKeptEntryId ??= appendedId;
  }
  if (hasRetainedTail && firstKeptEntryId) {
    const summary = tail[compactIndex]?.content.map((block) => block.type === "system_note" ? block.text : "").join("\n") ?? "";
    manager.appendCompaction(summary, firstKeptEntryId, 0);
  }
  manager.appendCustomEntry("cohub.context", { revision: context.revision, throughTurnId: context.throughTurnId });
  return tail.length > 0;
}
