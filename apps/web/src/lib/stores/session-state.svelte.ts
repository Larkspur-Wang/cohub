import type { SessionRecord } from "@cohub/sdk";

const STORAGE_KEY = "cohub:session_viewed";

/**
 * Track which messages the user has seen per session.
 * Persisted in localStorage so unread state survives page reloads.
 */
class UnreadTracker {
	private viewed = $state(new Map<string, string>());

	constructor() {
		this.restore();
	}

	private restore() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const data = JSON.parse(raw) as Record<string, string>;
				this.viewed = new Map(Object.entries(data));
			}
		} catch {
			// ignore
		}
	}

	private persist() {
		try {
			const data: Record<string, string> = {};
			for (const [sessionId, messageId] of this.viewed) {
				data[sessionId] = messageId;
			}
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		} catch {
			// ignore
		}
	}

	isUnread(session: SessionRecord): boolean {
		if (!session.lastMessageId) return false;
		const seen = this.viewed.get(session.id);
		return seen !== session.lastMessageId;
	}

	markViewed(sessionId: string, lastMessageId: string | null) {
		if (!lastMessageId) return;
		this.viewed.set(sessionId, lastMessageId);
		this.persist();
	}

	/**
	 * Clear tracked state for a session (e.g. session deleted).
	 */
	clear(sessionId: string) {
		this.viewed.delete(sessionId);
		this.persist();
	}
}

export const unreadTracker = new UnreadTracker();

/**
 * Whether the session is actively streaming right now.
 */
export function isStreaming(
	session: SessionRecord,
	streamingIds: Set<string>,
): boolean {
	return streamingIds.has(session.id);
}
