<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import {
	type ChannelConfig,
	type DiscordChannelConfig,
	type RuntimeChannelRecord,
	type RuntimeRecord,
	type SessionRecord,
	type SessionStreamEvent,
	createRuntimeSession,
	deleteRuntime,
	extractSessionRenderState,
	getRuntime,
	getRuntimeChannels,
	getRuntimeSessions,
	getSessionMessages,
	getSessionMessagesPaginated,
	hibernateRuntime,
	postSessionMessage,
	streamSessionEvents,
	updateRuntimeChannelConfig,
	wakeRuntime,
} from "$lib/api";
import { ensureAuth } from "$lib/auth";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import SettingsOverlay from "$lib/components/SettingsOverlay.svelte";
import { getRuntimeStatusMeta } from "$lib/runtime-status";
import { type TimelineItem, toChatMessages } from "$lib/session-tree";
import { unreadTracker } from "$lib/stores/session-state.svelte";
import { messageCache } from "$lib/stores/message-cache";
import type { MessageRecord } from "@cohub/protocol";
import {
	ArrowDown,
	Hash,
	Loader2,
	Moon,
	MoreVertical,
	Plus,
	Power,
	Settings,
	Terminal,
	Trash2,
	X,
} from "lucide-svelte";
import type { ContentBlock } from "@cohub/protocol";
import { onMount, tick } from "svelte";

type Props = {
	data: {
		runtimeId: string;
	};
};

type ComposerImageAttachment = {
	id: string;
	name: string;
	mediaType: string;
	data: string;
	previewUrl: string;
	size: number;
};

const MAX_IMAGE_EDGE = 2160;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const WEBP_QUALITIES = [0.88, 0.82, 0.76, 0.7, 0.62, 0.54];

type SessionViewState = {
	session: SessionRecord;
	messages: MessageRecord[];
	loading: boolean;
	loaded: boolean;
	error: string;
	// Pagination state
	hasMore: boolean;
	loadingOlder: boolean;
	oldestCursor: number | undefined;
};

const props = $props();
const data = $derived((props as Props).data);
const runtimeId = $derived(data.runtimeId);

// Session from URL query param
const urlSessionId = $derived(page.url.searchParams.get("session"));

let runtime = $state<RuntimeRecord | null>(null);
let runtimeSessions = $state<SessionRecord[]>([]);
let runtimeChannels = $state<RuntimeChannelRecord[]>([]);
let sessionStateById = $state<Record<string, SessionViewState>>({});
let activeSessionId = $state<string | null>(null);
let input = $state("");
let imageAttachments = $state<ComposerImageAttachment[]>([]);
let sending = $state(false);
let runtimeLoadError = $state("");
let streamStatus = $state<"idle" | "streaming" | "done" | "error">("idle");
let streamError = $state("");
let streamingAssistantText = $state("");
let streamingThinking = $state("");

// Raw content blocks from the latest SSE event, used to preserve
// the correct interleaving order of text/thinking/tool_use blocks.
let streamingContentBlocks = $state<ContentBlock[]>([]);

// SSE - per-session connections
let sessionSSEs = new Map<string, AbortController>();
let sessionLastEventIds = new Map<string, string>();

// Sequential event processing queue to prevent race conditions
let eventProcessing = false;
let eventQueue: SessionStreamEvent[] = [];

// Track which session is currently streaming (for sidebar status)
let streamingSessionId: string | null = null;

// Broadcast channel for cross-tab / cross-component session updates
let broadcastChannel: BroadcastChannel | null = null;

function notifySessionsUpdate() {
	// Notify sidebar about session changes
	window.dispatchEvent(
		new CustomEvent("cohub:sessions-updated", {
			detail: { runtimeId, sessions: runtimeSessions },
		}),
	);
	broadcastChannel?.postMessage({
		type: "sessions-updated",
		runtimeId,
		sessions: JSON.parse(JSON.stringify(runtimeSessions)),
	});
}

function notifyStreamingStatus(sessionId: string | null, isStreaming: boolean) {
	window.dispatchEvent(
		new CustomEvent("cohub:streaming-status", {
			detail: { runtimeId, sessionId, isStreaming },
		}),
	);
	broadcastChannel?.postMessage({
		type: "streaming-status",
		runtimeId,
		sessionId,
		isStreaming,
	});
}

let runtimePollingTimer: ReturnType<typeof setInterval> | null = null;
const listEl = $state<HTMLDivElement | null>(null);
const contentEl = $state<HTMLDivElement | null>(null);
let savingChannelConfigById = $state<Record<string, boolean>>({});
let channelConfigErrorById = $state<Record<string, string>>({});
let loadingSessionIds = $state<Record<string, boolean>>({});
let bootstrapping = $state(true);
let didInitialScrollBySession = $state<Record<string, boolean>>({});
let shouldAutoFollow = $state(true);
let userScrolledUp = $state(false);
let autoScrollGuard = $state(false);
let creatingSession = $state(false);
let createSessionError = $state("");
let showSettings = $state(false);
let showMoreMenu = $state(false);
let showScrollToBottom = $state(false);

// Chat timeline ref for prepend scroll restoration
type ChatTimelineHandle = {
	preparePrepend: () => void;
	finalizePrepend: () => void;
};
let chatTimelineRef: ChatTimelineHandle | null = null;

// Preload tracking: debounce to avoid multiple concurrent loads
let preloadingSessionIds = new Set<string>();
const PRELOAD_THRESHOLD = 10;

// Runtime actions
let runtimeActionError = $state("");
let runtimeActionInProgress: string | null = $state(null);

async function handleHibernate() {
	if (!confirm("Hibernate this runtime? The sandbox pod will be stopped."))
		return;
	runtimeActionInProgress = "hibernate";
	runtimeActionError = "";
	try {
		await hibernateRuntime(runtimeId);
		await loadRuntime();
	} catch (error) {
		runtimeActionError =
			error instanceof Error ? error.message : "Failed to hibernate";
	} finally {
		runtimeActionInProgress = null;
	}
}

async function handleWake() {
	if (!confirm("Wake this runtime? A new sandbox pod will be provisioned."))
		return;
	runtimeActionInProgress = "wake";
	runtimeActionError = "";
	try {
		await wakeRuntime(runtimeId);
		await loadRuntime();
	} catch (error) {
		runtimeActionError =
			error instanceof Error ? error.message : "Failed to wake";
	} finally {
		runtimeActionInProgress = null;
	}
}

async function handleDelete() {
	if (!confirm("Delete this runtime permanently? This cannot be undone."))
		return;
	runtimeActionInProgress = "delete";
	runtimeActionError = "";
	try {
		await deleteRuntime(runtimeId);
		goto("/runtimes");
	} catch (error) {
		runtimeActionError =
			error instanceof Error ? error.message : "Failed to delete";
		runtimeActionInProgress = null;
	}
}

const activeSessionState = $derived(
	activeSessionId ? (sessionStateById[activeSessionId] ?? null) : null,
);

const timeline = $derived.by<TimelineItem[]>(() => {
	const state = activeSessionState;
	if (!state) return [];
	const items: TimelineItem[] = toChatMessages(state.messages).map(
		(message) => ({
			id: message.id,
			kind: "message",
			message,
		}),
	);

	// Build streaming items in the correct interleaved order.
	// Walk through raw content blocks so text → tool_use → text preserves order.
	if (streamingContentBlocks.length > 0) {
		let accText = "";
		let accThinking = "";
		const baseSequence = state.messages.at(-1)?.sequence ?? 0;

		function flushMessage() {
			const trimmedText = accText.trim();
			const trimmedThinking = accThinking.trim();
			if (!trimmedText && !trimmedThinking) return;

			const blocks: ContentBlock[] = [];
			if (trimmedThinking) blocks.push({ type: "thinking", thinking: trimmedThinking });
			if (trimmedText) blocks.push({ type: "text", text: trimmedText });

			items.push({
				id: `assistant-streaming-seg-${items.length}`,
				kind: "message",
				message: {
					id: "assistant-streaming",
					role: "assistant",
					content: blocks as never,
					text: trimmedText,
					sequence: baseSequence + 1,
				},
			});
			accText = "";
			accThinking = "";
		}

		for (const block of streamingContentBlocks) {
			if (block.type === "thinking") {
				accThinking += (accThinking ? "\n" : "") + block.thinking;
			} else if (block.type === "text") {
				accText += (accText ? "\n\n" : "") + block.text;
			} else if (block.type === "tool_use") {
				// Flush accumulated text/thinking before inserting tool card
				flushMessage();
				const meta = block._meta as
					| { toolStatus?: string; summary?: string }
					| undefined;
				items.push({
					id: `stream-tool-${block.id}`,
					kind: "tool",
					tool: {
						id: block.id,
						name: block.name,
						input: block.input ?? {},
						status:
							meta?.toolStatus === "running"
								? "running"
								: meta?.toolStatus === "done"
									? "done"
									: "failed",
						output: meta?.summary ?? "",
					},
				});
			}
		}

		// Flush remaining text/thinking after the last tool
		flushMessage();
	} else if (streamingAssistantText.trim() || streamingThinking.trim()) {
		// Fallback: when raw blocks aren't available yet, use the flat state
		const contentBlocks: Array<
			{ type: "thinking"; thinking: string } | { type: "text"; text: string }
		> = [];
		if (streamingThinking.trim()) {
			contentBlocks.push({ type: "thinking", thinking: streamingThinking });
		}
		if (streamingAssistantText.trim()) {
			contentBlocks.push({ type: "text", text: streamingAssistantText });
		}
		items.push({
			id: "assistant-streaming",
			kind: "message",
			message: {
				id: "assistant-streaming",
				role: "assistant",
				content: contentBlocks as never,
				text: streamingAssistantText,
				sequence: (state.messages.at(-1)?.sequence ?? 0) + 1,
			},
		});
	}

	return items;
});

// Sync active session with URL
$effect(() => {
	if (urlSessionId && urlSessionId !== activeSessionId) {
		activeSessionId = urlSessionId;
		shouldAutoFollow = true;
		didInitialScrollBySession = {
			...didInitialScrollBySession,
			[urlSessionId]: false,
		};
		// Mark session as viewed when navigating to it
		const state = sessionStateById[urlSessionId];
		if (state?.session?.lastMessageId) {
			unreadTracker.markViewed(urlSessionId, state.session.lastMessageId);
		}
	}
});

function updateUrlSession(sessionId: string | null) {
	const params = new URLSearchParams(page.url.searchParams);
	if (sessionId) {
		params.set("session", sessionId);
	} else {
		params.delete("session");
	}
	void goto(`/runtimes/${runtimeId}?${params.toString()}`, {
		replaceState: true,
	});
}

async function handleCreateNewSession() {
	if (creatingSession || !runtime) return;
	creatingSession = true;
	createSessionError = "";

	try {
		const result = await createRuntimeSession(runtime.id, { source: "web" });
		const newSession = result.session;

		runtimeSessions = [...runtimeSessions, newSession];
		sessionStateById = {
			...sessionStateById,
			[newSession.id]: {
				session: newSession,
				messages: [],
				loading: false,
				loaded: true,
				error: "",
				hasMore: true,
				loadingOlder: false,
				oldestCursor: undefined,
			},
		};

		activeSessionId = newSession.id;
		updateUrlSession(newSession.id);
		notifySessionsUpdate();
	} catch (error) {
		createSessionError =
			error instanceof Error ? error.message : "Failed to create session";
	} finally {
		creatingSession = false;
	}
}

function seedSessions(sessions: SessionRecord[]) {
	if (sessions.length === 0 && runtimeSessions.length > 0) return;

	runtimeSessions = sessions;
	const nextState = { ...sessionStateById };
	for (const session of sessions) {
		if (!nextState[session.id]) {
			nextState[session.id] = {
				session,
				messages: [],
				loading: false,
				loaded: false,
				error: "",
				hasMore: true,
				loadingOlder: false,
				oldestCursor: undefined,
			};
		} else {
			nextState[session.id] = {
				...nextState[session.id],
				session,
			};
		}
	}
	sessionStateById = nextState;

	// Notify sidebar about session changes
	notifySessionsUpdate();

	// Auto-select session from URL or fallback to latest
	if (urlSessionId && !sessionStateById[urlSessionId]?.loaded) {
		// Will be loaded by the effect below
	} else if (!activeSessionId && sessions.length > 0) {
		const nextId = sessions.at(-1)?.id ?? null;
		activeSessionId = nextId;
		updateUrlSession(nextId);
	}
}

function getDiscordRuntimeChannelConfig(
	runtimeChannel: RuntimeChannelRecord,
): DiscordChannelConfig {
	return (
		runtimeChannel.config ?? {
			inbound: { requireMentionInGuild: true },
			outbound: { showThinking: false, showToolCalls: false },
		}
	);
}

async function saveRuntimeChannelConfig(
	runtimeChannelId: string,
	config: ChannelConfig,
) {
	savingChannelConfigById = {
		...savingChannelConfigById,
		[runtimeChannelId]: true,
	};
	channelConfigErrorById = {
		...channelConfigErrorById,
		[runtimeChannelId]: "",
	};

	try {
		const updated = await updateRuntimeChannelConfig(runtimeChannelId, {
			config,
		});
		runtimeChannels = runtimeChannels.map((item) =>
			item.id === runtimeChannelId ? updated : item,
		);
	} catch (error) {
		channelConfigErrorById = {
			...channelConfigErrorById,
			[runtimeChannelId]:
				error instanceof Error
					? error.message
					: "Failed to update channel config",
		};
	} finally {
		savingChannelConfigById = {
			...savingChannelConfigById,
			[runtimeChannelId]: false,
		};
	}
}

function patchDiscordRuntimeChannelConfig(
	runtimeChannel: RuntimeChannelRecord,
	updater: (config: DiscordChannelConfig) => DiscordChannelConfig,
) {
	const nextConfig = updater(getDiscordRuntimeChannelConfig(runtimeChannel));
	runtimeChannels = runtimeChannels.map((item) =>
		item.id === runtimeChannel.id ? { ...item, config: nextConfig } : item,
	);
	void saveRuntimeChannelConfig(runtimeChannel.id, nextConfig);
}

async function loadRuntime() {
	if (!(await ensureAuth())) return;
	runtimeLoadError = "";

	const [runtimeResult, sessionsResult, channelsResult] =
		await Promise.allSettled([
			getRuntime(runtimeId),
			getRuntimeSessions(runtimeId),
			getRuntimeChannels(runtimeId),
		]);

	if (runtimeResult.status === "fulfilled") {
		runtime = runtimeResult.value;
	} else {
		runtimeLoadError =
			runtimeResult.reason instanceof Error
				? runtimeResult.reason.message
				: "Failed to load runtime";
	}

	if (sessionsResult.status === "fulfilled") {
		seedSessions(sessionsResult.value.sessions ?? []);
	} else if (!runtimeLoadError) {
		runtimeLoadError =
			sessionsResult.reason instanceof Error
				? sessionsResult.reason.message
				: "Failed to load runtime sessions";
	}

	if (channelsResult.status === "fulfilled") {
		runtimeChannels = channelsResult.value;
	} else if (!runtimeLoadError) {
		runtimeLoadError =
			channelsResult.reason instanceof Error
				? channelsResult.reason.message
				: "Failed to load runtime channels";
	}
}

async function loadSessionState(sessionId: string, force = false) {
	const existing = sessionStateById[sessionId];
	if (loadingSessionIds[sessionId] && !force) return;
	if (existing?.loaded && !force) return;

	// Try cache first: stale-while-revalidate
	const cached = await messageCache.get(sessionId);
	if (cached && cached.messages.length > 0 && !force) {
		sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				session: existing?.session,
				messages: cached.messages,
				loading: false,
				loaded: true,
				error: "",
				hasMore: cached.hasMore,
				loadingOlder: false,
				oldestCursor: cached.oldestSeq != null ? cached.oldestSeq + 1 : undefined,
			},
		};

		// Background sync: fetch newer messages since cache
		void syncSessionNewer(sessionId, cached);

		if (activeSessionId === sessionId) {
			void forceScrollToBottom().then(() => {
				shouldAutoFollow = true;
				didInitialScrollBySession = {
					...didInitialScrollBySession,
					[sessionId]: true,
				};
			});
		}
		return;
	}

	// No cache or force: load latest page from server
	loadingSessionIds = { ...loadingSessionIds, [sessionId]: true };
	sessionStateById = {
		...sessionStateById,
		[sessionId]: {
			session: existing?.session,
			messages: existing?.messages ?? [],
			loading: true,
			loaded: existing?.loaded ?? false,
			error: existing?.error ?? "",
			hasMore: existing?.hasMore ?? true,
			loadingOlder: false,
			oldestCursor: existing?.oldestCursor,
		},
	};

	try {
		const response = await getSessionMessagesPaginated(sessionId, {
			limit: 30,
		});

		await messageCache.set({
			sessionId,
			messages: response.messages,
			hasMore: response.hasMore,
			oldestSeq: response.messages[0]?.sequence ?? null,
			newestSeq: response.messages.at(-1)?.sequence ?? null,
			cachedAt: Date.now(),
		});
		void messageCache.evict();

		sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				session: response.session,
				messages: response.messages,
				loading: false,
				loaded: true,
				error: "",
				hasMore: response.hasMore,
				loadingOlder: false,
				oldestCursor: response.hasMore && response.messages.length > 0
					? response.messages[0].sequence
					: undefined,
			},
		};

		if (activeSessionId === sessionId) {
			void forceScrollToBottom().then(() => {
				shouldAutoFollow = true;
				didInitialScrollBySession = {
					...didInitialScrollBySession,
					[sessionId]: true,
				};
			});
		}
	} catch (error) {
		sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				session: existing?.session,
				messages: existing?.messages ?? [],
				loading: false,
				loaded: true,
				error:
					error instanceof Error ? error.message : "Failed to load session",
				hasMore: existing?.hasMore ?? true,
				loadingOlder: false,
				oldestCursor: existing?.oldestCursor,
			},
		};
	} finally {
		loadingSessionIds = { ...loadingSessionIds, [sessionId]: false };
	}
}

/** Sync newer messages since last cache (for background refresh) */
async function syncSessionNewer(
	sessionId: string,
	cached: Awaited<ReturnType<typeof messageCache.get>>,
) {
	if (!cached || cached.messages.length === 0) return;
	const lastSeq = cached.newestSeq;
	if (lastSeq == null) return;

	try {
		const response = await getSessionMessagesPaginated(sessionId, {
			cursor: lastSeq,
			direction: "newer",
			limit: 100,
		});
		if (response.messages.length > 0) {
			await messageCache.append(sessionId, response.messages);
			const state = sessionStateById[sessionId];
			if (state) {
				const existingIds = new Set(state.messages.map((m) => m.id));
				const deduped = response.messages.filter((m) => !existingIds.has(m.id));
				if (deduped.length > 0) {
					const merged = [...state.messages, ...deduped];
					merged.sort((a, b) => a.sequence - b.sequence);
					sessionStateById = {
						...sessionStateById,
						[sessionId]: {
							...state,
							messages: merged,
						},
					};
				}
			}
		}
	} catch {
		// Ignore sync errors
	}
}

/** Load older messages (scroll up pagination) */
async function loadOlderMessages(sessionId: string) {
	const state = sessionStateById[sessionId];
	if (!state || !state.hasMore || state.loadingOlder) return;

	// Prepare scroll position restoration
	chatTimelineRef?.preparePrepend();

	sessionStateById = {
		...sessionStateById,
		[sessionId]: {
			...state,
			loadingOlder: true,
		},
	};

	try {
		const response = await getSessionMessagesPaginated(sessionId, {
			cursor: state.oldestCursor,
			direction: "older",
			limit: 30,
		});

		if (response.messages.length > 0) {
			await messageCache.prepend(sessionId, response.messages, response.hasMore);

			// Deduplicate and sort to handle overlapping cursor ranges
			const existingIds = new Set(state.messages.map((m) => m.id));
			const deduped = response.messages.filter((m) => !existingIds.has(m.id));
			const merged = [...deduped, ...state.messages];
			merged.sort((a, b) => a.sequence - b.sequence);

			sessionStateById = {
				...sessionStateById,
				[sessionId]: {
					...state,
					messages: merged,
					hasMore: response.hasMore,
					loadingOlder: false,
					oldestCursor: response.hasMore && merged.length > 0
						? merged[0].sequence
						: undefined,
				},
			};

			// Restore scroll position after prepend
			await tick();
			chatTimelineRef?.finalizePrepend();
		} else {
			// No more messages
			sessionStateById = {
				...sessionStateById,
				[sessionId]: {
					...state,
					hasMore: false,
					loadingOlder: false,
				},
			};
		}
	} catch (error) {
		sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				...state,
				loadingOlder: false,
				error: error instanceof Error ? error.message : "Failed to load older messages",
			},
		};
	}
}

/** Triggered by ChatTimeline when first visible index changes */
function handleFirstVisible(index: number) {
	if (!activeSessionId) return;
	const state = sessionStateById[activeSessionId];
	if (!state || !state.hasMore || state.loadingOlder) return;

	const unseen = state.messages.length - index;
	if (unseen <= PRELOAD_THRESHOLD && !preloadingSessionIds.has(activeSessionId)) {
		const sid = activeSessionId;
		preloadingSessionIds.add(sid);
		loadOlderMessages(sid).finally(() => {
			preloadingSessionIds.delete(sid);
		});
	}
}

function shouldPollRuntime(runtime: RuntimeRecord | null) {
	if (!runtime) return true;
	const status = runtime.status;
	if (!status) return true;
	return status === "starting";
}

// ─── SSE streaming (per-session) ───

function clearStreamingState() {
	streamingAssistantText = "";
	streamingThinking = "";
	streamingContentBlocks = [];
	streamingSessionId = null;
}

// Process events sequentially to avoid race conditions
async function processEventQueue() {
	if (eventProcessing || eventQueue.length === 0) return;
	eventProcessing = true;

	while (eventQueue.length > 0) {
		const event = eventQueue.shift();
		if (!event) continue;
		const currentActiveSessionId = activeSessionId;
		if (
			currentActiveSessionId == null ||
			event.sessionId !== currentActiveSessionId
		)
			continue;

		if (event.type === "stream_update") {
			const { thinking, answer } = extractSessionRenderState(
				event.content,
			);
			streamingThinking = thinking;
			streamingAssistantText = answer;
			streamingContentBlocks = event.content;
			if (answer) {
				if (streamingSessionId !== currentActiveSessionId) {
					streamingSessionId = currentActiveSessionId;
					notifyStreamingStatus(currentActiveSessionId, true);
				}
				await tick();
				if (!userScrolledUp) scrollToBottomNow();
			}

			if (event.turnEnd) {
				// Incremental sync: only fetch new messages since last known
				const state = sessionStateById[currentActiveSessionId];
				let newMessages: MessageRecord[] = [];
				let updatedSession = state?.session;

				try {
					const lastSeq = state?.messages.at(-1)?.sequence;
					if (lastSeq != null) {
						const response = await getSessionMessagesPaginated(currentActiveSessionId, {
							cursor: lastSeq,
							direction: "newer",
							limit: 100,
						});
						newMessages = response.messages;
						updatedSession = response.session;

						// Update cache
						if (newMessages.length > 0) {
							await messageCache.append(currentActiveSessionId, newMessages);
						}
					} else {
						// Fallback: full reload if no state
						const response = await getSessionMessages(currentActiveSessionId);
						newMessages = response.messages;
						updatedSession = response.session;
					}
				} catch {
					// Ignore sync errors, keep existing messages
				}

				// Atomically replace streaming content with persisted messages.
				// Single-tick state batch ensures $derived timeline recalculates once.
				streamingAssistantText = "";
				streamingThinking = "";
				streamingContentBlocks = [];
				streamStatus = "done";
				if (streamingSessionId) {
					notifyStreamingStatus(streamingSessionId, false);
				}
				streamingSessionId = null;

				// Merge new messages with existing ones (dedup by id)
				const existingMessages = state?.messages ?? [];
				const existingIds = new Set(existingMessages.map((m) => m.id));
				const deduped = newMessages.filter((m) => !existingIds.has(m.id));
				const merged = [...existingMessages, ...deduped];

				sessionStateById = {
					...sessionStateById,
					[currentActiveSessionId]: {
						session: updatedSession ?? state?.session,
						messages: merged,
						loading: false,
						loaded: true,
						error: "",
						hasMore: state?.hasMore ?? true,
						loadingOlder: false,
						oldestCursor: state?.oldestCursor,
					},
				};

				if (!userScrolledUp) scrollToBottomNow();
			}
		}
	}

	eventProcessing = false;
	if (eventQueue.length > 0) {
		void processEventQueue();
	}
}

// Start SSE for a specific session
function connectSessionSSE(sessionId: string) {
	disconnectSessionSSE(sessionId);
	const abort = new AbortController();
	sessionSSEs.set(sessionId, abort);
	const lastEventId = sessionLastEventIds.get(sessionId);

	(async () => {
		try {
			for await (const event of streamSessionEvents(
				sessionId,
				lastEventId,
				abort.signal,
			)) {
				if (event.type === "stream_update") {
					sessionLastEventIds.set(sessionId, String(event.timestamp));
				}
				eventQueue.push(event);
				void processEventQueue();
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return;
			console.error(`[SSE] Session ${sessionId} stream error:`, error);
		} finally {
			sessionSSEs.delete(sessionId);
		}
	})();
}

// Disconnect SSE for a specific session
function disconnectSessionSSE(sessionId: string) {
	const existing = sessionSSEs.get(sessionId);
	if (existing) {
		existing.abort();
		sessionSSEs.delete(sessionId);
	}
}

// Disconnect all SSE connections
function disconnectAllSSE() {
	for (const [, ctrl] of sessionSSEs) {
		ctrl.abort();
	}
	sessionSSEs.clear();
	eventQueue = [];
	eventProcessing = false;
}

async function handleSend() {
	if (
		!activeSessionState ||
		(!input.trim() && imageAttachments.length === 0) ||
		sending ||
		!runtime
	)
		return;
	sending = true;
	streamError = "";
	streamStatus = "streaming";

	const text = input.trim();
	const attachmentBlocks: ContentBlock[] = imageAttachments.map((attachment) => ({
		type: "image",
		source: {
			type: "base64",
			media_type: attachment.mediaType,
			data: attachment.data,
		},
		_meta: {
			filename: attachment.name,
			size: attachment.size,
		},
	}));
	const content: ContentBlock[] = [
		...attachmentBlocks,
		...(text ? [{ type: "text", text } satisfies ContentBlock] : []),
	];
	const sessionId = activeSessionState.session.id;

	try {
		input = "";
		const optimisticAttachments = imageAttachments;
		imageAttachments = [];
		clearStreamingState();

		const currentState = sessionStateById[sessionId];
		if (currentState) {
			sessionStateById = {
				...sessionStateById,
				[sessionId]: {
					...currentState,
					messages: [
						...currentState.messages,
						{
							id: `optimistic-user-${Date.now()}`,
							sessionId,
							role: "user",
							content,
							text,
							sequence: (currentState.messages.at(-1)?.sequence ?? 0) + 1,
							provider: null,
							model: null,
							stopReason: null,
							errorMessage: null,
							usageInput: null,
							usageOutput: null,
							costTotal: null,
							createdAt: new Date().toISOString(),
						},
					],
				},
			};
		}

		await postSessionMessage(sessionId, content);
	} catch (error) {
		streamError =
			error instanceof Error ? error.message : "Failed to send message";
		streamStatus = "error";
		clearStreamingState();
		await loadSessionState(sessionId, true).catch(() => undefined);
	} finally {
		sending = false;
	}
}

function scrollToBottomNow() {
	if (!listEl) return;
	autoScrollGuard = true;
	listEl.scrollTop = listEl.scrollHeight - listEl.clientHeight;
	requestAnimationFrame(() => {
		autoScrollGuard = false;
	});
}

async function forceScrollToBottom() {
	await tick();
	// Use rAF to ensure the browser has computed layout after DOM update
	await new Promise<void>((resolve) => {
		requestAnimationFrame(() => {
			scrollToBottomNow();
			resolve();
		});
	});
}

function updateAutoFollow() {
	if (!listEl) return;
	const threshold = 80;
	const distanceFromBottom =
		listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;

	// Only mark userScrolledUp when the scroll was NOT triggered by auto-scroll
	if (!autoScrollGuard && distanceFromBottom > threshold) {
		userScrolledUp = true;
	}

	shouldAutoFollow = distanceFromBottom <= threshold;
	if (shouldAutoFollow) {
		userScrolledUp = false;
	}

	showScrollToBottom = userScrolledUp && listEl.scrollHeight > listEl.clientHeight + 24;
}

async function fileToDataUrl(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
		reader.readAsDataURL(file);
	});
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const objectUrl = URL.createObjectURL(file);
		const image = new Image();
		image.onload = () => {
			URL.revokeObjectURL(objectUrl);
			resolve(image);
		};
		image.onerror = () => {
			URL.revokeObjectURL(objectUrl);
			reject(new Error("Failed to decode image"));
		};
		image.src = objectUrl;
	});
}

async function canvasToWebpBlob(
	canvas: HTMLCanvasElement,
	quality: number,
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob);
				else reject(new Error("Failed to encode image"));
			},
			"image/webp",
			quality,
		);
	});
}

async function compressImageFile(file: File): Promise<{
	blob: Blob;
	dataUrl: string;
	mediaType: string;
	size: number;
}> {
	const image = await loadImageElement(file);
	const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
	const scale = longestEdge > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longestEdge : 1;
	const width = Math.max(1, Math.round(image.naturalWidth * scale));
	const height = Math.max(1, Math.round(image.naturalHeight * scale));

	const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas is not supported");
	context.drawImage(image, 0, 0, width, height);

	let blob = await canvasToWebpBlob(canvas, WEBP_QUALITIES[0]);
	for (const quality of WEBP_QUALITIES.slice(1)) {
		if (blob.size <= MAX_IMAGE_BYTES) break;
		blob = await canvasToWebpBlob(canvas, quality);
	}

	if (blob.size > MAX_IMAGE_BYTES) {
		throw new Error("Image is too large after compression");
	}

	const dataUrl = await fileToDataUrl(blob);
	return {
		blob,
		dataUrl,
		mediaType: "image/webp",
		size: blob.size,
	};
}

async function handlePickImages(files: FileList | File[] | null) {
	if (!files) return;
	const validFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
	if (validFiles.length === 0) return;

	try {
		const nextAttachments = await Promise.all(
			validFiles.map(async (file) => {
				const compressed = await compressImageFile(file);
				const [, base64 = ""] = compressed.dataUrl.split(",");
				const webpName = file.name.replace(/\.[^.]+$/, "") || file.name;
				return {
					id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
					name: `${webpName}.webp`,
					mediaType: compressed.mediaType,
					data: base64,
					previewUrl: compressed.dataUrl,
					size: compressed.size,
				} satisfies ComposerImageAttachment;
			}),
		);
		imageAttachments = [...imageAttachments, ...nextAttachments];
	} catch (error) {
		streamError = error instanceof Error ? error.message : "Failed to read image";
	}
}

function handleRemoveAttachment(id: string) {
	imageAttachments = imageAttachments.filter((attachment) => attachment.id !== id);
}

onMount(() => {
	// Initialize broadcast channel for cross-component communication
	try {
		broadcastChannel = new BroadcastChannel(`cohub:runtime:${runtimeId}`);
	} catch {
		// BroadcastChannel not supported, fallback to window events
	}

	void loadRuntime().finally(() => {
		bootstrapping = false;
	});

	runtimePollingTimer = setInterval(() => {
		if (!shouldPollRuntime(runtime)) return;
		void loadRuntime();
	}, 1000);

	return () => {
		if (runtimePollingTimer) clearInterval(runtimePollingTimer);
		disconnectAllSSE();
		broadcastChannel?.close();
		broadcastChannel = null;
	};
});

// Manage SSE connection lifecycle based on active session
let prevActiveSessionId: string | null = null;
$effect(() => {
	const currentId = activeSessionId;

	// Disconnect SSE for sessions that are no longer active
	for (const [id] of sessionSSEs) {
		if (id !== currentId) {
			disconnectSessionSSE(id);
		}
	}

	// Connect SSE for the new active session
	if (currentId && currentId !== prevActiveSessionId) {
		connectSessionSSE(currentId);
	}

	// Clear streaming state when switching sessions
	if (prevActiveSessionId && prevActiveSessionId !== currentId) {
		clearStreamingState();
	}
	prevActiveSessionId = currentId;
});

// Close more menu on click outside
$effect(() => {
	function handleClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest("[data-more-menu]")) {
			showMoreMenu = false;
		}
	}
	document.addEventListener("click", handleClick);
	return () => document.removeEventListener("click", handleClick);
});

$effect(() => {
	if (activeSessionId) {
		void loadSessionState(activeSessionId).finally(() => {
			bootstrapping = false;
		});
	}
});

$effect(() => {
	if (!listEl || !activeSessionId) return;
	const sessionId = activeSessionId;
	const state = sessionStateById[sessionId];
	if (!state?.loaded || didInitialScrollBySession[sessionId]) return;

	void forceScrollToBottom().then(() => {
		shouldAutoFollow = true;
		didInitialScrollBySession = {
			...didInitialScrollBySession,
			[sessionId]: true,
		};
	});
});

$effect(() => {
	if (!listEl || !activeSessionId) return;
	requestAnimationFrame(() => updateAutoFollow());
});

// Auto-follow scroll: when new content arrives and user hasn't scrolled up
$effect(() => {
	if (!listEl || !activeSessionId) return;
	if (userScrolledUp) return;
	requestAnimationFrame(() => {
		if (listEl && !userScrolledUp) {
			scrollToBottomNow();
			updateAutoFollow();
		}
	});
});
</script>

<!-- Runtime Header -->
<header class="h-[40px] flex items-center justify-between px-3 border-b border-border-subtle shrink-0 bg-bg-primary">
  <div class="flex items-center gap-3 min-w-0">
    <Terminal class="w-4 h-4 text-text-tertiary shrink-0" />
    <span class="text-[13px] text-text-primary truncate max-w-[320px]">{runtime?.title || runtime?.id || runtimeId}</span>
    <div class="hidden md:flex items-center gap-1.5 ml-2 px-2 py-0.5 rounded-[4px] bg-bg-hover border border-border-subtle shrink-0">
      <div class="w-[5px] h-[5px] rounded-full bg-current {getRuntimeStatusMeta(runtime?.status ?? 'unknown').textColorClass}"></div>
      <span class="text-[10px] uppercase tracking-wider font-medium text-text-secondary">
        {runtime?.status ?? "unknown"}
      </span>
    </div>
  </div>

  <div class="flex items-center gap-1.5">
    <button
      type="button"
      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100 disabled:opacity-50"
      onclick={() => handleCreateNewSession()}
      disabled={creatingSession || !runtime}
      title="New session"
    >
      {#if creatingSession}
        <div class="w-3 h-3 rounded-full border-2 border-border-subtle border-t-brand animate-spin"></div>
      {:else}
        <Plus class="w-3.5 h-3.5" />
      {/if}
      <span class="hidden sm:inline">New Session</span>
    </button>

    <!-- More menu -->
    <div class="relative" data-more-menu>
      <button
        type="button"
        class="flex items-center justify-center w-7 h-7 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
        onclick={() => showMoreMenu = !showMoreMenu}
        title="More"
      >
        <MoreVertical class="w-4 h-4" />
      </button>

      {#if showMoreMenu}
        <div
          class="absolute right-0 top-full mt-1 w-48 bg-bg-primary border border-border-subtle rounded-md shadow-lg overflow-hidden z-50"
        >
          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            onclick={() => { showSettings = true; showMoreMenu = false; }}
          >
            <Settings class="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>

          {#if getRuntimeStatusMeta(runtime?.status).canHibernate || getRuntimeStatusMeta(runtime?.status).canWake || getRuntimeStatusMeta(runtime?.status).canDelete}
            <div class="border-t border-border-subtle"></div>
          {/if}

          {#if getRuntimeStatusMeta(runtime?.status).canHibernate}
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-warning-soft hover:text-warning hover:bg-bg-hover transition-colors disabled:opacity-50"
              disabled={runtimeActionInProgress !== null}
              onclick={() => { void handleHibernate(); showMoreMenu = false; }}
            >
              {#if runtimeActionInProgress === "hibernate"}
                <Loader2 class="w-3.5 h-3.5 animate-spin" />
              {:else}
                <Moon class="w-3.5 h-3.5" />
              {/if}
              <span>Hibernate</span>
            </button>
          {/if}

          {#if getRuntimeStatusMeta(runtime?.status).canWake}
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-success-soft hover:text-success hover:bg-bg-hover transition-colors disabled:opacity-50"
              disabled={runtimeActionInProgress !== null}
              onclick={() => { void handleWake(); showMoreMenu = false; }}
            >
              {#if runtimeActionInProgress === "wake"}
                <Loader2 class="w-3.5 h-3.5 animate-spin" />
              {:else}
                <Power class="w-3.5 h-3.5" />
              {/if}
              <span>Wake</span>
            </button>
          {/if}

          {#if getRuntimeStatusMeta(runtime?.status).canDelete}
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-error-soft hover:text-error hover:bg-bg-hover transition-colors disabled:opacity-50"
              disabled={runtimeActionInProgress !== null}
              onclick={() => { void handleDelete(); showMoreMenu = false; }}
            >
              {#if runtimeActionInProgress === "delete"}
                <Loader2 class="w-3.5 h-3.5 animate-spin" />
              {:else}
                <Trash2 class="w-3.5 h-3.5" />
              {/if}
              <span>Delete</span>
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</header>

<!-- Runtime action error banner -->
{#if runtimeActionError}
  <div class="flex items-center justify-between px-3 py-2 border-b border-error-soft/30 bg-error-bg shrink-0">
    <span class="text-[12px] font-mono text-error-soft truncate mr-2">{runtimeActionError}</span>
    <button onclick={() => runtimeActionError = ""} class="text-text-tertiary hover:text-text-secondary shrink-0" title="Dismiss">
      <X class="w-3 h-3" />
    </button>
  </div>
{/if}

<!-- Main Content -->
<div class="flex-1 flex min-h-0">
  <div class="flex-1 flex flex-col min-w-0 bg-bg-content">
    {#if bootstrapping && !activeSessionState}
      <div class="flex-1 flex items-center justify-center bg-bg-content">
        <div class="flex flex-col items-center gap-3 text-text-tertiary">
          <div class="w-7 h-7 rounded-full border-2 border-border-subtle border-t-brand animate-spin"></div>
          <div class="text-[12px]">Loading runtime…</div>
        </div>
      </div>
    {:else if !activeSessionState}
      <div class="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-4">
        <div class="text-[14px]">No session selected</div>
        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-2 rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary transition-colors duration-100 disabled:opacity-50"
          onclick={() => handleCreateNewSession()}
          disabled={creatingSession || !runtime}
        >
          <Plus class="w-3.5 h-3.5" />
          Create a session
        </button>
      </div>
    {:else if activeSessionState.loading && !activeSessionState.loaded}
      <div class="flex-1 flex items-center justify-center bg-bg-content">
        <div class="flex flex-col items-center gap-3 text-text-tertiary">
          <div class="w-6 h-6 rounded-full border-2 border-border-subtle border-t-brand animate-spin"></div>
          <div class="text-[12px]">Loading messages…</div>
        </div>
      </div>
    {:else}
      {#if activeSessionState.error}
        <div class="m-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">
          {activeSessionState.error}
        </div>
      {/if}

      <div class="relative flex-1 min-h-0 flex flex-col">
        <ChatTimeline
          bind:this={chatTimelineRef}
          bindListEl={listEl}
          bindContentEl={contentEl}
          timeline={timeline}
          onScrollChange={updateAutoFollow}
          bottomInsetClass="pb-[calc(11rem+4.5rem+env(safe-area-inset-bottom))] sm:pb-48"
          preloadThreshold={10}
          onFirstVisible={handleFirstVisible}
        />

        {#if showScrollToBottom && timeline.length > 0}
          <button
            type="button"
            class="absolute bottom-5 right-4 z-10 flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-elevated/92 px-3 py-2 text-[12px] text-text-secondary shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-bg-hover-strong hover:text-text-primary sm:right-6"
            onclick={() => {
              shouldAutoFollow = true;
              forceScrollToBottom();
            }}
          >
            <ArrowDown class="w-3.5 h-3.5" />
            <span>回到底部</span>
          </button>
        {/if}
      </div>

      <SessionComposer
        bind:value={input}
        disabled={sending || !activeSessionState || !getRuntimeStatusMeta(runtime?.status).canSend}
        streamError={streamError}
        attachments={imageAttachments}
        onpickimage={handlePickImages}
        onremoveattachment={handleRemoveAttachment}
        onsubmit={handleSend}
      />
    {/if}
  </div>

  <!-- Settings Overlay (desktop: right drawer, mobile: bottom sheet) -->
  <SettingsOverlay open={showSettings} onClose={() => showSettings = false}>
    <div class="p-4 space-y-6">
      <section class="space-y-3">
        <div class="text-[10px] font-bold text-text-tertiary uppercase tracking-widest flex items-center justify-between">
          <span>Channels</span>
          <span class="px-1.5 py-0.5 rounded-sm bg-bg-hover-strong text-text-secondary">{runtimeChannels.length}</span>
        </div>

        {#if runtimeChannels.length === 0}
          <div class="rounded-md border border-border-subtle bg-bg-hover p-3 text-[13px] text-text-tertiary">No channels bound.</div>
        {:else}
          <div class="space-y-3">
            {#each runtimeChannels as runtimeChannel (runtimeChannel.id)}
              <div class="border border-border-subtle rounded-[5px] bg-bg-surface overflow-hidden">
                <div class="px-3 py-2 border-b border-border-subtle bg-bg-header-alt flex items-center gap-2">
                  <Hash class="w-3 h-3 text-text-tertiary" />
                  <span class="text-[12px] font-medium text-text-primary truncate">{runtimeChannel.channel?.name || runtimeChannel.channel?.provider}</span>
                </div>

                <div class="p-3">
                  {#if runtimeChannel.channel?.provider === "discord"}
                    {@const config = getDiscordRuntimeChannelConfig(runtimeChannel)}
                    <div class="space-y-4">
                      <label class="flex items-start gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={config.inbound?.requireMentionInGuild !== false}
                          onchange={(event) => patchDiscordRuntimeChannelConfig(runtimeChannel, (current) => ({
                            ...current,
                            inbound: { ...(current.inbound ?? {}), requireMentionInGuild: (event.currentTarget as HTMLInputElement).checked },
                          }))}
                          class="mt-0.5 rounded-sm bg-bg-input border-border-subtle checked:bg-brand"
                        />
                        <div class="flex flex-col min-w-0">
                          <span class="text-[13px] text-text-secondary group-hover:text-text-primary transition-colors">Require mention in Guild</span>
                          <span class="text-[11px] text-text-placeholder">Respond only when mentioned</span>
                        </div>
                      </label>

                      <div class="w-full h-px bg-border-subtle"></div>

                      <label class="flex items-start gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={config.outbound?.showThinking === true}
                          onchange={(event) => patchDiscordRuntimeChannelConfig(runtimeChannel, (current) => ({
                            ...current,
                            outbound: { ...(current.outbound ?? {}), showThinking: (event.currentTarget as HTMLInputElement).checked },
                          }))}
                          class="mt-0.5 rounded-sm bg-bg-input border-border-subtle checked:bg-brand"
                        />
                        <div class="flex flex-col">
                          <span class="text-[13px] text-text-secondary group-hover:text-text-primary transition-colors">Show thinking</span>
                        </div>
                      </label>

                      <label class="flex items-start gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={config.outbound?.showToolCalls === true}
                          onchange={(event) => patchDiscordRuntimeChannelConfig(runtimeChannel, (current) => ({
                            ...current,
                            outbound: { ...(current.outbound ?? {}), showToolCalls: (event.currentTarget as HTMLInputElement).checked },
                          }))}
                          class="mt-0.5 rounded-sm bg-bg-input border-border-subtle checked:bg-brand"
                        />
                        <div class="flex flex-col">
                          <span class="text-[13px] text-text-secondary group-hover:text-text-primary transition-colors">Show tool calls</span>
                        </div>
                      </label>
                    </div>
                  {:else}
                    <div class="text-[13px] text-text-tertiary">No configuration available.</div>
                  {/if}

                  {#if savingChannelConfigById[runtimeChannel.id]}
                    <div class="mt-3 text-[10px] text-success-soft">Saving changes...</div>
                  {/if}
                  {#if channelConfigErrorById[runtimeChannel.id]}
                    <div class="mt-3 text-[10px] text-error-soft break-all">{channelConfigErrorById[runtimeChannel.id]}</div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  </SettingsOverlay>
</div>
