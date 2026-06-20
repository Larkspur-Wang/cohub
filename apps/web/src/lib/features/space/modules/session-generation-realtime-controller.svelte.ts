import type { GenerationStreamEvent } from "@neta-art/cohub";
import { tick } from "svelte";
import { sessionTurnsRepo } from "$lib/cache/repositories/session-turns-repo";
import { sdk } from "$lib/sdk";
import { sessionGenerationStore } from "$lib/stores/session-generation.svelte";
import {
	applyGenerationStreamEvent,
	applyGenerationStreamSnapshot,
} from "$lib/stores/session-generation-realtime";
import { SessionRecoveryCoordinator } from "$lib/stores/session-recovery-coordinator";
import { areSessionTurnsEqual, preserveSessionTurnRefs } from "./session-utils";
import type { SessionViewState } from "./session-workspace-controller.svelte";

type SessionScrollAnchor = {
	sequence: number;
	offset: number;
	updatedAt: number;
};

type ConnectionState =
	| "idle"
	| "connecting"
	| "reconnecting"
	| "open"
	| "closed"
	| "error";

const POST_SEND_RECOVERY_GRACE_MS = 2500;
const STREAM_SNAPSHOT_RECOVERY_COOLDOWN_MS = 15000;

export function createSessionGenerationRealtimeController(options: {
	getSpaceId: () => string;
	getConnectionState: () => ConnectionState;
	getActiveSessionId: () => string | null;
	getSessionState: (id: string) => SessionViewState | undefined;
	updateSessionState: (id: string, state: SessionViewState) => void;
	refreshSessionsList: (force?: boolean) => Promise<void>;
	requestBottomFollow: (options?: { immediate?: boolean }) => void;
	shouldAutoFollow: () => boolean;
	getListEl: () => HTMLElement | null | undefined;
	captureCurrentScrollAnchor: (sessionId: string) => void;
	getSessionScrollAnchor: (
		sessionId: string,
	) => SessionScrollAnchor | null | undefined;
	areSessionScrollAnchorsEqual: (
		current: SessionScrollAnchor | null | undefined,
		snapshot: SessionScrollAnchor | null | undefined,
	) => boolean;
	restoreSessionScrollAnchorSoon: (sessionId: string) => void;
	isUserScrollActive: () => boolean;
	syncGenerationStateFromTail: (
		sessionId: string,
		turns: SessionViewState["turns"],
		requestStartedAt: number,
	) => Promise<void>;
	onRecovered: () => void;
	onExhausted: (sessionId: string) => void;
}) {
	const streamSnapshotRecoveryInFlight = new Map<string, Promise<boolean>>();
	const reconcileSessionTailInFlight = new Map<string, Promise<void>>();
	const postSendRecoveryTimers = new Map<
		string,
		ReturnType<typeof setTimeout>
	>();
	const lastStreamSnapshotRecoveryByTurn = new Map<string, number>();

	async function restoreSessionStreamSnapshot(
		sessionId: string,
		input?: { turnId?: string | null; force?: boolean },
	) {
		const turnId = input?.turnId ?? null;
		const cooldownKey = turnId ? `${sessionId}:${turnId}` : sessionId;
		const now = Date.now();
		const lastRecoveryAt =
			lastStreamSnapshotRecoveryByTurn.get(cooldownKey) ?? 0;
		if (
			!input?.force &&
			now - lastRecoveryAt < STREAM_SNAPSHOT_RECOVERY_COOLDOWN_MS
		) {
			return false;
		}
		const inFlight = streamSnapshotRecoveryInFlight.get(sessionId);
		if (inFlight) return inFlight;
		lastStreamSnapshotRecoveryByTurn.set(cooldownKey, now);
		const run = (async () => {
			try {
				const { snapshot } = await sdk
					.space(options.getSpaceId())
					.session(sessionId)
					.turns.streamSnapshot();
				if (!snapshot) return false;
				const current = sessionGenerationStore.get(sessionId);
				if (
					current?.turnId &&
					snapshot.turnId &&
					current.turnId !== snapshot.turnId
				) {
					return false;
				}
				const result = applyGenerationStreamSnapshot(sessionId, {
					spaceId: snapshot.spaceId,
					turnId: snapshot.turnId,
					seq: snapshot.seq,
					anchorUserMessageId: snapshot.anchorUserMessageId,
					current: snapshot.current,
					intermediateMessages: snapshot.intermediateMessages,
					lifecycle: snapshot.lifecycle ?? null,
				});
				return result.applied;
			} catch (error) {
				console.warn(
					"[restoreSessionStreamSnapshot] Failed to restore stream snapshot:",
					error,
				);
				return false;
			}
		})();
		streamSnapshotRecoveryInFlight.set(sessionId, run);
		return run.finally(() => {
			if (streamSnapshotRecoveryInFlight.get(sessionId) === run) {
				streamSnapshotRecoveryInFlight.delete(sessionId);
			}
		});
	}

	async function reconcileSessionTail(sessionId: string) {
		const state = options.getSessionState(sessionId);
		if (!state?.session) return;
		const inFlight = reconcileSessionTailInFlight.get(sessionId);
		if (inFlight) return inFlight;
		const shouldRestoreAnchor =
			options.getActiveSessionId() === sessionId &&
			Boolean(options.getListEl()) &&
			!options.shouldAutoFollow();
		if (shouldRestoreAnchor) options.captureCurrentScrollAnchor(sessionId);
		const restoreAnchorSnapshot = shouldRestoreAnchor
			? options.getSessionScrollAnchor(sessionId)
			: null;
		const run = (async () => {
			try {
				const requestStartedAt = Date.now();
				const response = await sdk
					.space(options.getSpaceId())
					.session(sessionId)
					.turns.listPaginated({
						limit: 30,
					});
				await options.syncGenerationStateFromTail(
					sessionId,
					response.turns,
					requestStartedAt,
				);
				const snapshot = await sessionTurnsRepo.replaceTail(
					options.getSpaceId(),
					sessionId,
					{
						session: response.session,
						turns: response.turns,
						hasMore: response.hasMore,
					},
				);
				const currentState = options.getSessionState(sessionId);
				if (!currentState) return;
				const nextSession = snapshot.session ?? currentState.session;
				const nextTurns = preserveSessionTurnRefs(
					currentState.turns,
					snapshot.turns,
				);
				const nextOldestCursor = snapshot.oldestSequence ?? undefined;
				if (
					currentState.session === nextSession &&
					areSessionTurnsEqual(currentState.turns, nextTurns) &&
					currentState.hasMore === snapshot.hasMoreOlder &&
					currentState.hasMoreNewer === snapshot.hasMoreNewer &&
					currentState.loading === false &&
					currentState.loaded === true &&
					currentState.error === "" &&
					currentState.loadingOlder === false &&
					currentState.loadingNewer === false &&
					currentState.oldestCursor === nextOldestCursor
				) {
					return;
				}
				options.updateSessionState(sessionId, {
					...currentState,
					session: nextSession,
					turns: nextTurns,
					hasMore: snapshot.hasMoreOlder,
					hasMoreNewer: snapshot.hasMoreNewer,
					loading: false,
					loaded: true,
					error: "",
					loadingOlder: false,
					loadingNewer: false,
					oldestCursor: nextOldestCursor,
				});
				if (options.getActiveSessionId() === sessionId) {
					await tick();
					const currentAnchor = options.getSessionScrollAnchor(sessionId);
					const canRestoreAnchor =
						shouldRestoreAnchor &&
						options.areSessionScrollAnchorsEqual(
							currentAnchor,
							restoreAnchorSnapshot,
						) &&
						!options.isUserScrollActive();
					if (canRestoreAnchor) {
						options.restoreSessionScrollAnchorSoon(sessionId);
					} else if (!shouldRestoreAnchor && options.shouldAutoFollow()) {
						options.requestBottomFollow({ immediate: true });
					}
				}
			} catch (error) {
				console.warn(
					"[reconcileSessionTail] Failed to reconcile session tail:",
					error,
				);
			}
		})();
		reconcileSessionTailInFlight.set(sessionId, run);
		return run.finally(() => {
			if (reconcileSessionTailInFlight.get(sessionId) === run) {
				reconcileSessionTailInFlight.delete(sessionId);
			}
		});
	}

	function clearPostSendRecovery(sessionId: string | null | undefined) {
		if (!sessionId) return;
		const timer = postSendRecoveryTimers.get(sessionId);
		if (!timer) return;
		clearTimeout(timer);
		postSendRecoveryTimers.delete(sessionId);
	}

	function clearAllPostSendRecovery() {
		for (const timer of postSendRecoveryTimers.values()) clearTimeout(timer);
		postSendRecoveryTimers.clear();
	}

	const recoveryCoordinator = new SessionRecoveryCoordinator({
		isTransportOpen: () => options.getConnectionState() === "open",
		reconcileSessionTail: (sessionId) => reconcileSessionTail(sessionId),
		refreshSessionsList: () => options.refreshSessionsList(true),
		onRecovered: () => {
			options.onRecovered();
			clearPostSendRecovery(options.getActiveSessionId());
		},
		onExhausted: options.onExhausted,
	});

	function schedulePostSendRecoveryCheck(sessionId: string) {
		clearPostSendRecovery(sessionId);
		if (options.getConnectionState() === "open") return;
		const timer = setTimeout(() => {
			postSendRecoveryTimers.delete(sessionId);
			if (
				options.getConnectionState() === "open" ||
				!sessionGenerationStore.isGenerating(sessionId)
			) {
				return;
			}
			void recoveryCoordinator
				.reconcileAfterSendWhileOffline(sessionId)
				.catch(() => undefined);
			recoveryCoordinator.scheduleFallbackSync(sessionId);
		}, POST_SEND_RECOVERY_GRACE_MS);
		postSendRecoveryTimers.set(sessionId, timer);
	}

	async function handleGenerationStreamEvent(
		sessionId: string,
		event: GenerationStreamEvent,
	) {
		try {
			const generationEffect = applyGenerationStreamEvent(sessionId, event);
			if (!generationEffect.handled) return;
			clearPostSendRecovery(sessionId);
			if (generationEffect.shouldRestoreSnapshot) {
				void restoreSessionStreamSnapshot(sessionId, {
					turnId:
						"state" in event && event.state.turnId ? event.state.turnId : null,
				});
			}
			if (
				generationEffect.shouldReconcile &&
				sessionId === options.getActiveSessionId()
			) {
				void reconcileSessionTail(sessionId);
			}
			if (generationEffect.shouldRefreshSessions) {
				void options.refreshSessionsList(true);
			}
			if (
				generationEffect.shouldScroll &&
				sessionId === options.getActiveSessionId() &&
				options.shouldAutoFollow()
			) {
				await tick();
				options.requestBottomFollow();
			}
		} catch (error) {
			console.error("[WS] handleGenerationStreamEvent error:", error);
		}
	}

	function clearStreamSnapshotRecoveryCooldowns() {
		lastStreamSnapshotRecoveryByTurn.clear();
	}

	function dispose() {
		clearAllPostSendRecovery();
		recoveryCoordinator.dispose();
		lastStreamSnapshotRecoveryByTurn.clear();
	}

	return {
		restoreSessionStreamSnapshot,
		reconcileSessionTail,
		clearPostSendRecovery,
		clearAllPostSendRecovery,
		schedulePostSendRecoveryCheck,
		handleGenerationStreamEvent,
		clearStreamSnapshotRecoveryCooldowns,
		reconcileAfterReconnect: (sessionId: string | null) =>
			recoveryCoordinator.reconcileAfterReconnect(sessionId),
		onTransportOpen: () => recoveryCoordinator.onTransportOpen(),
		dispose,
	};
}
