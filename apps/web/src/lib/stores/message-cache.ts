import type { MessageRecord } from "@neta-art/cohub-protocol/model";

const DB_NAME = "cohub_messages";
const DB_VERSION = 2;
const STORE_NAME = "session_messages";

const MAX_TOTAL_MESSAGES = 5000;

export type MessageCacheEntry = {
	sessionId: string;
	messages: MessageRecord[];
	hasMore: boolean;
	oldestSeq: number | null;
	newestSeq: number | null;
	cachedAt: number;
	lastDbAlignedAt: number;
};

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

function getContentDetail(message: MessageRecord): "summary" | "full" {
	const value = message.meta?.contentDetail;
	return value === "summary" ? "summary" : "full";
}

function getMessageDetailRank(message: MessageRecord) {
	if (getContentDetail(message) === "full") return 3;
	if (message.meta?.contentPlaceholder === "assistant_intermediate") return 1;
	return 2;
}

function chooseMessage(current: MessageRecord, incoming: MessageRecord) {
	const currentRank = getMessageDetailRank(current);
	const incomingRank = getMessageDetailRank(incoming);
	if (currentRank > incomingRank) {
		return current;
	}
	if (incomingRank > currentRank) {
		return incoming;
	}
	return incoming;
}

function mergeBySequence(messages: MessageRecord[]): MessageRecord[] {
	const byId = new Map<string, MessageRecord>();
	for (const message of messages) {
		const current = byId.get(message.id);
		byId.set(message.id, current ? chooseMessage(current, message) : message);
	}
	return Array.from(byId.values()).sort((a, b) => a.sequence - b.sequence);
}

export class MessageCache {
	async get(sessionId: string): Promise<MessageCacheEntry | null> {
		try {
			return await tx("readonly", (store) => {
				return new Promise<MessageCacheEntry | null>((resolve, reject) => {
					const request = store.get(sessionId);
					request.onsuccess = () => resolve(request.result ?? null);
					request.onerror = () => reject(request.error);
				});
			});
		} catch {
			return null;
		}
	}

	async replaceAuthoritativeSnapshot(entry: {
		sessionId: string;
		messages: MessageRecord[];
		hasMore: boolean;
	}): Promise<void> {
		try {
			const merged = mergeBySequence(entry.messages);
			await tx("readwrite", (store) => {
				return new Promise<void>((resolve, reject) => {
					const request = store.put({
						sessionId: entry.sessionId,
						messages: merged,
						hasMore: entry.hasMore,
						oldestSeq: merged[0]?.sequence ?? null,
						newestSeq: merged.at(-1)?.sequence ?? null,
						cachedAt: Date.now(),
						lastDbAlignedAt: Date.now(),
					} satisfies MessageCacheEntry);
					request.onsuccess = () => resolve();
					request.onerror = () => reject(request.error);
				});
			});
		} catch {
			// ignore
		}
	}

	async mergeAuthoritativeOlderPage(
		sessionId: string,
		olderMessages: MessageRecord[],
		hasMore: boolean,
	): Promise<boolean> {
		const existing = await this.get(sessionId);
		if (!existing) return false;
		const merged = mergeBySequence([...olderMessages, ...existing.messages]);
		await this.replaceAuthoritativeSnapshot({
			sessionId,
			messages: merged,
			hasMore,
		});
		return true;
	}

	async mergeAuthoritativeNewerPage(
		sessionId: string,
		newerMessages: MessageRecord[],
	): Promise<void> {
		const existing = await this.get(sessionId);
		if (!existing) {
			await this.replaceAuthoritativeSnapshot({
				sessionId,
				messages: newerMessages,
				hasMore: true,
			});
			return;
		}
		const merged = mergeBySequence([...existing.messages, ...newerMessages]);
		await this.replaceAuthoritativeSnapshot({
			sessionId,
			messages: merged,
			hasMore: existing.hasMore,
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

	async evict(): Promise<void> {
		try {
			const entries = await tx("readonly", (store) => {
				return new Promise<MessageCacheEntry[]>((resolve, reject) => {
					const request = store.getAll();
					request.onsuccess = () => resolve(request.result ?? []);
					request.onerror = () => reject(request.error);
				});
			});

			const totalMessages = entries.reduce(
				(sum, entry) => sum + entry.messages.length,
				0,
			);
			if (totalMessages <= MAX_TOTAL_MESSAGES) return;

			entries.sort((a, b) => a.cachedAt - b.cachedAt);
			await tx("readwrite", (store) => {
				return new Promise<void>((resolve, reject) => {
					let removedMessages = 0;
					let index = 0;

					const run = () => {
						if (
							index >= entries.length ||
							totalMessages - removedMessages <= MAX_TOTAL_MESSAGES
						) {
							resolve();
							return;
						}

						const entry = entries[index];
						index += 1;
						if (!entry) {
							run();
							return;
						}

						removedMessages += entry.messages.length;
						const request = store.delete(entry.sessionId);
						request.onsuccess = () => run();
						request.onerror = () => reject(request.error);
					};

					run();
				});
			});
		} catch {
			// ignore
		}
	}
}

export const messageCache = new MessageCache();
