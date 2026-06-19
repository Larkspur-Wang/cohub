import type {
	LabelAssignmentListItem,
	LabelAssignmentRecord,
	LabelListItem,
	LabelResourceType,
} from "@neta-art/cohub";
import { resourceLabelsRepo } from "$lib/cache/repositories/resource-labels-repo";
import {
	getCachedLabelItemsSnapshot,
	markLabelItemsStale,
	setCachedLabelItemsFirstPage,
	setCachedSpaceLabels,
} from "$lib/stores/space-labels";

type ResourceLabelSnapshot = {
	spaceId: string;
	resourceType: LabelResourceType;
	resourceRef: string;
	labels: LabelListItem[];
	assignments: LabelAssignmentRecord[];
	items?: LabelAssignmentListItem[];
	affectedLabelIds?: string[];
};

function isLabelResourceType(value: unknown): value is LabelResourceType {
	return value === "session" || value === "checkpoint" || value === "file";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLabel(value: unknown): value is LabelListItem {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.name === "string"
	);
}

function isAssignment(value: unknown): value is LabelAssignmentRecord {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.labelId === "string" &&
		typeof value.rank === "number" &&
		isLabelResourceType(value.resourceType) &&
		typeof value.resourceRef === "string"
	);
}

function isLabelItem(value: unknown): value is LabelAssignmentListItem {
	if (!isRecord(value) || !isAssignment(value)) return false;
	return typeof (value as Record<string, unknown>).href === "string";
}

function sortLabelItems(items: LabelAssignmentListItem[]) {
	return [...items].sort((a, b) => {
		if (a.rank !== b.rank) return b.rank - a.rank;
		return (
			(b.createdAt ?? "").localeCompare(a.createdAt ?? "") ||
			b.id.localeCompare(a.id)
		);
	});
}

async function upsertCachedLabelItems(input: {
	spaceId: string;
	labelId: string;
	items: LabelAssignmentListItem[];
}) {
	const cached = await getCachedLabelItemsSnapshot(
		input.spaceId,
		input.labelId,
	);
	if (!cached) {
		await markLabelItemsStale(input.spaceId, input.labelId).catch(
			() => undefined,
		);
		return;
	}
	const byId = new Map(cached.items.map((item) => [item.id, item]));
	for (const item of input.items) byId.set(item.id, item);
	await setCachedLabelItemsFirstPage(input.spaceId, input.labelId, {
		items: sortLabelItems([...byId.values()]),
		pageInfo: cached.pageInfo,
	});
}

export async function syncResourceLabelsToCache(
	snapshot: ResourceLabelSnapshot,
) {
	await Promise.all([
		setCachedSpaceLabels(snapshot.spaceId, snapshot.labels),
		resourceLabelsRepo.set(
			snapshot.spaceId,
			snapshot.resourceType,
			snapshot.resourceRef,
			{ labels: snapshot.labels, assignments: snapshot.assignments },
			{ source: "network" },
		),
	]);
	const affectedLabelIds = Array.from(
		new Set([
			...(snapshot.affectedLabelIds ?? []),
			...snapshot.assignments.map((assignment) => assignment.labelId),
		]),
	);
	const itemsByLabelId = new Map<string, LabelAssignmentListItem[]>();
	for (const item of snapshot.items ?? []) {
		const items = itemsByLabelId.get(item.labelId) ?? [];
		items.push(item);
		itemsByLabelId.set(item.labelId, items);
	}
	await Promise.all(
		affectedLabelIds.map((labelId) => {
			const items = itemsByLabelId.get(labelId);
			return items
				? upsertCachedLabelItems({
						spaceId: snapshot.spaceId,
						labelId,
						items,
					})
				: markLabelItemsStale(snapshot.spaceId, labelId).catch(() => undefined);
		}),
	);
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent("cohub:label-assignments-updated", {
				detail: {
					spaceId: snapshot.spaceId,
					resourceType: snapshot.resourceType,
					resourceRef: snapshot.resourceRef,
					affectedLabelIds,
				},
			}),
		);
	}
}

export function parseResourceLabelRealtimePayload(input: {
	spaceId?: string | null;
	payload?: Record<string, unknown> | null;
}): ResourceLabelSnapshot | null {
	const payload = input.payload;
	const spaceId = input.spaceId?.trim();
	if (!payload) return null;
	const resourceType = payload?.resourceType;
	const resourceRef =
		typeof payload?.resourceRef === "string" ? payload.resourceRef.trim() : "";
	if (!spaceId || !isLabelResourceType(resourceType) || !resourceRef)
		return null;
	if (!Array.isArray(payload.labels) || !Array.isArray(payload.assignments)) {
		return null;
	}
	const labels = payload.labels.filter(isLabel);
	const assignments = payload.assignments.filter(isAssignment);
	if (
		labels.length !== payload.labels.length ||
		assignments.length !== payload.assignments.length
	) {
		return null;
	}
	const rawItems = payload.items;
	let items: LabelAssignmentListItem[] | undefined;
	if (Array.isArray(rawItems)) {
		items = rawItems.filter(isLabelItem);
		if (items.length !== rawItems.length) return null;
	}
	return {
		spaceId,
		resourceType,
		resourceRef,
		labels,
		assignments,
		items,
		affectedLabelIds: Array.isArray(payload.affectedLabelIds)
			? payload.affectedLabelIds.filter(
					(value): value is string =>
						typeof value === "string" && Boolean(value),
				)
			: undefined,
	};
}
