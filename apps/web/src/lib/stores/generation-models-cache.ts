import type { PublicGenerationDeclaration } from "@cohub/protocol/generation";
import { canUseUserScopedCache, getCacheUserKey } from "$lib/cache/keys";
import { sdk } from "$lib/sdk";
import { isValidCachedGenerationModel } from "$lib/stores/generation-models-validation";

const STORAGE_PREFIX = "cohub:generation-models:v1";
let memory: PublicGenerationDeclaration[] | null = null;
let memoryUserKey: string | null = null;
let activeLoad: {
	userKey: string;
	promise: Promise<PublicGenerationDeclaration[]>;
} | null = null;

function storageKey(userKey: string) {
	return `${STORAGE_PREFIX}:${encodeURIComponent(userKey)}`;
}

export function getCachedGenerationModels(): PublicGenerationDeclaration[] {
	const userKey = getCacheUserKey();
	if (!canUseUserScopedCache(userKey)) return [];
	if (memoryUserKey !== userKey) {
		memory = null;
		memoryUserKey = userKey;
	}
	if (memory) return memory;
	if (typeof localStorage === "undefined") return [];
	try {
		const parsed = JSON.parse(
			localStorage.getItem(storageKey(userKey)) ?? "null",
		);
		if (Array.isArray(parsed)) {
			const filtered = parsed.filter(
				(item): item is PublicGenerationDeclaration =>
					isValidCachedGenerationModel(item),
			);
			if (filtered.length > 0) memory = filtered;
		}
	} catch {
		// A malformed cache is ignored; the server refresh below replaces it.
	}
	return memory ?? [];
}

export async function loadGenerationModels(options?: {
	refresh?: boolean;
}): Promise<PublicGenerationDeclaration[]> {
	const userKey = getCacheUserKey();
	if (memoryUserKey !== userKey) {
		memory = null;
		memoryUserKey = userKey;
	}
	if (!options?.refresh && memory) return memory;
	if (activeLoad?.userKey === userKey) return activeLoad.promise;
	const promise = sdk.models
		.listMultimodal()
		.then((response) => {
			if (memoryUserKey === userKey) memory = response.models;
			if (
				typeof localStorage !== "undefined" &&
				canUseUserScopedCache(userKey)
			) {
				try {
					localStorage.setItem(
						storageKey(userKey),
						JSON.stringify(response.models),
					);
				} catch {
					// Keep the fresh in-memory catalog when persistent storage is full.
				}
			}
			return response.models;
		})
		.finally(() => {
			if (activeLoad?.promise === promise) activeLoad = null;
		});
	activeLoad = { userKey, promise };
	return promise;
}
