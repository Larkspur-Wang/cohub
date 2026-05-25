import type { SpaceRecord } from "@neta-art/cohub";
import { spaceRecordRepo } from "$lib/cache/repositories/space-record-repo";

function hasOwn<T extends object>(value: T, key: PropertyKey) {
	return Object.hasOwn(value, key);
}

function isCacheableSpaceRecord(space: Partial<SpaceRecord> & { id: string }) {
	return (
		typeof space.userUuid === "string" &&
		space.userUuid.length > 0 &&
		hasOwn(space, "createdAt") &&
		hasOwn(space, "updatedAt")
	);
}

function mergeSpaceRecord(current: SpaceRecord, next: Partial<SpaceRecord>) {
	return {
		...current,
		...next,
		slug: hasOwn(next, "slug") ? next.slug : current.slug,
		description: hasOwn(next, "description")
			? next.description
			: current.description,
		publicProfile: hasOwn(next, "publicProfile")
			? next.publicProfile
			: current.publicProfile,
		ownerProfile: hasOwn(next, "ownerProfile")
			? next.ownerProfile
			: current.ownerProfile,
		channels: hasOwn(next, "channels") ? next.channels : current.channels,
		access: hasOwn(next, "access") ? next.access : current.access,
		accessLevel: hasOwn(next, "accessLevel")
			? next.accessLevel
			: current.accessLevel,
	};
}

export async function cacheSpaceRecord(space: SpaceRecord) {
	const cached = await spaceRecordRepo.getCached(space.id).catch(() => null);
	if (!cached?.space && !isCacheableSpaceRecord(space)) return null;
	const merged = cached?.space ? mergeSpaceRecord(cached.space, space) : space;
	return await spaceRecordRepo.set(space.id, merged);
}

export async function patchCachedSpaceRecord(
	space: Partial<SpaceRecord> & { id: string },
) {
	const cached = await spaceRecordRepo.getCached(space.id).catch(() => null);
	if (!cached?.space) return null;
	const merged = mergeSpaceRecord(cached.space, space);
	return await spaceRecordRepo.set(space.id, merged);
}

export function cacheSpaceRecordSoon(space: SpaceRecord | null | undefined) {
	if (!space?.id) return;
	void cacheSpaceRecord(space).catch(() => undefined);
}

export function patchCachedSpaceRecordSoon(
	space: (Partial<SpaceRecord> & { id: string }) | null | undefined,
) {
	if (!space?.id) return;
	void patchCachedSpaceRecord(space).catch(() => undefined);
}

export function cacheSpaceRecordsSoon(
	spaces: SpaceRecord[] | null | undefined,
) {
	if (!spaces?.length) return;
	for (const space of spaces) cacheSpaceRecordSoon(space);
}
