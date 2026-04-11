import type { MessageRecord } from "@cohub/protocol";

const DB_NAME = "cohub_messages";
const DB_VERSION = 1;
const STORE_NAME = "session_messages";

// Max total messages across all sessions (oldest by last access are evicted)
const MAX_TOTAL_MESSAGES = 5000;

type CacheEntry = {
  sessionId: string;
  messages: MessageRecord[];
  hasMore: boolean;
  oldestSeq: number | null;
  newestSeq: number | null;
  cachedAt: number;
};

export type MessageCacheEntry = CacheEntry;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "sessionId" });
      }
    };
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => T | Promise<T>,
): Promise<T> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, mode);
  const store = tx.objectStore(STORE_NAME);
  const result = await fn(store);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return result;
}

export class MessageCache {
  async get(sessionId: string): Promise<CacheEntry | null> {
    try {
      return await tx("readonly", (store) => {
        return new Promise<CacheEntry | null>((resolve, reject) => {
          const request = store.get(sessionId);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(request.error);
        });
      });
    } catch {
      return null;
    }
  }

  async set(entry: CacheEntry): Promise<void> {
    try {
      await tx("readwrite", (store) => {
        return new Promise<void>((resolve, reject) => {
          const request = store.put(entry);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      });
    } catch {
      // Storage full or unavailable — silently ignore
    }
  }

  /** Prepend older messages to an existing cache entry */
  async prepend(
    sessionId: string,
    olderMessages: MessageRecord[],
    hasMore: boolean,
  ): Promise<boolean> {
    const existing = await this.get(sessionId);
    if (!existing) return false;
    if (olderMessages.length === 0) {
      // No new messages — just update hasMore flag
      await this.set({
        ...existing,
        hasMore,
        cachedAt: Date.now(),
      });
      return true;
    }

    // Deduplicate: only keep messages not already in cache
    const existingIds = new Set(existing.messages.map((m) => m.id));
    const deduped = olderMessages.filter((m) => !existingIds.has(m.id));

    const merged = [...deduped, ...existing.messages];
    // Sort by sequence to guarantee order (handles overlapping cursor ranges)
    merged.sort((a, b) => a.sequence - b.sequence);

    await this.set({
      sessionId,
      messages: merged,
      hasMore,
      oldestSeq: merged[0]?.sequence ?? existing.oldestSeq,
      newestSeq: merged.at(-1)?.sequence ?? existing.newestSeq,
      cachedAt: Date.now(),
    });
    return true;
  }

  /** Append newer messages (e.g. from streaming sync) */
  async append(
    sessionId: string,
    newerMessages: MessageRecord[],
  ): Promise<void> {
    const existing = await this.get(sessionId);
    if (!existing) {
      // First time: just store them
      await this.set({
        sessionId,
        messages: newerMessages,
        hasMore: true,
        oldestSeq: newerMessages[0]?.sequence ?? null,
        newestSeq: newerMessages.at(-1)?.sequence ?? null,
        cachedAt: Date.now(),
      });
      return;
    }

    // Deduplicate: only add messages not already in cache
    const existingIds = new Set(existing.messages.map((m) => m.id));
    const deduped = newerMessages.filter((m) => !existingIds.has(m.id));
    if (deduped.length === 0) return;

    const merged = [...existing.messages, ...deduped];
    // Sort by sequence to guarantee order
    merged.sort((a, b) => a.sequence - b.sequence);

    await this.set({
      sessionId,
      messages: merged,
      hasMore: existing.hasMore,
      oldestSeq: merged[0]?.sequence ?? existing.oldestSeq,
      newestSeq: merged.at(-1)?.sequence ?? existing.newestSeq,
      cachedAt: Date.now(),
    });
  }

  async invalidate(sessionId: string): Promise<void> {
    try {
      await tx("readwrite", (store) => {
        return new Promise<void>((resolve, reject) => {
          const request = store.delete(sessionId);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      });
    } catch {
      // ignore
    }
  }

  /** Evict oldest sessions when exceeding total message budget */
  async evict(): Promise<void> {
    try {
      const entries = await tx("readonly", (store) => {
        return new Promise<CacheEntry[]>((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result ?? []);
          request.onerror = () => reject(request.error);
        });
      });

      const totalMessages = entries.reduce(
        (sum, e) => sum + e.messages.length,
        0,
      );
      if (totalMessages <= MAX_TOTAL_MESSAGES) return;

      // Sort by cachedAt ascending (oldest first)
      entries.sort((a, b) => a.cachedAt - b.cachedAt);

      let removed = 0;
      await tx("readwrite", (store) => {
        return new Promise<void>((resolve, reject) => {
          for (const entry of entries) {
            if (totalMessages - removed <= MAX_TOTAL_MESSAGES) break;
            store.delete(entry.sessionId);
            removed += entry.messages.length;
          }
          resolve();
        });
      });
    } catch {
      // ignore
    }
  }
}

export const messageCache = new MessageCache();
