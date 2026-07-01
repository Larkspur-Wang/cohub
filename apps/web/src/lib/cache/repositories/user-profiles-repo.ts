import type { PublicUserProfile } from "@neta-art/cohub";
import {
	publishCacheMessage,
	subscribeCacheMessages,
} from "$lib/cache/broadcast";
import { idbGet, idbPut, type UserProfileCacheRecord } from "$lib/cache/db";
import { getCacheUserKey, userProfileKey } from "$lib/cache/keys";
import { MemoryLru } from "$lib/cache/memory-lru";
import type { CacheSource } from "$lib/cache/types";
import { sdk } from "$lib/sdk";

const USER_PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const MISSING_USER_PROFILE_TTL_MS = 10 * 60 * 1000;
const USER_PROFILE_BATCH_SIZE = 100;
const memory = new MemoryLru<string, UserProfileCacheRecord>(1_000);
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<
	(snapshot: UserProfileSnapshot & { userUuid: string }) => void
>();
let subscribedToBroadcast = false;
let userProfilesVersion = 0;

export type UserProfileSnapshot = {
	profile: PublicUserProfile | null;
	updatedAt: number;
	stale: boolean;
	source: CacheSource;
};

function getProfileTtl(profile: PublicUserProfile | null) {
	return profile ? USER_PROFILE_TTL_MS : MISSING_USER_PROFILE_TTL_MS;
}

function toSnapshot(
	record: UserProfileCacheRecord,
	source: CacheSource,
): UserProfileSnapshot {
	return {
		profile: record.profile,
		updatedAt: record.updatedAt,
		stale: Date.now() - record.updatedAt >= getProfileTtl(record.profile),
		source,
	};
}

function normalizeUserUuids(userUuids: string[]) {
	return [...new Set(userUuids.map((value) => value.trim()).filter(Boolean))];
}

function emit(userUuid: string, snapshot: UserProfileSnapshot) {
	if (typeof window !== "undefined") {
		userProfilesVersion += 1;
		window.dispatchEvent(
			new CustomEvent("cohub:user-profiles-updated", {
				detail: { version: userProfilesVersion, userUuids: [userUuid] },
			}),
		);
	}
	for (const listener of listeners) listener({ ...snapshot, userUuid });
}

function emitBatch(userUuids: string[]) {
	if (typeof window === "undefined" || userUuids.length === 0) return;
	userProfilesVersion += 1;
	window.dispatchEvent(
		new CustomEvent("cohub:user-profiles-updated", {
			detail: { version: userProfilesVersion, userUuids },
		}),
	);
}

async function readRecord(userUuid: string) {
	const userKey = getCacheUserKey();
	const key = userProfileKey(userKey, userUuid);
	const cached = memory.get(key);
	if (cached) return { record: cached, source: "memory" as CacheSource };
	const record = await idbGet<UserProfileCacheRecord>("user_profiles", key);
	if (!record) return null;
	const touched = { ...record, lastAccessedAt: Date.now() };
	memory.set(key, touched);
	void idbPut("user_profiles", touched).catch(() => undefined);
	return { record: touched, source: "indexeddb" as CacheSource };
}

async function writeRecord(
	userUuid: string,
	profile: PublicUserProfile | null,
	options?: { broadcast?: boolean; source?: CacheSource },
) {
	const userKey = getCacheUserKey();
	const key = userProfileKey(userKey, userUuid);
	const now = Date.now();
	const record: UserProfileCacheRecord = {
		key,
		userKey,
		userUuid,
		profile,
		updatedAt: now,
		lastAccessedAt: now,
	};
	memory.set(key, record);
	await idbPut("user_profiles", record);
	if (options?.broadcast !== false) {
		publishCacheMessage({
			type: "cache-updated",
			store: "user_profiles",
			key,
			userKey,
			userUuid,
			updatedAt: now,
		});
	}
	return record;
}

function ensureBroadcastSubscription() {
	if (subscribedToBroadcast) return;
	subscribedToBroadcast = true;
	subscribeCacheMessages((message) => {
		if (message.store !== "user_profiles" || !message.userUuid) return;
		if (message.userKey !== getCacheUserKey()) return;
		if (message.key) memory.delete(message.key);
		if (message.type === "cache-deleted") {
			emit(message.userUuid, {
				profile: null,
				updatedAt: message.updatedAt,
				stale: true,
				source: "indexeddb",
			});
			return;
		}
		void readRecord(message.userUuid).then((result) => {
			if (result)
				emit(
					message.userUuid as string,
					toSnapshot(result.record, "indexeddb"),
				);
		});
	});
}

async function refreshMissingOrStale(userUuids: string[]) {
	const unique = normalizeUserUuids(userUuids);
	for (let index = 0; index < unique.length; index += USER_PROFILE_BATCH_SIZE) {
		const chunk = unique.slice(index, index + USER_PROFILE_BATCH_SIZE);
		const inflightKey = `${getCacheUserKey()}:${chunk.join(",")}`;
		let promise = inflight.get(inflightKey);
		if (!promise) {
			promise = (async () => {
				const result = await sdk.users.getProfiles({ userUuids: chunk });
				await Promise.all(
					chunk.map((userUuid) =>
						writeRecord(userUuid, result.profiles[userUuid] ?? null, {
							source: "network",
						}),
					),
				);
				emitBatch(chunk);
			})().finally(() => {
				inflight.delete(inflightKey);
			});
			inflight.set(inflightKey, promise);
		}
		await promise;
	}
}

export const userProfilesRepo = {
	getSync(userUuid: string) {
		const normalized = userUuid.trim();
		if (!normalized) return null;
		const key = userProfileKey(getCacheUserKey(), normalized);
		return memory.get(key)?.profile ?? null;
	},

	async get(userUuid: string) {
		ensureBroadcastSubscription();
		const normalized = userUuid.trim();
		if (!normalized) return null;
		const result = await readRecord(normalized);
		return result ? toSnapshot(result.record, result.source) : null;
	},

	async getMany(userUuids: string[]) {
		ensureBroadcastSubscription();
		const entries = await Promise.all(
			normalizeUserUuids(userUuids).map(async (userUuid) => {
				const result = await readRecord(userUuid);
				return [
					userUuid,
					result ? toSnapshot(result.record, result.source) : null,
				] as const;
			}),
		);
		return new Map(entries);
	},

	async hydrate(userUuids: string[], options?: { force?: boolean }) {
		ensureBroadcastSubscription();
		const unique = normalizeUserUuids(userUuids);
		if (unique.length === 0) return;
		const snapshots = await this.getMany(unique);
		const restored = unique.filter(
			(userUuid) => snapshots.get(userUuid)?.source === "indexeddb",
		);
		if (restored.length > 0) emitBatch(restored);
		const staleOrMissing = unique.filter((userUuid) => {
			const snapshot = snapshots.get(userUuid);
			return options?.force || !snapshot || snapshot.stale;
		});
		if (staleOrMissing.length === 0) return;
		await refreshMissingOrStale(staleOrMissing);
	},

	subscribe(handler: (event: { userUuids: string[] }) => void) {
		if (typeof window === "undefined") return () => {};
		const listener = (event: Event) => {
			const custom = event as CustomEvent<{ userUuids?: string[] }>;
			handler({ userUuids: custom.detail?.userUuids ?? [] });
		};
		window.addEventListener("cohub:user-profiles-updated", listener);
		return () =>
			window.removeEventListener("cohub:user-profiles-updated", listener);
	},
};
