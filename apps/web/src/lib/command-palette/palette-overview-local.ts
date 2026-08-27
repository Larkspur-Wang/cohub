import type { SessionTurnRecord } from "@cohub/protocol/model";
import type {
	PaletteOverviewResponse,
	PaletteOverviewSession,
	PaletteOverviewSpace,
	SessionRecord,
	SpaceRecord,
} from "@neta-art/cohub";
import { getViewerTurnActivityBySpace } from "./personal-activity";

/**
 * Local synthesis of the palette overview payload.
 *
 * When the cached overview snapshot is stale (TTL or recent viewer activity),
 * the palette still needs a first frame that already matches the overview
 * ordering semantics — pinned first, then the viewer's own activity — instead
 * of the "all"-ordered local list, which visibly re-sorted once the server
 * response landed. Reading the same IndexedDB / localStorage caches the legacy
 * list uses, this produces an overview-shaped payload so the rendering path
 * (and its ordering) is identical before and after the refetch.
 *
 * Keep this module free of `$lib` imports so the synthesis stays testable
 * under plain node.
 */

const DEFAULT_SPACE_LIMIT = 50;
const DEFAULT_SESSION_LIMIT = 20;

export type LocalOverviewSessionList = {
	spaceId: string;
	sessions: SessionRecord[];
};

export type LocalOverviewTurns = {
	spaceId: string;
	turns: Array<Pick<SessionTurnRecord, "userUuid" | "createdAt" | "updatedAt">>;
};

function timeValue(value: string | null | undefined) {
	const time = new Date(value ?? 0).getTime();
	return Number.isFinite(time) ? time : 0;
}

function sessionActivityAt(session: SessionRecord) {
	return (
		session.lastMessageAt ?? session.updatedAt ?? session.createdAt ?? null
	);
}

function spaceUpdatedAt(space: SpaceRecord) {
	return space.lastActivityAt ?? space.updatedAt ?? space.createdAt ?? null;
}

function isViewerSession(session: SessionRecord, viewerUserUuid: string) {
	return (
		session.userUuid === viewerUserUuid ||
		(session.participantUserUuids ?? []).includes(viewerUserUuid)
	);
}

export function buildLocalPaletteOverview(input: {
	spaces: SpaceRecord[];
	sessionLists: LocalOverviewSessionList[];
	turnRecords: LocalOverviewTurns[];
	viewerUserUuid: string | null;
	spaceLimit?: number;
	sessionLimit?: number;
}): PaletteOverviewResponse {
	const spaceLimit = input.spaceLimit ?? DEFAULT_SPACE_LIMIT;
	const sessionLimit = input.sessionLimit ?? DEFAULT_SESSION_LIMIT;
	// Later entries win: callers pass fresher sources (the space list cache)
	// after per-space IndexedDB records.
	const spaceById = new Map<string, SpaceRecord>();
	for (const space of input.spaces) spaceById.set(space.id, space);

	// Server participation semantics: only turns authored by the viewer count
	// (another participant advancing a shared session is not "my" recency).
	const participationBySpace = getViewerTurnActivityBySpace(
		input.turnRecords,
		input.viewerUserUuid,
	);

	const spaces: PaletteOverviewSpace[] = [...spaceById.values()].map(
		(space) => ({
			id: space.id,
			name: space.name,
			description: space.description,
			ownerProfile: space.ownerProfile ?? null,
			spaceProfile: null,
			isPinned: space.isPinned ?? false,
			relation:
				space.userUuid && space.userUuid === input.viewerUserUuid
					? "owner"
					: "member",
			lastParticipatedAt: participationBySpace.get(space.id) ?? null,
			updatedAt: spaceUpdatedAt(space),
		}),
	);
	spaces.sort((a, b) => {
		if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
		const participationDelta =
			timeValue(b.lastParticipatedAt) - timeValue(a.lastParticipatedAt);
		if (participationDelta !== 0) return participationDelta;
		return timeValue(b.updatedAt) - timeValue(a.updatedAt);
	});

	// Recent sessions mirror the server filter: viewer as creator or
	// participant, ordered by latest activity.
	const sessionsById = new Map<string, PaletteOverviewSession>();
	if (input.viewerUserUuid) {
		for (const list of input.sessionLists) {
			const spaceName = spaceById.get(list.spaceId)?.name ?? null;
			for (const session of list.sessions) {
				if (!isViewerSession(session, input.viewerUserUuid)) continue;
				if (sessionsById.has(session.id)) continue;
				sessionsById.set(session.id, {
					id: session.id,
					spaceId: list.spaceId,
					spaceName,
					title: session.title || "Untitled session",
					viewerRelation:
						session.userUuid === input.viewerUserUuid
							? "creator"
							: "participant",
					lastMessageAt: session.lastMessageAt ?? null,
					updatedAt: sessionActivityAt(session),
				});
			}
		}
	}
	const recentSessions = [...sessionsById.values()]
		.sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt))
		.slice(0, sessionLimit);

	return {
		generatedAt: new Date().toISOString(),
		spaces: spaces.slice(0, spaceLimit),
		recentSessions,
	};
}
