import type {
	LabelAssignmentListItem,
	LabelAssignmentPageInfo,
	LabelAssignmentRecord,
	LabelListItem,
	LabelResourceType,
} from "@neta-art/cohub";
import { labelItemsRepo } from "$lib/cache/repositories/label-items-repo";
import { labelTreeRepo } from "$lib/cache/repositories/label-tree-repo";
import { resourceLabelsRepo } from "$lib/cache/repositories/resource-labels-repo";
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

export type LabelWithRef = LabelListItem & { ref: string };

export function flattenLabelsWithRefs(labels: LabelListItem[]) {
	const result: LabelWithRef[] = [];
	const visit = (items: LabelListItem[], parentRef = "") => {
		for (const label of items) {
			const ref = parentRef ? `${parentRef}/${label.name}` : label.name;
			result.push({ ...label, ref });
			if (label.children?.length) visit(label.children, ref);
		}
	};
	visit(labels);
	return result;
}

export async function getLabelRefById(spaceId: string, labelId: string) {
	const labels = await fetchSpaceLabels(spaceId);
	return (
		flattenLabelsWithRefs(labels).find((label) => label.id === labelId)?.ref ??
		null
	);
}

export async function getLabelByRef(spaceId: string, labelRef: string) {
	const labels = await fetchSpaceLabels(spaceId);
	return (
		flattenLabelsWithRefs(labels).find((label) => label.ref === labelRef) ??
		null
	);
}

export function getLabelRefsFromAssignments(
	labels: LabelListItem[],
	assignments: LabelAssignmentRecord[],
) {
	const refsById = new Map(
		flattenLabelsWithRefs(labels).map((label) => [label.id, label.ref]),
	);
	return assignments
		.map((assignment) => refsById.get(assignment.labelId))
		.filter((ref): ref is string => Boolean(ref));
}

export function getLabelIdsByRefs(labels: LabelListItem[], refs: string[]) {
	const idsByRef = new Map(
		flattenLabelsWithRefs(labels).map((label) => [label.ref, label.id]),
	);
	return refs
		.map((ref) => idsByRef.get(ref))
		.filter((id): id is string => Boolean(id));
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

export async function createSpaceLabel(spaceId: string, labelRef: string) {
	const result = await sdk.space(spaceId).labels.create(labelRef);
	await fetchSpaceLabelsFresh(spaceId);
	return result.labels[0] ?? null;
}

export async function deleteSpaceLabel(spaceId: string, labelRef: string) {
	const label = await getLabelByRef(spaceId, labelRef);
	await sdk.space(spaceId).labels.delete(labelRef);
	const labels = await fetchSpaceLabelsFresh(spaceId);
	if (label)
		await labelItemsRepo
			.deleteFirstPage(spaceId, label.id)
			.catch(() => undefined);
	return labels;
}

export async function getCachedResourceLabelsSnapshot(
	spaceId: string,
	resourceType: LabelResourceType,
	resourceRef: string,
) {
	return resourceLabelsRepo.get(spaceId, resourceType, resourceRef);
}

export async function getResourceLabels(
	spaceId: string,
	resourceType: LabelResourceType,
	resourceRef: string,
) {
	const result = await sdk
		.space(spaceId)
		.labels.getResourceLabels(resourceType, resourceRef);
	await Promise.all([
		labelTreeRepo.set(spaceId, result.labels, { source: "network" }),
		resourceLabelsRepo.set(spaceId, resourceType, resourceRef, result, {
			source: "network",
		}),
	]);
	return result;
}

export async function fetchResourceLabelsFresh(
	spaceId: string,
	resourceType: LabelResourceType,
	resourceRef: string,
) {
	return getResourceLabels(spaceId, resourceType, resourceRef);
}

export async function fetchResourceLabels(
	spaceId: string,
	resourceType: LabelResourceType,
	resourceRef: string,
	force = false,
) {
	if (!force) {
		const cached = await getCachedResourceLabelsSnapshot(
			spaceId,
			resourceType,
			resourceRef,
		);
		if (cached && !cached.stale) {
			return {
				labels: cached.labels,
				assignments: cached.assignments,
				fromCache: true,
			} as const;
		}
	}
	return getResourceLabels(spaceId, resourceType, resourceRef).then(
		(result) => ({ ...result, fromCache: false }) as const,
	);
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
	labelRef?: string,
) {
	const ref = labelRef ?? (await getLabelRefById(spaceId, labelId));
	if (!ref)
		return { items: [], pageInfo: { hasMore: false, nextCursor: null } };
	const snapshot = await labelItemsRepo.refreshFirstPage(
		spaceId,
		labelId,
		async () => {
			const result = await sdk.space(spaceId).labels.listItems(ref, {
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

export async function setResourceLabels(
	spaceId: string,
	resourceType: LabelResourceType,
	resourceRef: string,
	labelRefs: string[],
	options?: { previousLabelRefs?: string[] },
): Promise<{ labels: LabelListItem[]; assignments: LabelAssignmentRecord[] }> {
	const previousLabelRefs =
		options?.previousLabelRefs ??
		(await getResourceLabels(spaceId, resourceType, resourceRef)
			.then((result) =>
				getLabelRefsFromAssignments(result.labels, result.assignments),
			)
			.catch(() => undefined));
	const result = await sdk
		.space(spaceId)
		.labels.setResourceLabels(resourceType, resourceRef, labelRefs);
	await Promise.all([
		labelTreeRepo.set(spaceId, result.labels, { source: "network" }),
		resourceLabelsRepo.set(spaceId, resourceType, resourceRef, result, {
			source: "network",
		}),
	]);

	const affectedRefs = previousLabelRefs
		? Array.from(new Set([...previousLabelRefs, ...labelRefs]))
		: labelRefs;
	const affectedLabelIds = getLabelIdsByRefs(result.labels, affectedRefs);
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
					labelRefs,
					affectedLabelIds,
				},
			}),
		);
	}
	return result;
}

export { LABEL_ITEMS_PAGE_SIZE };
