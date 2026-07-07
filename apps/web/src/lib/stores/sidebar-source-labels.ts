import type {
	LabelAssignmentListItem,
	LabelListItem,
	SessionRecord,
} from "@neta-art/cohub";
import { buildSpaceSessionRoute } from "$lib/space-routes";

export const ALL_CHATS_LABEL_ID = "__all_chats__";
export const SESSION_SOURCE_LABEL_SYSTEM_KEY_PREFIX = "session-source:";
export const WEB_APP_SOURCE_LABEL_SYSTEM_KEY = `${SESSION_SOURCE_LABEL_SYSTEM_KEY_PREFIX}web`;

export function isWebAppSourceLabel(label: LabelListItem) {
	return (
		label.systemKey === WEB_APP_SOURCE_LABEL_SYSTEM_KEY ||
		label.name === "Web App"
	);
}

export function compareSourceLabels(a: LabelListItem, b: LabelListItem) {
	const aWeb = isWebAppSourceLabel(a);
	const bWeb = isWebAppSourceLabel(b);
	if (aWeb !== bWeb) return aWeb ? -1 : 1;
	if (a.rank !== b.rank) return a.rank - b.rank;
	return a.name.localeCompare(b.name);
}

export function findSourceRootLabel(labels: LabelListItem[]) {
	return (
		labels.find(
			(label) =>
				label.source === "system" &&
				label.parentId === null &&
				label.name.toLowerCase() === "source",
		) ?? null
	);
}

export function getSourceLabels(labels: LabelListItem[]) {
	return (findSourceRootLabel(labels)?.children ?? [])
		.slice()
		.sort(compareSourceLabels);
}

export function getDisplayLabels(labels: LabelListItem[]) {
	const sourceRootId = findSourceRootLabel(labels)?.id ?? null;
	return labels.flatMap((label) => (label.id === sourceRootId ? [] : [label]));
}

export function findWebAppSourceLabel(labels: LabelListItem[]) {
	return (
		getSourceLabels(labels).find((label) => isWebAppSourceLabel(label)) ?? null
	);
}

export function findDefaultExpandedLabelId(labels: LabelListItem[]) {
	const sourceLabels = getSourceLabels(labels);
	return (
		sourceLabels.find((label) => isWebAppSourceLabel(label))?.id ??
		sourceLabels[0]?.id ??
		ALL_CHATS_LABEL_ID
	);
}

export function isWebSessionSource(session: SessionRecord) {
	const source =
		session.source
			?.trim()
			.toLowerCase()
			.replace(/[\s-]+/g, "_") ?? "web";
	return source === "web" || source === "web_app";
}

export function buildOptimisticWebAppLabelSessionItem(input: {
	spaceId: string;
	labelId: string;
	session: SessionRecord;
}): LabelAssignmentListItem {
	const { spaceId, labelId, session } = input;
	const now = new Date().toISOString();
	return {
		id: `optimistic:${labelId}:${session.id}`,
		labelId,
		scopeType: "space",
		scopeId: spaceId,
		resourceType: "session",
		resourceRef: session.id,
		rank: null,
		source: "system",
		createdBy: null,
		meta: null,
		createdAt: session.createdAt ?? now,
		updatedAt: session.updatedAt ?? now,
		href: buildSpaceSessionRoute(spaceId, session.id),
		resource: {
			title: session.title ?? session.latestMessageText ?? "New chat",
			subtitle:
				session.lastMessageAt ?? session.updatedAt ?? session.createdAt ?? null,
			status: session.status ?? null,
		},
	};
}
