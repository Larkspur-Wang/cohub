import type { SessionTurnRecord } from "@neta-art/cohub-protocol/model";

export function mergeTurnsById(
	existing: SessionTurnRecord[],
	incoming: SessionTurnRecord[],
	options?: { preferIncoming?: boolean },
) {
	const preferIncoming = options?.preferIncoming ?? true;
	const byId = new Map(existing.map((turn) => [turn.id, turn]));
	for (const turn of incoming) {
		const current = byId.get(turn.id);
		if (!current) {
			byId.set(turn.id, turn);
			continue;
		}
		byId.set(turn.id, mergeTurnRecord(current, turn, preferIncoming));
	}
	return Array.from(byId.values()).sort((a, b) => a.sequence - b.sequence);
}

function isTerminal(status: SessionTurnRecord["status"]) {
	return (
		status === "completed" ||
		status === "failed" ||
		status === "interrupted" ||
		status === "merged" ||
		status === "cancelled"
	);
}

function isOptimistic(turn: SessionTurnRecord) {
	return turn.meta?.optimistic === true;
}

function mergeAuthorIdentity(
	current: SessionTurnRecord,
	incoming: SessionTurnRecord,
): SessionTurnRecord {
	const incomingMeta = incoming.meta ?? {};
	const nextMeta = current.meta ? { ...current.meta } : {};
	let changed = false;

	if (!current.userUuid && incoming.userUuid) changed = true;
	const userId = incomingMeta.userId;
	if (userId != null && nextMeta.userId !== userId) {
		nextMeta.userId = userId;
		changed = true;
	}
	if (!current.authorProfile && incoming.authorProfile) changed = true;

	if (!changed) return current;
	return {
		...current,
		userUuid: current.userUuid ?? incoming.userUuid,
		authorProfile: current.authorProfile ?? incoming.authorProfile,
		meta: Object.keys(nextMeta).length > 0 ? nextMeta : current.meta,
	};
}

export function mergeTurnRecord(
	current: SessionTurnRecord,
	incoming: SessionTurnRecord,
	preferIncoming: boolean,
): SessionTurnRecord {
	if (isTerminal(current.status) && !isTerminal(incoming.status))
		return mergeAuthorIdentity(current, incoming);
	if (isTerminal(incoming.status) && !isTerminal(current.status))
		return incoming;
	if (isOptimistic(current) && !isOptimistic(incoming)) return incoming;
	const currentTime = Date.parse(current.updatedAt);
	const incomingTime = Date.parse(incoming.updatedAt);
	if (Number.isFinite(currentTime) && Number.isFinite(incomingTime)) {
		if (incomingTime > currentTime) return { ...current, ...incoming };
		if (currentTime > incomingTime)
			return mergeAuthorIdentity(current, incoming);
	}
	return preferIncoming
		? { ...current, ...incoming }
		: { ...incoming, ...current };
}
