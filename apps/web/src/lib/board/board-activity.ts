import type { RequestSource } from "@cohub/protocol";
import type { BoardDocument, BoardFrame } from "@neta-art/cohub/board";
import { selectionBounds } from "@neta-art/cohub/board";

export const BOARD_AUTOMATION_ACTIVITY_MS = 2_500;
const MAX_ACTIVITIES = 12;

export type BoardCollaboratorProfile = {
	userId: string;
	displayName: string;
	avatarUrl: string | null;
};

export type BoardAutomationActivity = {
	id: string;
	boardId: string;
	actorId: string;
	kind: "cli" | "agent";
	focus: BoardFrame;
	source: RequestSource;
	updatedAt: number;
};

type ActivityEvent = {
	boardId: string;
	actorId: string;
	txId: string;
	itemIds?: string[];
	source?: RequestSource | null;
	timestamp?: number;
};

function automationKind(source: RequestSource): "cli" | "agent" | null {
	if (source.toolCallId) return "agent";
	return source.via === "cli" ? "cli" : null;
}

export function createBoardAutomationActivity(
	document: BoardDocument,
	event: ActivityEvent,
): BoardAutomationActivity | null {
	if (!event.source) return null;
	const kind = automationKind(event.source);
	if (!kind) return null;
	const wanted = new Set(event.itemIds ?? []);
	const focus = selectionBounds(
		document.items
			.filter((item) => wanted.has(item.id))
			.map((item) => item.frame),
	);
	if (!focus) return null;
	const id =
		kind === "agent" && event.source.toolCallId
			? `agent:${event.boardId}:${event.source.toolCallId}`
			: `cli:${event.boardId}:${event.actorId}`;
	return {
		id,
		boardId: event.boardId,
		actorId: event.actorId,
		kind,
		focus: { ...focus, rotation: 0 },
		source: event.source,
		updatedAt: event.timestamp ?? Date.now(),
	};
}

export function mergeBoardAutomationActivity(
	activities: BoardAutomationActivity[],
	activity: BoardAutomationActivity,
): BoardAutomationActivity[] {
	return [activity, ...activities.filter((item) => item.id !== activity.id)]
		.sort((left, right) => right.updatedAt - left.updatedAt)
		.slice(0, MAX_ACTIVITIES);
}
