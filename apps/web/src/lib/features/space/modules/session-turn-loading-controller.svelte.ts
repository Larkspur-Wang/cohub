import type { SessionTurnIndexItem } from "@cohub/protocol/model";
import { HttpError } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";

export function createSessionTurnLoadingController(options: {
	getSpaceId: () => string;
}) {
	let turnIndexBySessionId = $state<Record<string, SessionTurnIndexItem[]>>({});
	let turnIndexLoadingBySessionId = $state<Record<string, boolean>>({});
	let turnIndexRetryAfterBySessionId = $state<Record<string, number>>({});
	let loadingTurnSequence = $state<number | null>(null);
	const turnWindowLoadInFlight = new Map<string, Promise<void>>();

	async function loadTurnIndex(sessionId: string, force = false) {
		if (!force && Object.hasOwn(turnIndexBySessionId, sessionId)) return;
		if (turnIndexLoadingBySessionId[sessionId]) return;
		if (!force) {
			if (typeof navigator !== "undefined" && !navigator.onLine) return;
			const retryAfter = turnIndexRetryAfterBySessionId[sessionId] ?? 0;
			if (retryAfter > Date.now()) return;
		}
		turnIndexLoadingBySessionId = {
			...turnIndexLoadingBySessionId,
			[sessionId]: true,
		};
		try {
			let cursor: number | undefined;
			const collected: SessionTurnIndexItem[] = [];
			for (let page = 0; page < 20; page += 1) {
				const response = await sdk
					.space(options.getSpaceId())
					.session(sessionId)
					.turns.index({
						cursor,
						limit: 500,
					});
				collected.push(...response.turns);
				if (!response.hasMore || response.nextCursor == null) break;
				cursor = response.nextCursor;
			}
			turnIndexBySessionId = {
				...turnIndexBySessionId,
				[sessionId]: collected,
			};
			if (turnIndexRetryAfterBySessionId[sessionId]) {
				const nextRetryAfterBySessionId = { ...turnIndexRetryAfterBySessionId };
				delete nextRetryAfterBySessionId[sessionId];
				turnIndexRetryAfterBySessionId = nextRetryAfterBySessionId;
			}
		} catch (error) {
			const retryDelayMs =
				error instanceof HttpError && error.status === 401 ? 60_000 : 15_000;
			turnIndexRetryAfterBySessionId = {
				...turnIndexRetryAfterBySessionId,
				[sessionId]: Date.now() + retryDelayMs,
			};
			console.warn("[loadTurnIndex] Failed to load turn index:", error);
		} finally {
			turnIndexLoadingBySessionId = {
				...turnIndexLoadingBySessionId,
				[sessionId]: false,
			};
		}
	}

	function reset() {
		turnIndexBySessionId = {};
		turnIndexLoadingBySessionId = {};
		turnIndexRetryAfterBySessionId = {};
		loadingTurnSequence = null;
		turnWindowLoadInFlight.clear();
	}

	return {
		get turnIndexBySessionId() {
			return turnIndexBySessionId;
		},
		set turnIndexBySessionId(value: Record<string, SessionTurnIndexItem[]>) {
			turnIndexBySessionId = value;
		},
		get turnIndexLoadingBySessionId() {
			return turnIndexLoadingBySessionId;
		},
		set turnIndexLoadingBySessionId(value: Record<string, boolean>) {
			turnIndexLoadingBySessionId = value;
		},
		get turnIndexRetryAfterBySessionId() {
			return turnIndexRetryAfterBySessionId;
		},
		set turnIndexRetryAfterBySessionId(value: Record<string, number>) {
			turnIndexRetryAfterBySessionId = value;
		},
		get loadingTurnSequence() {
			return loadingTurnSequence;
		},
		set loadingTurnSequence(value: number | null) {
			loadingTurnSequence = value;
		},
		getTurnWindowInFlight(key: string) {
			return turnWindowLoadInFlight.get(key);
		},
		setTurnWindowInFlight(key: string, promise: Promise<void>) {
			turnWindowLoadInFlight.set(key, promise);
		},
		clearTurnWindowInFlight(key: string, promise: Promise<void>) {
			if (turnWindowLoadInFlight.get(key) === promise) {
				turnWindowLoadInFlight.delete(key);
			}
		},
		loadTurnIndex,
		reset,
	};
}
