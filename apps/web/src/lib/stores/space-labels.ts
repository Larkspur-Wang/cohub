import type {
	LabelAssignmentRecord,
	LabelListItem,
	LabelResourceType,
} from "@neta-art/cohub";
import { sdk } from "$lib/sdk";
import { createLocalListCache } from "$lib/stores/create-local-list-cache";

const cache = createLocalListCache<LabelListItem>({
	storagePrefix: "cohub:space-labels",
	cacheVersion: 1,
	updatedEventName: "cohub:space-labels-updated",
	ttlMs: 30_000,
	normalize: (labels) => labels,
});

export function getCachedSpaceLabels(spaceId: string) {
	return cache.getCached(spaceId);
}

export function setCachedSpaceLabels(spaceId: string, labels: LabelListItem[]) {
	return cache.setCached(spaceId, labels);
}

export function onSpaceLabelsCacheUpdated(
	handler: (event: { spaceId: string; labels: LabelListItem[] }) => void,
) {
	return cache.onUpdated(({ scope, data }) =>
		handler({ spaceId: scope, labels: data }),
	);
}

export async function fetchSpaceLabels(spaceId: string, force = false) {
	return cache.fetchWithCache(
		spaceId,
		async () => (await sdk.space(spaceId).labels.list()).labels ?? [],
		{ force },
	);
}

export function flattenLabels(labels: LabelListItem[]) {
	const result: LabelListItem[] = [];
	for (const label of labels) {
		result.push(label);
		for (const child of label.children ?? []) result.push(child);
	}
	return result;
}

export async function createSpaceLabel(
	spaceId: string,
	input: { name: string; parentId?: string | null },
) {
	const result = await sdk.space(spaceId).labels.create(input);
	const labels = await fetchSpaceLabels(spaceId, true);
	setCachedSpaceLabels(spaceId, labels);
	return result.label;
}

export async function deleteSpaceLabel(spaceId: string, labelId: string) {
	await sdk.space(spaceId).labels.delete(labelId);
	const labels = await fetchSpaceLabels(spaceId, true);
	setCachedSpaceLabels(spaceId, labels);
	return labels;
}

export async function getResourceLabels(
	spaceId: string,
	resourceType: LabelResourceType,
	resourceRef: string,
) {
	return sdk.space(spaceId).labels.getResourceLabels(resourceType, resourceRef);
}

export async function setResourceLabels(
	spaceId: string,
	resourceType: LabelResourceType,
	resourceRef: string,
	labelIds: string[],
): Promise<{ labels: LabelListItem[]; assignments: LabelAssignmentRecord[] }> {
	const result = await sdk
		.space(spaceId)
		.labels.setResourceLabels(resourceType, resourceRef, labelIds);
	setCachedSpaceLabels(spaceId, result.labels);
	return result;
}
