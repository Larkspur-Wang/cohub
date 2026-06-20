import type { SessionTurnRecord } from "@cohub/protocol/model";

export function areSessionTurnRecordsEqual(
	current: SessionTurnRecord | null | undefined,
	next: SessionTurnRecord | null | undefined,
) {
	if (current === next) return true;
	if (!current || !next) return false;
	return JSON.stringify(current) === JSON.stringify(next);
}

export function areSessionTurnsEqual(
	currentTurns: SessionTurnRecord[],
	nextTurns: SessionTurnRecord[],
) {
	if (currentTurns.length !== nextTurns.length) return false;
	return currentTurns.every((turn, index) =>
		areSessionTurnRecordsEqual(turn, nextTurns[index]),
	);
}

export function preserveSessionTurnRefs(
	currentTurns: SessionTurnRecord[],
	nextTurns: SessionTurnRecord[],
): SessionTurnRecord[] {
	const currentById = new Map(currentTurns.map((turn) => [turn.id, turn]));
	let changed = currentTurns.length !== nextTurns.length;
	const turns = nextTurns.map((turn, index): SessionTurnRecord => {
		const current = currentById.get(turn.id);
		if (current && areSessionTurnRecordsEqual(current, turn)) {
			if (currentTurns[index] !== current) changed = true;
			return current;
		}
		if (currentTurns[index] !== turn) changed = true;
		return turn;
	});
	return changed ? turns : currentTurns;
}
