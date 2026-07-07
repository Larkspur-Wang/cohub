import type { LabelAssignmentListItem, SessionRecord } from "@neta-art/cohub";

function withResource(
	item: LabelAssignmentListItem,
	resource: NonNullable<LabelAssignmentListItem["resource"]>,
	href?: string,
): LabelAssignmentListItem {
	return {
		...item,
		href: href ?? item.href,
		resource: {
			...(item.resource ?? {
				title: item.resourceRef,
				subtitle: null,
				status: null,
			}),
			...resource,
		},
	};
}

function basename(path: string) {
	const normalized = path.replace(/\/+$/, "");
	return normalized.split("/").filter(Boolean).at(-1) || normalized || path;
}

function dirname(path: string) {
	const parts = path.split("/").filter(Boolean);
	parts.pop();
	return parts.length ? `/${parts.join("/")}` : null;
}

function hydrateSessionItem(
	item: LabelAssignmentListItem,
	session: SessionRecord,
) {
	return withResource(
		item,
		{
			title:
				session.title?.trim() || item.resource?.title || "Untitled session",
			subtitle:
				session.latestMessageText?.trim() ||
				item.resource?.subtitle ||
				session.source ||
				null,
			status: session.status ?? item.resource?.status ?? null,
		},
		`/spaces/${session.spaceId}/sessions/${session.id}`,
	);
}

function hydrateFileItem(spaceId: string, item: LabelAssignmentListItem) {
	if (item.resource) return item;
	const path = item.resourceRef;
	return withResource(
		item,
		{
			title: basename(path),
			subtitle: dirname(path),
			status: null,
		},
		`/spaces/${spaceId}/files/${path.replace(/^\/+/, "")}`,
	);
}

export function hydrateLabelItems(
	spaceId: string,
	items: LabelAssignmentListItem[],
	resources: { sessions?: SessionRecord[] },
) {
	const sessionsById = new Map(
		(resources.sessions ?? []).map((session) => [session.id, session]),
	);

	return items.map((item) => {
		if (item.resourceType === "session") {
			const session = sessionsById.get(item.resourceRef);
			return session ? hydrateSessionItem(item, session) : item;
		}
		if (item.resourceType === "file") return hydrateFileItem(spaceId, item);
		return item;
	});
}

export function hydrateLabelItemsById(
	spaceId: string,
	itemsByLabelId: Record<string, LabelAssignmentListItem[]>,
	resources: { sessions?: SessionRecord[] },
) {
	return Object.fromEntries(
		Object.entries(itemsByLabelId).map(([labelId, items]) => [
			labelId,
			hydrateLabelItems(spaceId, items, resources),
		]),
	);
}
