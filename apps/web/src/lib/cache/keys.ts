import { authStore } from "$lib/stores/auth.svelte";

export function getCacheUserKey() {
	return authStore.userUuid ?? "guest";
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

export function sessionListIndexKey(userKey: string, spaceId: string) {
	return [userKey, spaceId, "recent", "index"].map(encodeKeyPart).join(":");
}

export function sessionDetailKey(
	userKey: string,
	spaceId: string,
	sessionId: string,
) {
	return [userKey, spaceId, sessionId, "detail"].map(encodeKeyPart).join(":");
}

export function labelTreeKey(userKey: string, spaceId: string) {
	return [userKey, spaceId, "labels"].map(encodeKeyPart).join(":");
}

export function labelItemsKey(
	userKey: string,
	spaceId: string,
	labelId: string,
) {
	return [userKey, spaceId, labelId, "items"].map(encodeKeyPart).join(":");
}

export function resourceLabelsKey(
	userKey: string,
	spaceId: string,
	resourceType: string,
	resourceRef: string,
) {
	return [userKey, spaceId, resourceType, resourceRef]
		.map(encodeKeyPart)
		.join(":");
}

export function canvasPendingTransactionKey(
	userKey: string,
	spaceId: string,
	documentId: string,
	txId: string,
) {
	return [userKey, spaceId, documentId, txId].map(encodeKeyPart).join(":");
}

export function taskRunKey(
	userKey: string,
	spaceId: string,
	taskRunId: string,
) {
	return [userKey, spaceId, taskRunId].map(encodeKeyPart).join(":");
}

export function sessionTurnsKey(
	userKey: string,
	spaceId: string,
	sessionId: string,
) {
	return [userKey, spaceId, sessionId, "turns-v2"].map(encodeKeyPart).join(":");
}

export function sessionGenerationSnapshotKey(
	userKey: string,
	spaceId: string,
	sessionId: string,
) {
	return [userKey, spaceId, sessionId, "generation"]
		.map(encodeKeyPart)
		.join(":");
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
