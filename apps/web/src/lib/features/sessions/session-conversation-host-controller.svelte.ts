import type { ContentBlock } from "@cohub/protocol/core";
import type { SessionTurnRecord } from "@cohub/protocol/model";
import {
	extractBillingPayload,
	HttpError,
	type SessionRecord,
	type UserSessionListItem,
} from "@neta-art/cohub";
import { classifyAccessError } from "$lib/access/access-state";
import { sessionTurnsRepo } from "$lib/cache/repositories/session-turns-repo";
import type { ComposerAttachment } from "$lib/composer-attachments";
import {
	createSessionWorkspaceController,
	type SessionViewState,
} from "$lib/features/space/modules/session-workspace-controller.svelte";
import { extractSpaceMentionsFromText } from "$lib/mentions/space";
import { sdk } from "$lib/sdk";
import { buildTurnTimelineItems } from "$lib/session-turn-render";
import { authStore } from "$lib/stores/auth.svelte";
import { billingConversion } from "$lib/stores/billing-conversion.svelte";
import {
	readSessionComposerDraftText,
	removeSessionComposerDraftText,
	sessionComposerDraftKey,
	writeSessionComposerDraftText,
} from "$lib/stores/session-composer-drafts";
import { sessionGenerationStore } from "$lib/stores/session-generation.svelte";
import {
	failGeneration,
	interruptGeneration,
	replaceGenerationTurnId,
	startGenerationRequest,
} from "$lib/stores/session-generation-controller";
import { applyGenerationStreamEvent } from "$lib/stores/session-generation-realtime";
import { unreadTracker } from "$lib/stores/session-state.svelte";
import { mergeTurnsById } from "$lib/stores/turn-cache";

function emptySessionState(session?: SessionRecord | null): SessionViewState {
	return {
		session: session ?? undefined,
		turns: [],
		loading: true,
		loaded: false,
		error: null,
		hasMore: true,
		hasMoreNewer: false,
		loadingOlder: false,
		loadingNewer: false,
		oldestCursor: undefined,
	};
}

function draftKey(spaceId: string, sessionId: string) {
	return sessionComposerDraftKey(spaceId, {
		kind: "session",
		sessionId,
	});
}

export function createSessionConversationHostController(options: {
	onSessionUpdated?: (session: UserSessionListItem) => void;
}) {
	const workspace = createSessionWorkspaceController();
	let activeSpaceId = $state<string | null>(null);
	let input = $state("");
	let sending = $state(false);
	let aborting = $state(false);
	let attachments = $state<ComposerAttachment[]>([]);
	let composerNotice = $state("");
	let listEl = $state<HTMLDivElement | null>(null);
	let shouldAutoFollow = $state(true);
	let generationCleanup: (() => void) | null = null;
	let activeGenerationKey = "";

	const activeSessionId = $derived(workspace.activeSessionId);
	const activeState = $derived(
		activeSessionId ? workspace.sessionStateById[activeSessionId] : null,
	);

	const streaming = $derived.by(() => {
		if (!activeSessionId) return null;
		const generation = sessionGenerationStore.get(activeSessionId);
		if (!generation) return null;
		if (generation.status !== "pending" && generation.status !== "streaming") {
			return null;
		}
		return {
			sessionId: activeSessionId,
			turnId: generation.turnId,
			contentBlocks: generation.contentBlocks ?? [],
			intermediateMessages: generation.intermediateMessages as never,
			status: generation.status,
			runtimePhase: generation.runtimePhase ?? null,
			runtimeProvider: generation.runtimeProvider ?? null,
			runtimeModel: generation.runtimeModel ?? null,
		};
	});

	const timeline = $derived(
		buildTurnTimelineItems({
			sessionId: activeSessionId,
			turns: activeState?.turns ?? [],
			streaming,
		}),
	);

	const activeSessionIsRunning = $derived.by(() => {
		if (!activeSessionId) return false;
		const generation = sessionGenerationStore.get(activeSessionId);
		return (
			generation?.status === "pending" || generation?.status === "streaming"
		);
	});

	const hasUnread = $derived.by(() => {
		const session = activeState?.session;
		if (!session) return false;
		return unreadTracker.isUnread(session, session.lastMessageId);
	});

	function setDraftForSession(
		spaceId: string | null,
		sessionId: string | null,
	) {
		if (!spaceId || !sessionId) {
			input = "";
			return;
		}
		input = readSessionComposerDraftText(draftKey(spaceId, sessionId)) ?? "";
	}

	function persistDraft(
		spaceId: string | null,
		sessionId: string | null,
		value: string,
	) {
		if (!spaceId || !sessionId) return;
		const key = draftKey(spaceId, sessionId);
		if (!value.trim()) {
			removeSessionComposerDraftText(key);
			return;
		}
		writeSessionComposerDraftText(key, value);
	}

	function detachGeneration() {
		generationCleanup?.();
		generationCleanup = null;
		activeGenerationKey = "";
	}

	function attachGeneration(spaceId: string, sessionId: string) {
		const key = `${spaceId}:${sessionId}`;
		if (activeGenerationKey === key) return;
		detachGeneration();
		activeGenerationKey = key;
		try {
			generationCleanup = sdk
				.space(spaceId)
				.session(sessionId)
				.subscribeGeneration(
					{
						event: (event) => {
							if (activeGenerationKey !== key) return;
							applyGenerationStreamEvent(sessionId, event);
							if (workspace.activeSessionId !== sessionId) return;
							if (!shouldAutoFollow || !listEl) return;
							requestAnimationFrame(() => {
								if (listEl) listEl.scrollTop = listEl.scrollHeight;
							});
						},
						error: (error) => {
							console.warn("[sessions] generation stream error", error);
						},
					},
					{ recover: true },
				);
		} catch (error) {
			console.warn("[sessions] failed to subscribe generation", error);
		}
	}

	async function loadSession(
		spaceId: string,
		sessionId: string,
		seed?: SessionRecord | null,
	) {
		// Dedupe concurrent opens of the same session (route effect + list refresh).
		return workspace.runSessionLoad(sessionId, async () => {
			workspace.prepareRouteSession(sessionId);
			if (seed) workspace.upsertSessionRecord(seed);

			const existing = workspace.sessionStateById[sessionId];
			// Empty sessions are valid; do not re-fetch solely because turns.length === 0.
			if (existing?.loaded) {
				attachGeneration(spaceId, sessionId);
				unreadTracker.markViewed(sessionId, existing.session?.lastMessageId);
				return;
			}

			workspace.patchSessionState(sessionId, (current) => ({
				...(current ?? emptySessionState(seed)),
				loading: true,
				error: null,
			}));

			try {
				const cached = await sessionTurnsRepo
					.getCached(spaceId, sessionId)
					.catch(() => null);
				if (
					workspace.activeSessionId !== sessionId ||
					activeSpaceId !== spaceId
				) {
					return;
				}
				if (cached && (cached.turns.length > 0 || cached.session)) {
					workspace.setSessionState(sessionId, {
						session: cached.session ?? seed ?? existing?.session,
						turns: cached.turns,
						loading: true,
						loaded: true,
						error: null,
						hasMore: cached.hasMoreOlder,
						hasMoreNewer: cached.hasMoreNewer,
						loadingOlder: false,
						loadingNewer: false,
						oldestCursor: cached.oldestSequence ?? undefined,
					});
				}

				const response = await sdk
					.space(spaceId)
					.session(sessionId)
					.turns.listPaginated({ limit: 30 });

				if (
					workspace.activeSessionId !== sessionId ||
					activeSpaceId !== spaceId
				) {
					return;
				}

				const snapshot = await sessionTurnsRepo.replaceTail(
					spaceId,
					sessionId,
					{
						session: response.session,
						turns: response.turns,
						hasMore: response.hasMore,
					},
				);

				workspace.upsertSessionRecord(response.session);
				workspace.setSessionState(sessionId, {
					session: snapshot.session ?? response.session,
					turns: snapshot.turns,
					loading: false,
					loaded: true,
					error: null,
					hasMore: snapshot.hasMoreOlder,
					hasMoreNewer: snapshot.hasMoreNewer,
					loadingOlder: false,
					loadingNewer: false,
					oldestCursor: snapshot.oldestSequence ?? undefined,
				});
				options.onSessionUpdated?.(response.session as UserSessionListItem);
				unreadTracker.markViewed(sessionId, response.session.lastMessageId);
				attachGeneration(spaceId, sessionId);
				requestAnimationFrame(() => {
					if (listEl) listEl.scrollTop = listEl.scrollHeight;
				});
			} catch (error) {
				if (
					workspace.activeSessionId !== sessionId ||
					activeSpaceId !== spaceId
				) {
					return;
				}
				workspace.patchSessionState(sessionId, (current) => ({
					...(current ?? emptySessionState(seed)),
					loading: false,
					loaded: Boolean(current?.loaded),
					error: classifyAccessError(error, {
						isAuthenticated: authStore.isAuthenticated,
						resource: "session",
					}),
				}));
			}
		});
	}

	async function openSession(inputSession: {
		spaceId: string;
		sessionId: string;
		session?: SessionRecord | null;
	}) {
		const { spaceId, sessionId, session } = inputSession;
		if (!spaceId || !sessionId) return;

		const existingState = workspace.sessionStateById[sessionId];
		const alreadyActive =
			activeSpaceId === spaceId && workspace.activeSessionId === sessionId;

		// Already showing this session — skip reload unless we never finished loading.
		if (alreadyActive && (existingState?.loaded || existingState?.loading)) {
			setDraftForSession(spaceId, sessionId);
			return;
		}

		if (workspace.activeSessionId && workspace.activeSessionId !== sessionId) {
			persistDraft(activeSpaceId, workspace.activeSessionId, input);
		}

		activeSpaceId = spaceId;
		setDraftForSession(spaceId, sessionId);
		attachments = [];
		composerNotice = "";
		shouldAutoFollow = true;
		await loadSession(spaceId, sessionId, session ?? null);
	}

	function clearSession() {
		if (workspace.activeSessionId) {
			persistDraft(activeSpaceId, workspace.activeSessionId, input);
		}
		detachGeneration();
		activeSpaceId = null;
		workspace.activeSessionId = null;
		input = "";
		attachments = [];
		composerNotice = "";
	}

	async function loadOlderTurns() {
		const sessionId = workspace.activeSessionId;
		const spaceId = activeSpaceId;
		const state = sessionId ? workspace.sessionStateById[sessionId] : null;
		if (!sessionId || !spaceId || !state?.hasMore || state.loadingOlder) return;

		workspace.patchSessionState(sessionId, (current) => ({
			...(current ?? emptySessionState()),
			loadingOlder: true,
		}));

		try {
			const response = await sdk
				.space(spaceId)
				.session(sessionId)
				.turns.listPaginated({
					limit: 30,
					cursor: state.oldestCursor,
					direction: "older",
				});
			if (workspace.activeSessionId !== sessionId) return;

			const merged = mergeTurnsById(state.turns, response.turns);
			workspace.setSessionState(sessionId, {
				...state,
				session: response.session ?? state.session,
				turns: merged,
				hasMore: response.hasMore,
				loadingOlder: false,
				oldestCursor: merged[0]?.sequence,
			});
			void sessionTurnsRepo
				.replaceTail(spaceId, sessionId, {
					session: response.session ?? state.session ?? null,
					turns: merged,
					hasMore: response.hasMore,
				})
				.catch(() => undefined);
		} catch (error) {
			console.warn("[sessions] failed to load older turns", error);
			workspace.patchSessionState(sessionId, (current) => ({
				...(current ?? emptySessionState()),
				loadingOlder: false,
			}));
		}
	}

	async function handleSend() {
		const sessionId = workspace.activeSessionId;
		const spaceId = activeSpaceId;
		const state = sessionId ? workspace.sessionStateById[sessionId] : null;
		if (!sessionId || !spaceId || !state?.session || sending) return;

		const userText = input.trim();
		if (!userText) return;

		const mentions = extractSpaceMentionsFromText(userText);
		const content: ContentBlock[] = [
			{
				type: "text",
				text: userText,
				_meta: mentions.length > 0 ? { mentions } : undefined,
			},
		];

		sending = true;
		composerNotice = "";
		const optimisticTurnId = crypto.randomUUID();
		const clientMessageId = crypto.randomUUID();
		const now = new Date().toISOString();
		const optimisticTurn = {
			id: optimisticTurnId,
			sessionId,
			sequence: (state.turns.at(-1)?.sequence ?? 0) + 1,
			status: "running" as const,
			intent: "followup" as const,
			userText: userText || null,
			assistantText: null,
			userContent: content,
			assistantContent: null,
			provider: null,
			model: null,
			stopReason: null,
			errorMessage: null,
			finalUsage: null,
			totalUsage: null,
			summary: null,
			intermediateIndex: null,
			intermediateSummary: null,
			meta: {
				optimistic: true,
				clientMessageId,
			},
			userUuid: authStore.userUuid,
			createdAt: now,
			updatedAt: now,
			startedAt: now,
			completedAt: null,
			durationMs: null,
		} satisfies SessionTurnRecord;

		workspace.patchSessionState(sessionId, (current) => ({
			...(current ?? state),
			turns: mergeTurnsById(current?.turns ?? state.turns, [optimisticTurn]),
		}));
		input = "";
		attachments = [];
		removeSessionComposerDraftText(draftKey(spaceId, sessionId));
		shouldAutoFollow = true;
		startGenerationRequest(sessionId, {
			spaceId,
			turnId: optimisticTurnId,
		});
		requestAnimationFrame(() => {
			if (listEl) listEl.scrollTop = listEl.scrollHeight;
		});

		try {
			const sendResult = await sdk.space(spaceId).prompt({
				sessionId,
				content,
				clientMessageId,
			});
			if (sendResult.mode !== "immediate") {
				composerNotice = "Scheduled";
				return;
			}
			const turn = sendResult.turn;
			const session = sendResult.session;
			replaceGenerationTurnId(sessionId, {
				previousTurnId: optimisticTurnId,
				nextTurnId: turn.id,
			});
			workspace.upsertSessionRecord(session);
			workspace.patchSessionState(sessionId, (current) => {
				const withoutOptimistic = (current?.turns ?? []).filter(
					(item) => item.id !== optimisticTurnId,
				);
				return {
					...(current ?? state),
					session,
					turns: mergeTurnsById(withoutOptimistic, [turn]),
					loaded: true,
					loading: false,
					error: null,
				};
			});
			options.onSessionUpdated?.(session as UserSessionListItem);
			attachGeneration(spaceId, sessionId);
			const billing = extractBillingPayload(sendResult);
			if (billing) billingConversion.handleResponseBody({ billing });
		} catch (error) {
			failGeneration(
				sessionId,
				error instanceof Error ? error.message : "Failed to send",
			);
			workspace.patchSessionState(sessionId, (current) => ({
				...(current ?? state),
				turns: (current?.turns ?? []).map((turn) =>
					turn.id === optimisticTurnId
						? {
								...turn,
								status: "failed",
								errorMessage:
									error instanceof Error ? error.message : "Failed to send",
							}
						: turn,
				),
			}));
			composerNotice =
				error instanceof Error ? error.message : "Failed to send message";
			if (error instanceof HttpError && error.status === 402) {
				billingConversion.handleResponseBody(error.body);
			}
		} finally {
			sending = false;
		}
	}

	async function handleAbort() {
		const sessionId = workspace.activeSessionId;
		const spaceId = activeSpaceId;
		if (!sessionId || !spaceId || aborting) return;
		aborting = true;
		try {
			await sdk.space(spaceId).session(sessionId).abort();
			interruptGeneration(sessionId);
		} catch (error) {
			console.warn("[sessions] abort failed", error);
		} finally {
			aborting = false;
		}
	}

	function setInput(value: string) {
		input = value;
		persistDraft(activeSpaceId, workspace.activeSessionId, value);
	}

	function dispose() {
		if (workspace.activeSessionId) {
			persistDraft(activeSpaceId, workspace.activeSessionId, input);
		}
		detachGeneration();
	}

	return {
		get activeSpaceId() {
			return activeSpaceId;
		},
		get activeSessionId() {
			return activeSessionId;
		},
		get activeState() {
			return activeState;
		},
		get timeline() {
			return timeline;
		},
		get input() {
			return input;
		},
		set input(value: string) {
			setInput(value);
		},
		get sending() {
			return sending;
		},
		get aborting() {
			return aborting;
		},
		get attachments() {
			return attachments;
		},
		set attachments(value: ComposerAttachment[]) {
			attachments = value;
		},
		get composerNotice() {
			return composerNotice;
		},
		get listEl() {
			return listEl;
		},
		set listEl(value: HTMLDivElement | null) {
			listEl = value;
		},
		get shouldAutoFollow() {
			return shouldAutoFollow;
		},
		set shouldAutoFollow(value: boolean) {
			shouldAutoFollow = value;
		},
		get activeSessionIsRunning() {
			return activeSessionIsRunning;
		},
		get hasUnread() {
			return hasUnread;
		},
		openSession,
		clearSession,
		loadOlderTurns,
		handleSend,
		handleAbort,
		dispose,
	};
}
