import type { ContentBlock } from "@cohub/protocol";

type PendingMessageStatus = "sending" | "sent_unconfirmed" | "failed";

export type PendingSessionMessage = {
  clientMessageId: string;
  sessionId: string;
  role: "user";
  content: ContentBlock[];
  text: string;
  createdAt: string;
  status: PendingMessageStatus;
  error?: string | null;
};

type PendingStore = Record<string, PendingSessionMessage[]>;

class SessionPendingStore {
  pendingBySessionId = $state<PendingStore>({});

  list(sessionId: string): PendingSessionMessage[] {
    return this.pendingBySessionId[sessionId] ?? [];
  }

  upsert(message: PendingSessionMessage) {
    const current = this.pendingBySessionId[message.sessionId] ?? [];
    const next = current.some((item) => item.clientMessageId === message.clientMessageId)
      ? current.map((item) => (item.clientMessageId === message.clientMessageId ? { ...item, ...message } : item))
      : [...current, message];
    this.pendingBySessionId = {
      ...this.pendingBySessionId,
      [message.sessionId]: next,
    };
  }

  markStatus(sessionId: string, clientMessageId: string, status: PendingMessageStatus, error?: string | null) {
    const current = this.pendingBySessionId[sessionId] ?? [];
    if (current.length === 0) return;
    this.pendingBySessionId = {
      ...this.pendingBySessionId,
      [sessionId]: current.map((item) =>
        item.clientMessageId === clientMessageId ? { ...item, status, error: error ?? null } : item,
      ),
    };
  }

  remove(sessionId: string, clientMessageId: string) {
    const current = this.pendingBySessionId[sessionId] ?? [];
    if (current.length === 0) return;
    const next = current.filter((item) => item.clientMessageId !== clientMessageId);
    this.pendingBySessionId = {
      ...this.pendingBySessionId,
      [sessionId]: next,
    };
  }

  reconcilePersisted(sessionId: string, messages: Array<{ meta?: Record<string, unknown> | null }>) {
    const current = this.pendingBySessionId[sessionId] ?? [];
    if (current.length === 0) return;
    const persistedIds = new Set(
      messages
        .map((message) => {
          const meta = message.meta as Record<string, unknown> | null | undefined;
          const clientMessageId = meta?.clientMessageId;
          return typeof clientMessageId === "string" && clientMessageId.trim() ? clientMessageId.trim() : null;
        })
        .filter((value): value is string => Boolean(value)),
    );
    if (persistedIds.size === 0) return;
    const next = current.filter((item) => !persistedIds.has(item.clientMessageId));
    this.pendingBySessionId = {
      ...this.pendingBySessionId,
      [sessionId]: next,
    };
  }
}

export const sessionPendingStore = new SessionPendingStore();
