import type { SessionTurnRecord } from "@cohub/protocol/model";
import { mergeTurnsById } from "$lib/stores/turn-cache";

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

export function getTurnClientMessageId(turn: Pick<SessionTurnRecord, "meta">) {
	const value = turn.meta?.clientMessageId;
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isOptimisticTurn(turn: Pick<SessionTurnRecord, "meta">) {
	return turn.meta?.optimistic === true;
}

export function withOptimisticMetaCleared(turn: SessionTurnRecord) {
	if (!isOptimisticTurn(turn)) return turn;
	const meta = turn.meta ? { ...turn.meta } : null;
	if (meta && "optimistic" in meta) delete meta.optimistic;
	return { ...turn, meta };
}

export function isSameClientMessageTurn(
	turn: Pick<SessionTurnRecord, "meta">,
	clientMessageId: string | null,
) {
	return Boolean(
		clientMessageId && getTurnClientMessageId(turn) === clientMessageId,
	);
}

export function reconcileOptimisticTurn(
	turns: SessionTurnRecord[],
	confirmedTurn: SessionTurnRecord,
) {
	const clientMessageId = getTurnClientMessageId(confirmedTurn);
	let remapped = false;
	const nextTurns = turns.map((turn) => {
		if (!isOptimisticTurn(turn)) return turn;
		if (!isSameClientMessageTurn(turn, clientMessageId)) return turn;
		remapped = true;
		const meta = {
			...(turn.meta ?? {}),
			...(confirmedTurn.meta ?? {}),
		};
		delete meta.optimistic;
		return {
			...withOptimisticMetaCleared(turn),
			id: confirmedTurn.id,
			sequence: confirmedTurn.sequence,
			status: confirmedTurn.status,
			userUuid: confirmedTurn.userUuid ?? turn.userUuid,
			userContent: confirmedTurn.userContent,
			userText: confirmedTurn.userText ?? turn.userText,
			provider: confirmedTurn.provider ?? turn.provider,
			model: confirmedTurn.model ?? turn.model,
			createdAt: confirmedTurn.createdAt,
			updatedAt: confirmedTurn.updatedAt,
			meta,
		};
	});
	return {
		turns: remapped
			? mergeTurnsById([], nextTurns, { preferIncoming: true })
			: turns,
		remapped,
	};
}

export function normalizeTurnDuplicates(turns: SessionTurnRecord[]) {
	const optimistic = turns.filter((turn) => turn.meta?.optimistic === true);
	const confirmed = turns.filter((turn) => turn.meta?.optimistic !== true);
	const confirmedClientMessageIds = new Set(
		confirmed
			.map(getTurnClientMessageId)
			.filter((value): value is string => Boolean(value)),
	);
	const optimisticByClientMessageId = new Map(
		optimistic
			.map((turn) => [getTurnClientMessageId(turn), turn] as const)
			.filter((entry): entry is [string, SessionTurnRecord] =>
				Boolean(entry[0]),
			),
	);
	return mergeTurnsById(
		optimistic.filter((turn) => {
			const clientMessageId = getTurnClientMessageId(turn);
			return (
				!clientMessageId || !confirmedClientMessageIds.has(clientMessageId)
			);
		}),
		confirmed.map((turn) => {
			const optimisticTurn = optimisticByClientMessageId.get(
				getTurnClientMessageId(turn) ?? "",
			);
			if (!optimisticTurn) return turn;
			return {
				...turn,
				userUuid: turn.userUuid ?? optimisticTurn.userUuid,
				authorProfile: turn.authorProfile ?? optimisticTurn.authorProfile,
			};
		}),
		{ preferIncoming: true },
	);
}
