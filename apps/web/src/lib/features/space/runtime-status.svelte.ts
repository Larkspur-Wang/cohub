import type { RuntimeStatus } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";

const statuses = $state<Record<string, RuntimeStatus>>({});
const pending = new Map<string, Promise<RuntimeStatus>>();
export const cachedRuntimeStatus = (spaceId: string) =>
	statuses[spaceId] ?? null;
export function refreshRuntimeStatus(spaceId: string) {
	const existing = pending.get(spaceId);
	if (existing) return existing;
	const request = sdk
		.space(spaceId)
		.getRuntime()
		.then((status) => {
			statuses[spaceId] = status;
			return status;
		})
		.finally(() => pending.delete(spaceId));
	pending.set(spaceId, request);
	return request;
}
