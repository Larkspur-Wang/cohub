import type {
	LabelAssignmentListItem,
	LabelAssignmentPageInfo,
} from "@neta-art/cohub";
import {
	publishCacheMessage,
	subscribeCacheMessages,
} from "$lib/cache/broadcast";
import {
	idbDelete,
	idbGet,
	idbPut,
	type LabelItemsCacheRecord,
} from "$lib/cache/db";
import { getCacheUserKey, labelItemsKey } from "$lib/cache/keys";
import { MemoryLru } from "$lib/cache/memory-lru";
import type { CacheSource } from "$lib/cache/types";

const LABEL_ITEMS_TTL_MS = 15_000;
const memory = new MemoryLru<string, LabelItemsCacheRecord>(100);
const listeners = new Set<
	(snapshot: LabelItemsSnapshot & { spaceId: string; labelId: string }) => void
>();
let subscribedToBroadcast = false;

export type LabelItemsSnapshot = {
	items: LabelAssignmentListItem[];
	pageInfo: LabelAssignmentPageInfo;
	updatedAt: number;
	stale: boolean;
	source: CacheSource;
};

function normalizeItems(items: LabelAssignmentListItem[]) {
	return Array.isArray(items) ? items : [];
}

function normalizePageInfo(
	pageInfo: LabelAssignmentPageInfo | null | undefined,
): LabelAssignmentPageInfo {
	return {
		hasMore: Boolean(pageInfo?.hasMore),
		nextCursor: pageInfo?.nextCursor ?? null,
	};
}

function getItemsWatermark(items: LabelAssignmentListItem[]) {
	let watermark: string | null = null;
	for (const item of items) {
		if (item.updatedAt && (!watermark || item.updatedAt > watermark)) {
			watermark = item.updatedAt;
		}
	}
	return watermark;
}

function toSnapshot(
	record: LabelItemsCacheRecord,
	source: CacheSource,
): LabelItemsSnapshot {
	return {
		items: record.items,
		pageInfo: record.pageInfo,
		updatedAt: record.updatedAt,
		stale: Date.now() - record.updatedAt >= LABEL_ITEMS_TTL_MS,
		source,
	};
}

async function readRecord(spaceId: string, labelId: string) {
	const userKey = getCacheUserKey();
	const key = labelItemsKey(userKey, spaceId, labelId);
	const cached = memory.get(key);
	if (cached) return { record: cached, source: "memory" as CacheSource };
	const record = await idbGet<LabelItemsCacheRecord>("label_items", key);
	if (!record) return null;
	const touched = { ...record, lastAccessedAt: Date.now() };
	memory.set(key, touched);
	void idbPut("label_items", touched).catch(() => undefined);
	return { record: touched, source: "indexeddb" as CacheSource };
}

async function writeRecord(
	spaceId: string,
	labelId: string,
	input: {
		items: LabelAssignmentListItem[];
		pageInfo?: LabelAssignmentPageInfo | null;
	},
	options?: { broadcast?: boolean; source?: CacheSource; updatedAt?: number },
) {
	const userKey = getCacheUserKey();
	const key = labelItemsKey(userKey, spaceId, labelId);
	const now = Date.now();
	const items = normalizeItems(input.items);
	const record: LabelItemsCacheRecord = {
		key,
		userKey,
		spaceId,
		labelId,
		items,
		pageInfo: normalizePageInfo(input.pageInfo),
		updatedAt: options?.updatedAt ?? now,
		lastAccessedAt: now,
		watermark: getItemsWatermark(items),
		completeness: "partial",
	};
	memory.set(key, record);
	await idbPut("label_items", record);
	if (options?.broadcast !== false) {
		publishCacheMessage({
			type: "cache-updated",
			store: "label_items",
			key,
			userKey,
			spaceId,
			labelId,
			updatedAt: now,
		});
	}
	emit(spaceId, labelId, toSnapshot(record, options?.source ?? "indexeddb"));
	return record;
}

function emit(spaceId: string, labelId: string, snapshot: LabelItemsSnapshot) {
	for (const listener of listeners) listener({ ...snapshot, spaceId, labelId });
}

function ensureBroadcastSubscription() {
	if (subscribedToBroadcast) return;
	subscribedToBroadcast = true;
	subscribeCacheMessages((message) => {
		if (message.store !== "label_items" || !message.spaceId) return;
		if (message.userKey !== getCacheUserKey()) return;
		if (message.key) memory.delete(message.key);
		if (message.type === "cache-deleted") {
			if (!message.labelId) return;
			emit(message.spaceId, message.labelId, {
				items: [],
				pageInfo: { hasMore: false, nextCursor: null },
				updatedAt: message.updatedAt,
				stale: true,
				source: "indexeddb",
			});
			return;
		}
		if (!message.labelId) return;
		void readRecord(message.spaceId, message.labelId).then((result) => {
			if (result)
				emit(
					message.spaceId as string,
					message.labelId as string,
					toSnapshot(result.record, "indexeddb"),
				);
		});
	});
}

export const labelItemsRepo = {
	async getFirstPage(spaceId: string, labelId: string) {
		ensureBroadcastSubscription();
		const result = await readRecord(spaceId, labelId);
		return result ? toSnapshot(result.record, result.source) : null;
	},

	async refreshFirstPage(
		spaceId: string,
		labelId: string,
		fetcher: () => Promise<{
			items: LabelAssignmentListItem[];
			pageInfo?: LabelAssignmentPageInfo | null;
		}>,
	) {
		ensureBroadcastSubscription();
		const result = await fetcher();
		const record = await writeRecord(spaceId, labelId, result, {
			source: "network",
		});
		return { ...toSnapshot(record, "network"), stale: false };
	},

	async setFirstPage(
		spaceId: string,
		labelId: string,
		input: {
			items: LabelAssignmentListItem[];
			pageInfo?: LabelAssignmentPageInfo | null;
		},
		options?: { broadcast?: boolean; source?: CacheSource },
	) {
		ensureBroadcastSubscription();
		const record = await writeRecord(spaceId, labelId, input, options);
		return toSnapshot(record, options?.source ?? "indexeddb");
	},

	async markStale(spaceId: string, labelId: string) {
		ensureBroadcastSubscription();
		const current = await readRecord(spaceId, labelId);
		if (!current) return null;
		const record = await writeRecord(
			spaceId,
			labelId,
			{
				items: current.record.items,
				pageInfo: current.record.pageInfo,
			},
			{
				source: "indexeddb",
				updatedAt: Date.now() - LABEL_ITEMS_TTL_MS - 1,
			},
		);
		return toSnapshot(record, "indexeddb");
	},

	async deleteFirstPage(spaceId: string, labelId: string) {
		const userKey = getCacheUserKey();
		const key = labelItemsKey(userKey, spaceId, labelId);
		memory.delete(key);
		await idbDelete("label_items", key);
		publishCacheMessage({
			type: "cache-deleted",
			store: "label_items",
			key,
			userKey,
			spaceId,
			labelId,
			updatedAt: Date.now(),
		});
	},

	subscribe(
		spaceId: string,
		labelId: string,
		handler: (snapshot: LabelItemsSnapshot) => void,
	) {
		ensureBroadcastSubscription();
		const listener = (
			snapshot: LabelItemsSnapshot & { spaceId: string; labelId: string },
		) => {
			if (snapshot.spaceId === spaceId && snapshot.labelId === labelId) {
				handler(snapshot);
			}
		};
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};
