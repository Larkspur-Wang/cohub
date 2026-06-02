import type {
	LabelAssignmentListItem,
	LabelAssignmentPageInfo,
	LabelAssignmentRecord,
	LabelListItem,
	LabelResourceType,
} from "@neta-art/cohub";
import { labelItemsRepo } from "$lib/cache/repositories/label-items-repo";
import { labelTreeRepo } from "$lib/cache/repositories/label-tree-repo";
import { sdk } from "$lib/sdk";

const LABEL_ITEMS_PAGE_SIZE = 30;

export async function getCachedSpaceLabelsSnapshot(spaceId: string) {
	return labelTreeRepo.get(spaceId);
}

export async function getCachedSpaceLabels(spaceId: string) {
	return (await labelTreeRepo.get(spaceId))?.labels ?? null;
}

export async function setCachedSpaceLabels(
	spaceId: string,
	labels: LabelListItem[],
) {
	return (await labelTreeRepo.set(spaceId, labels)).labels;
}

export function onSpaceLabelsCacheUpdated(
	handler: (event: { spaceId: string; labels: LabelListItem[] }) => void,
) {
	if (typeof window === "undefined") return () => {};
	const listener = (event: Event) => {
		const custom = event as CustomEvent<{
			spaceId: string;
			labels: LabelListItem[];
		}>;
		if (!custom.detail?.spaceId || !Array.isArray(custom.detail.labels)) return;
		handler(custom.detail);
	};
	window.addEventListener("cohub:space-labels-updated", listener);
	return () =>
		window.removeEventListener("cohub:space-labels-updated", listener);
}

export async function fetchSpaceLabelsFresh(spaceId: string) {
	const labels = (await sdk.space(spaceId).labels.list()).labels ?? [];
	return (await labelTreeRepo.set(spaceId, labels, { source: "network" }))
		.labels;
}

export async function fetchSpaceLabels(spaceId: string, force = false) {
	if (!force) {
		const cached = await labelTreeRepo.get(spaceId);
		if (cached && !cached.stale) return cached.labels;
	}
	return fetchSpaceLabelsFresh(spaceId);
}

export function flattenLabels(labels: LabelListItem[]) {
	const result: LabelListItem[] = [];
	const visit = (items: LabelListItem[]) => {
		for (const label of items) {
			result.push(label);
			if (label.children?.length) visit(label.children);
		}
	};
	visit(labels);
	return result;
}

export async function createSpaceLabel(
	spaceId: string,
	input: { name: string; parentId?: string | null },
) {
	const result = await sdk.space(spaceId).labels.create(input);
	await fetchSpaceLabelsFresh(spaceId);
	return result.label;
}

export async function deleteSpaceLabel(spaceId: string, labelId: string) {
	await sdk.space(spaceId).labels.delete(labelId);
	const labels = await fetchSpaceLabelsFresh(spaceId);
	await labelItemsRepo.deleteFirstPage(spaceId, labelId).catch(() => undefined);
	return labels;
}

export async function getResourceLabels(
	spaceId: string,
	resourceType: LabelResourceType,
	resourceRef: string,
) {
	return sdk.space(spaceId).labels.getResourceLabels(resourceType, resourceRef);
}

export async function getCachedLabelItemsSnapshot(
	spaceId: string,
	labelId: string,
) {
	return labelItemsRepo.getFirstPage(spaceId, labelId);
}

export async function fetchLabelItemsFirstPageFresh(
	spaceId: string,
	labelId: string,
) {
	const snapshot = await labelItemsRepo.refreshFirstPage(
		spaceId,
		labelId,
		async () => {
			const result = await sdk.space(spaceId).labels.listItems(labelId, {
				limit: LABEL_ITEMS_PAGE_SIZE,
				cursor: null,
			});
			return {
				items: result.items ?? [],
				pageInfo: result.pageInfo,
			};
		},
	);
	return { items: snapshot.items, pageInfo: snapshot.pageInfo };
}

export async function setCachedLabelItemsFirstPage(
	spaceId: string,
	labelId: string,
	input: {
		items: LabelAssignmentListItem[];
		pageInfo?: LabelAssignmentPageInfo | null;
	},
) {
	return labelItemsRepo.setFirstPage(spaceId, labelId, input);
}

export async function markLabelItemsStale(spaceId: string, labelId: string) {
	return labelItemsRepo.markStale(spaceId, labelId);
}

export function getAffectedLabelIds(
	oldLabelIds: string[],
	nextLabelIds: string[],
) {
	return Array.from(new Set([...oldLabelIds, ...nextLabelIds]));
}

export async function setResourceLabels(
	spaceId: string,
	resourceType: LabelResourceType,
	resourceRef: string,
	labelIds: string[],
	options?: { previousLabelIds?: string[] },
): Promise<{ labels: LabelListItem[]; assignments: LabelAssignmentRecord[] }> {
	const previousLabelIds =
		options?.previousLabelIds ??
		(await getResourceLabels(spaceId, resourceType, resourceRef)
			.then((result) =>
				result.assignments.map((assignment) => assignment.labelId),
			)
			.catch(() => undefined));
	const result = await sdk
		.space(spaceId)
		.labels.setResourceLabels(resourceType, resourceRef, labelIds);
	await labelTreeRepo.set(spaceId, result.labels, { source: "network" });

	const affectedLabelIds = previousLabelIds
		? getAffectedLabelIds(previousLabelIds, labelIds)
		: labelIds;
	await Promise.all(
		affectedLabelIds.map((labelId) => markLabelItemsStale(spaceId, labelId)),
	).catch(() => undefined);

	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent("cohub:label-assignments-updated", {
				detail: {
					spaceId,
					resourceType,
					resourceRef,
					labelIds,
					affectedLabelIds,
				},
			}),
		);
	}
	return result;
}

export { LABEL_ITEMS_PAGE_SIZE };
