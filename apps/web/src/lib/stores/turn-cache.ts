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
		status === "completed" || status === "failed" || status === "interrupted"
	);
}

export function mergeTurnRecord(
	current: SessionTurnRecord,
	incoming: SessionTurnRecord,
	preferIncoming: boolean,
): SessionTurnRecord {
	if (isTerminal(current.status) && !isTerminal(incoming.status))
		return current;
	if (isTerminal(incoming.status) && !isTerminal(current.status))
		return incoming;
	const currentTime = Date.parse(current.updatedAt);
	const incomingTime = Date.parse(incoming.updatedAt);
	if (Number.isFinite(currentTime) && Number.isFinite(incomingTime)) {
		if (incomingTime > currentTime) return { ...current, ...incoming };
		if (currentTime > incomingTime) return current;
	}
	return preferIncoming
		? { ...current, ...incoming }
		: { ...incoming, ...current };
}
