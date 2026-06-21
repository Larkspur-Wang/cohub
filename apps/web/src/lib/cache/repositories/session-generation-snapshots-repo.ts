import type { SessionGenerationSnapshotCacheRecord } from "$lib/cache/db";
import { idbDelete, idbDeleteWhere, idbGet, idbPut } from "$lib/cache/db";
import { getCacheUserKey, sessionGenerationSnapshotKey } from "$lib/cache/keys";

const SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000;

export type SessionGenerationSnapshotInput = Omit<
	SessionGenerationSnapshotCacheRecord,
	"key" | "userKey" | "createdAt" | "updatedAt" | "expiresAt"
> & {
	createdAt?: number | null;
	updatedAt?: number | null;
	expiresAt?: number | null;
};

function getKey(spaceId: string, sessionId: string) {
	return sessionGenerationSnapshotKey(getCacheUserKey(), spaceId, sessionId);
}

function isExpired(record: SessionGenerationSnapshotCacheRecord) {
	return record.expiresAt <= Date.now();
}

export const sessionGenerationSnapshotsRepo = {
	async get(spaceId: string, sessionId: string) {
		const record = await idbGet<SessionGenerationSnapshotCacheRecord>(
			"session_generation_snapshots",
			getKey(spaceId, sessionId),
		);
		if (!record) return null;
		if (record.userKey !== getCacheUserKey() || isExpired(record)) {
			await this.delete(spaceId, sessionId).catch(() => undefined);
			return null;
		}
		return record;
	},

	async put(input: SessionGenerationSnapshotInput) {
		const userKey = getCacheUserKey();
		const now = Date.now();
		const record: SessionGenerationSnapshotCacheRecord = {
			...input,
			key: sessionGenerationSnapshotKey(
				userKey,
				input.spaceId,
				input.sessionId,
			),
			userKey,
			createdAt: input.createdAt ?? now,
			updatedAt: input.updatedAt ?? now,
			expiresAt: input.expiresAt ?? now + SNAPSHOT_TTL_MS,
		};
		await idbPut("session_generation_snapshots", record);
		return record;
	},

	async delete(spaceId: string, sessionId: string) {
		await idbDelete("session_generation_snapshots", getKey(spaceId, sessionId));
	},

	async deleteExpired() {
		const now = Date.now();
		await idbDeleteWhere<SessionGenerationSnapshotCacheRecord>(
			"session_generation_snapshots",
			(record) =>
				record.userKey === getCacheUserKey() && record.expiresAt <= now,
		);
	},
};
