import type { SessionRecord } from "@neta-art/cohub";
import type { SessionTurnRecord } from "@neta-art/cohub-protocol/model";
import {
	publishCacheMessage,
	subscribeCacheMessages,
} from "$lib/cache/broadcast";
import {
	idbDelete,
	idbGet,
	idbPut,
	type SessionTurnsCacheRecord,
} from "$lib/cache/db";
import { getCacheUserKey, sessionTurnsKey } from "$lib/cache/keys";
import { MemoryLru } from "$lib/cache/memory-lru";
import type { CacheSource } from "$lib/cache/types";
import { mergeTurnsById } from "$lib/stores/turn-cache";

const SESSION_TURNS_TTL_MS = 15_000;
const memory = new MemoryLru<string, SessionTurnsCacheRecord>(50);
const listeners = new Set<
	(
		snapshot: SessionTurnsSnapshot & { spaceId: string; sessionId: string },
	) => void
>();
let subscribedToBroadcast = false;

export type SessionTurnsSnapshot = {
	session: SessionRecord | null;
	turns: SessionTurnRecord[];
	hasMoreOlder: boolean;
	hasMoreNewer: boolean;
	oldestSequence: number | null;
	newestSequence: number | null;
	updatedAt: number;
	stale: boolean;
	source: CacheSource;
};

function getOldestSequence(turns: SessionTurnRecord[]) {
	return turns.length > 0 ? turns[0].sequence : null;
}

function getNewestSequence(turns: SessionTurnRecord[]) {
	return turns.length > 0 ? (turns.at(-1)?.sequence ?? null) : null;
}

function toSnapshot(
	record: SessionTurnsCacheRecord,
	source: CacheSource,
): SessionTurnsSnapshot {
	return {
		session: record.session,
		turns: record.turns,
		hasMoreOlder: record.hasMoreOlder,
		hasMoreNewer: Boolean(
			(record as SessionTurnsCacheRecord & { hasMoreNewer?: boolean })
				.hasMoreNewer,
		),
		oldestSequence: record.oldestSequence,
		newestSequence: record.newestSequence,
		updatedAt: record.updatedAt,
		stale: Date.now() - record.updatedAt >= SESSION_TURNS_TTL_MS,
		source,
	};
}

async function readRecord(spaceId: string, sessionId: string) {
	const userKey = getCacheUserKey();
	const key = sessionTurnsKey(userKey, spaceId, sessionId);
	const cached = memory.get(key);
	if (cached) return { record: cached, source: "memory" as CacheSource };
	const record = await idbGet<SessionTurnsCacheRecord>("session_turns", key);
	if (!record) return null;
	const touched = { ...record, lastAccessedAt: Date.now() };
	memory.set(key, touched);
	void idbPut("session_turns", touched).catch(() => undefined);
	return { record: touched, source: "indexeddb" as CacheSource };
}

async function writeRecord(
	spaceId: string,
	sessionId: string,
	input: {
		session: SessionRecord | null;
		turns: SessionTurnRecord[];
		hasMoreOlder: boolean;
		hasMoreNewer?: boolean;
		reconciledAt?: number;
	},
	options?: { broadcast?: boolean; source?: CacheSource },
) {
	const userKey = getCacheUserKey();
	const key = sessionTurnsKey(userKey, spaceId, sessionId);
	const now = Date.now();
	const turns = [...input.turns].sort((a, b) => a.sequence - b.sequence);
	const record: SessionTurnsCacheRecord = {
		key,
		userKey,
		spaceId,
		sessionId,
		session: input.session,
		turns,
		newestSequence: getNewestSequence(turns),
		oldestSequence: getOldestSequence(turns),
		hasMoreOlder: input.hasMoreOlder,
		...(input.hasMoreNewer !== undefined
			? { hasMoreNewer: input.hasMoreNewer }
			: {}),
		reconciledAt: input.reconciledAt ?? now,
		updatedAt: now,
		lastAccessedAt: now,
		tailWatermark: turns.at(-1)?.updatedAt ?? null,
	};
	memory.set(key, record);
	await idbPut("session_turns", record);
	if (options?.broadcast !== false) {
		publishCacheMessage({
			type: "cache-updated",
			store: "session_turns",
			key,
			userKey,
			spaceId,
			sessionId,
			updatedAt: now,
		});
	}
	emit(spaceId, sessionId, toSnapshot(record, options?.source ?? "indexeddb"));
	return record;
}

function emit(
	spaceId: string,
	sessionId: string,
	snapshot: SessionTurnsSnapshot,
) {
	for (const listener of listeners)
		listener({ ...snapshot, spaceId, sessionId });
}

function ensureBroadcastSubscription() {
	if (subscribedToBroadcast) return;
	subscribedToBroadcast = true;
	subscribeCacheMessages((message) => {
		if (
			message.store !== "session_turns" ||
			!message.spaceId ||
			!message.sessionId
		)
			return;
		if (message.userKey !== getCacheUserKey()) return;
		if (message.key) memory.delete(message.key);
		if (message.type === "cache-deleted") {
			emit(message.spaceId, message.sessionId, {
				session: null,
				turns: [],
				hasMoreOlder: false,
				hasMoreNewer: false,
				oldestSequence: null,
				newestSequence: null,
				updatedAt: message.updatedAt,
				stale: true,
				source: "indexeddb",
			});
			return;
		}
		void readRecord(message.spaceId, message.sessionId).then((result) => {
			if (result)
				emit(
					message.spaceId as string,
					message.sessionId as string,
					toSnapshot(result.record, "indexeddb"),
				);
		});
	});
}

export const sessionTurnsRepo = {
	async getCached(spaceId: string, sessionId: string) {
		ensureBroadcastSubscription();
		const result = await readRecord(spaceId, sessionId);
		return result ? toSnapshot(result.record, result.source) : null;
	},

	async replaceTail(
		spaceId: string,
		sessionId: string,
		response: {
			session: SessionRecord;
			turns: SessionTurnRecord[];
			hasMore: boolean;
		},
		options?: { source?: CacheSource },
	) {
		ensureBroadcastSubscription();
		const record = await writeRecord(
			spaceId,
			sessionId,
			{
				session: response.session,
				turns: response.turns,
				hasMoreOlder: response.hasMore,
				hasMoreNewer: false,
			},
			{ source: options?.source ?? "network" },
		);
		return toSnapshot(record, options?.source ?? "network");
	},

	async mergeTurns(
		spaceId: string,
		sessionId: string,
		turns: SessionTurnRecord[],
		options?: {
			session?: SessionRecord | null;
			preferIncoming?: boolean;
			hasMoreOlder?: boolean;
			hasMoreNewer?: boolean;
			source?: CacheSource;
		},
	) {
		ensureBroadcastSubscription();
		const current = await readRecord(spaceId, sessionId);
		const merged = mergeTurnsById(current?.record.turns ?? [], turns, {
			preferIncoming: options?.preferIncoming ?? true,
		});
		const record = await writeRecord(
			spaceId,
			sessionId,
			{
				session: options?.session ?? current?.record.session ?? null,
				turns: merged,
				hasMoreOlder:
					options?.hasMoreOlder ?? current?.record.hasMoreOlder ?? false,
				hasMoreNewer:
					options?.hasMoreNewer ??
					Boolean(
						(
							current?.record as
								| (SessionTurnsCacheRecord & { hasMoreNewer?: boolean })
								| undefined
						)?.hasMoreNewer,
					),
			},
			{ source: options?.source ?? "indexeddb" },
		);
		return toSnapshot(record, options?.source ?? "indexeddb");
	},

	async replaceTurnId(
		spaceId: string,
		sessionId: string,
		input: { previousTurnId: string; nextTurnId: string },
		options?: { source?: CacheSource },
	) {
		ensureBroadcastSubscription();
		if (input.previousTurnId === input.nextTurnId) {
			const current = await readRecord(spaceId, sessionId);
			return current ? toSnapshot(current.record, current.source) : null;
		}
		const current = await readRecord(spaceId, sessionId);
		if (!current) return null;
		const remappedTurns = current.record.turns.map((turn) => {
			if (turn.id !== input.previousTurnId) return turn;
			const meta = turn.meta ? { ...turn.meta } : null;
			if (meta && "optimistic" in meta) delete meta.optimistic;
			return {
				...turn,
				id: input.nextTurnId,
				meta,
			};
		});
		const merged = mergeTurnsById([], remappedTurns, { preferIncoming: true });
		const record = await writeRecord(
			spaceId,
			sessionId,
			{
				session: current.record.session,
				turns: merged,
				hasMoreOlder: current.record.hasMoreOlder,
				hasMoreNewer: Boolean(
					(
						current.record as SessionTurnsCacheRecord & {
							hasMoreNewer?: boolean;
						}
					).hasMoreNewer,
				),
				reconciledAt: current.record.reconciledAt,
			},
			{ source: options?.source ?? "indexeddb" },
		);
		return toSnapshot(record, options?.source ?? "indexeddb");
	},

	async loadOlder(
		spaceId: string,
		sessionId: string,
		response: {
			session?: SessionRecord | null;
			turns: SessionTurnRecord[];
			hasMore: boolean;
		},
	) {
		const current = await readRecord(spaceId, sessionId);
		const merged = mergeTurnsById(current?.record.turns ?? [], response.turns, {
			preferIncoming: false,
		});
		const record = await writeRecord(
			spaceId,
			sessionId,
			{
				session: response.session ?? current?.record.session ?? null,
				turns: merged,
				hasMoreOlder: response.hasMore,
				hasMoreNewer: Boolean(
					(
						current?.record as
							| (SessionTurnsCacheRecord & { hasMoreNewer?: boolean })
							| undefined
					)?.hasMoreNewer,
				),
			},
			{ source: "network" },
		);
		return toSnapshot(record, "network");
	},

	async clearSession(spaceId: string, sessionId: string) {
		const userKey = getCacheUserKey();
		const key = sessionTurnsKey(userKey, spaceId, sessionId);
		memory.delete(key);
		await idbDelete("session_turns", key);
		publishCacheMessage({
			type: "cache-deleted",
			store: "session_turns",
			key,
			userKey,
			spaceId,
			sessionId,
			updatedAt: Date.now(),
		});
	},

	subscribe(
		spaceId: string,
		sessionId: string,
		handler: (snapshot: SessionTurnsSnapshot) => void,
	) {
		ensureBroadcastSubscription();
		const listener = (
			snapshot: SessionTurnsSnapshot & { spaceId: string; sessionId: string },
		) => {
			if (snapshot.spaceId === spaceId && snapshot.sessionId === sessionId)
				handler(snapshot);
		};
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};
