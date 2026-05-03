import { authStore } from "$lib/stores/auth.svelte";

export function getCacheUserKey() {
	return authStore.userUuid ?? authStore.claims?.sub ?? "guest";
}

export function encodeKeyPart(value: string) {
	return encodeURIComponent(value);
}

export function spaceRecordKey(userKey: string, spaceId: string) {
	return [userKey, spaceId].map(encodeKeyPart).join(":");
}

export function sessionListKey(userKey: string, spaceId: string) {
	return [userKey, spaceId, "recent"].map(encodeKeyPart).join(":");
}

export function sessionTurnsKey(
	userKey: string,
	spaceId: string,
	sessionId: string,
) {
	return [userKey, spaceId, sessionId].map(encodeKeyPart).join(":");
}

export function spaceFsDirKey(
	userKey: string,
	spaceId: string,
	dirPath: string,
) {
	return [userKey, spaceId, normalizeDirPath(dirPath)]
		.map(encodeKeyPart)
		.join(":");
}

export function normalizeDirPath(dirPath: string) {
	return dirPath.trim().replace(/^\/+|\/+$/g, "");
}
