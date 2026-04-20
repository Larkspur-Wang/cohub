<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import {
	type CheckpointRecord,
	type SandboxRecord,
	type SessionRecord,
	type SpaceFsEntry,
	type SpaceFsFileResponse,
	type SpaceRecord,
	type TaskRunRecord,
	createSpaceCheckpoint,
	createSpaceFsDir,
	createSpaceSession,
	deleteSpaceFsNode,
	extractSessionRenderState,
	getModels,
	getSessionMessagesPaginated,
	getSpace,
	getSpaceCheckpoints,
	getSpaceFsFile,
	getSpaceFsTree,
	getSpaceSandbox,
	getSpaceSessions,
	getTaskRun,
	moveSpaceFsNode,
	postSessionMessage,
	putSpaceFsFile,
	recreateSpaceSandbox,
	triggerSpaceFsDownload,
} from "$lib/api";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import MobileRightDrawer from "$lib/components/MobileRightDrawer.svelte";
import ModelSelector from "$lib/components/ModelSelector.svelte";
import PageHeader from "$lib/components/PageHeader.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import SpaceFilePane from "$lib/components/SpaceFilePane.svelte";
import SpaceFileSidebar from "$lib/components/SpaceFileSidebar.svelte";
import {
	type ChatMessage,
	type TimelineItem,
	toChatMessages,
} from "$lib/session-tree";
import type { SpaceFsNode } from "$lib/space-fs";
import { messageCache } from "$lib/stores/message-cache";
import {
	sessionPendingStore,
	type PendingSessionMessage,
} from "$lib/stores/session-pending.svelte";
import { unreadTracker } from "$lib/stores/session-state.svelte";

import { getRealtimeClient } from "$lib/realtime";
import type { RealtimeEventPayload } from "$lib/realtime";
import {
	RIGHT_SIDEBAR_MAX,
	RIGHT_SIDEBAR_MIN,
	uiState,
} from "$lib/stores/ui.svelte";
import type { ContentBlock, MessageRecord } from "@cohub/protocol";
import {
	AlertCircle,
	ArrowDown,
	FolderKanban,
	PanelRightClose,
	PanelRightOpen,
	Plus,
	RefreshCw,
	Terminal,
} from "lucide-svelte";
import { onMount, tick } from "svelte";

type Props = {
	data: {
		spaceId: string;
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

type SelectedModel = {
	provider: string;
	id: string;
	name?: string;
};

type SessionViewState = {
	session: SessionRecord;
	messages: MessageRecord[];
	loading: boolean;
	loaded: boolean;
	error: string;
	hasMore: boolean;
	loadingOlder: boolean;
	oldestCursor: number | undefined;
};

const MAX_IMAGE_EDGE = 2160;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const WEBP_QUALITIES = [0.88, 0.82, 0.76, 0.7, 0.62, 0.54];
const PRELOAD_THRESHOLD = 10;

const props = $props();
const data = $derived((props as Props).data);
const spaceId = $derived(data.spaceId);
const urlSessionId = $derived(page.url.searchParams.get("session"));
const urlFilePath = $derived(page.url.searchParams.get("file"));
const isRightDrawerVisible = $derived(
	uiState.rightIsDragging || uiState.mobileRightDrawerOpen,
);

let space = $state<SpaceRecord | null>(null);
let spaceSessions = $state<SessionRecord[]>([]);
let sessionStateById = $state<Record<string, SessionViewState>>({});
let activeSessionId = $state<string | null>(null);
let input = $state("");
let imageAttachments = $state<ComposerImageAttachment[]>([]);
let sending = $state(false);
let spaceLoadError = $state("");
let streamStatus = $state<"idle" | "streaming" | "done" | "error">("idle");
let streamError = $state("");
let streamingAssistantText = $state("");
let streamingThinking = $state("");
let streamingContentBlocks = $state<ContentBlock[]>([]);
let streamingDraftTruncatedStartBySessionId = $state<Record<string, boolean>>({});
let modelsCatalog = $state<Array<{
	provider: string;
	id: string;
	model: Record<string, unknown>;
}> | null>(null);
let showModelSelector = $state(false);
let sessionModelById = $state<Record<string, SelectedModel | null>>({});
let fileTree = $state<SpaceFsNode[]>([]);
let fileTreeLoading = $state(false);
let fileTreeError = $state<string | null>(null);
let openFile = $state<SpaceFsFileResponse | null>(null);
let openFileDraft = $state("");
let openFileLoading = $state(false);
let openFileSaving = $state(false);
let openFileError = $state<string | null>(null);
let openFileTooLarge = $state(false);
let pageMounted = false;
let pageVisible = true;
let pageOnline = true;
let creatingSession = $state(false);
let createSessionError = $state("");
let loadingSessionIds = $state<Record<string, boolean>>({});
let bootstrapping = $state(true);
let sandbox = $state<SandboxRecord | null>(null);
let sandboxProvisioning = $state(false);
let sandboxError = $state<string | null>(null);
let sandboxElapsed = $state(0);
let shouldAutoFollow = $state(true);
let userScrolledUp = $state(false);
let autoScrollGuard = $state(false);
let showScrollToBottom = $state(false);
let rightSidebarResizeCleanup: (() => void) | null = null;
let listEl = $state<HTMLDivElement | null>(null);
let chatTimelineRef = $state<{
	preparePrepend: () => void;
	finalizePrepend: () => void;
} | null>(null);
let streamingSessionId: string | null = null;
let checkpointSaving = $state(false);
let checkpointNotice = $state("");
let checkpointError = $state("");
let checkpoints = $state<CheckpointRecord[]>([]);
let latestCheckpointJob = $state<TaskRunRecord | null>(null);
let preloadingSessionIds = new Set<string>();
let visitedSessions = $state.raw(new Set<string>());
let scrollPosBySession = $state.raw(new Map<string, number>());
let suppressScrollSaveSessionIds = $state.raw(new Set<string>());
let scrollTargetSessionId = $state<string | null>(null);
let resetScrollTargetTimer: ReturnType<typeof setTimeout> | null = null;
let titleClickCount = $state(0);
let titleClickTimer: ReturnType<typeof setTimeout> | null = null;

function handleTitleClick() {
	titleClickCount++;
	if (titleClickTimer) clearTimeout(titleClickTimer);
	if (titleClickCount >= 4) {
		titleClickCount = 0;
		void goto(`/spaces/${spaceId}/debug`);
		return;
	}
	titleClickTimer = setTimeout(() => {
		titleClickCount = 0;
	}, 600);
}

const activeSessionState = $derived(
	activeSessionId ? (sessionStateById[activeSessionId] ?? null) : null,
);
const firstCatalogModel = $derived(
	modelsCatalog && modelsCatalog.length > 0
		? {
				provider: modelsCatalog[0].provider,
				id: modelsCatalog[0].id,
				name: modelsCatalog[0].model.name as string | undefined,
			}
		: null,
);
const activeSessionModel = $derived.by(() => {
	if (!activeSessionId) return null;
	return sessionModelById[activeSessionId] ?? firstCatalogModel;
});
const timeline = $derived.by<TimelineItem[]>(() => {
	const state = activeSessionState;
	if (!state) return [];
	const pendingMessages = getPendingMessages(state.session?.id ?? null);
	const renderedMessages = mergeRenderableMessages(state.messages, pendingMessages);
	// Filter out error messages from display. They're persisted in DB for debugging
	// and analytics, but should not appear in the chat timeline by default.
	const items: TimelineItem[] = toChatMessages(renderedMessages)
		.filter((message) => message.meta?.messageKind !== "assistant_error")
		.map((message) => ({
			id: message.id,
			kind: "message",
			message,
		}));

	const lastUserIndex = (() => {
		for (let i = items.length - 1; i >= 0; i--) {
			const item = items[i];
			if (item.kind === "message" && item.message.role === "user") return i;
		}
		return -1;
	})();

	function isIntermediate(message: ChatMessage) {
		if (message.meta?.messageKind === "assistant_intermediate") return true;
		return message.content?.some((block) => block.type === "tool_use") ?? false;
	}

	function groupIntermediateMessages(parts: TimelineItem[]) {
		const result: TimelineItem[] = [];
		let buffer: ChatMessage[] = [];
		const flush = () => {
			if (buffer.length === 0) return;
			result.push({
				id: `process-${buffer.map((message) => message.id).join("|")}`,
				kind: "process",
				messages: [...buffer],
			});
			buffer = [];
		};
		for (const item of parts) {
			if (item.kind !== "message") {
				flush();
				result.push(item);
				continue;
			}
			const message = item.message;
			if (message.role !== "assistant" || !isIntermediate(message)) {
				flush();
				result.push(item);
			} else {
				buffer.push(message);
			}
		}
		flush();
		return result;
	}

	if (lastUserIndex >= 0) {
		const historyItems = items.slice(0, lastUserIndex + 1);
		const groupedHistory = groupIntermediateMessages(historyItems);
		const currentItems = items.slice(lastUserIndex + 1);
		if (streamStatus === "streaming" || streamingContentBlocks.length > 0) {
			for (const item of currentItems) groupedHistory.push(item);
			if (streamingContentBlocks.length > 0) {
				let accText = "";
				let accThinking = "";
				const draftTruncated =
					activeSessionId
						? (streamingDraftTruncatedStartBySessionId[activeSessionId] ?? false)
						: false;
				const baseSequence = renderedMessages.at(-1)?.sequence ?? 0;
				const flushStreamingMessage = () => {
					const trimmedText = accText.trim();
					const trimmedThinking = accThinking.trim();
					if (!trimmedText && !trimmedThinking) return;
					const blocks: ContentBlock[] = [];
					if (trimmedThinking)
						blocks.push({ type: "thinking", thinking: trimmedThinking });
					if (trimmedText)
						blocks.push({
							type: "text",
							text: draftTruncated ? `…${trimmedText}` : trimmedText,
						});
					groupedHistory.push({
						id: `assistant-streaming-${groupedHistory.length}`,
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
				};
				for (const block of streamingContentBlocks) {
					if (block.type === "thinking") {
						accThinking += (accThinking ? "\n" : "") + block.thinking;
					} else if (block.type === "text") {
						accText += (accText ? "\n\n" : "") + block.text;
					}
				}
				flushStreamingMessage();
			}
			return groupIntermediateMessages(groupedHistory);
		}
		return groupIntermediateMessages([...groupedHistory, ...currentItems]);
	}

	return items;
});

function getSessionModelKey(sessionId: string) {
	return `cohub:model:${sessionId}`;
}

function loadSessionModel(sessionId: string): SelectedModel | null {
	try {
		const raw = localStorage.getItem(getSessionModelKey(sessionId));
		return raw ? (JSON.parse(raw) as SelectedModel) : null;
	} catch {
		return null;
	}
}

function saveSessionModel(sessionId: string, model: SelectedModel | null) {
	if (!model) {
		localStorage.removeItem(getSessionModelKey(sessionId));
	} else {
		localStorage.setItem(getSessionModelKey(sessionId), JSON.stringify(model));
	}
}

function ensureSessionModelLoaded(sessionId: string) {
	if (sessionModelById[sessionId]) return;
	sessionModelById = {
		...sessionModelById,
		[sessionId]: loadSessionModel(sessionId),
	};
}

async function loadModelsCatalog() {
	if (modelsCatalog) return;
	try {
		const catalog = await getModels();
		const items: Array<{
			provider: string;
			id: string;
			model: Record<string, unknown>;
		}> = [];
		for (const entries of Object.values(catalog)) {
			for (const entry of entries) items.push(entry);
		}
		modelsCatalog = items;
	} catch (error) {
		console.error("Failed to load models catalog:", error);
	}
}

function handleModelSelect(model: { provider: string; id: string }) {
	if (!activeSessionId) return;
	const catalogItem = modelsCatalog?.find(
		(item) => item.provider === model.provider && item.id === model.id,
	);
	const selected = {
		provider: model.provider,
		id: model.id,
		name: catalogItem?.model.name as string | undefined,
	} satisfies SelectedModel;
	sessionModelById = {
		...sessionModelById,
		[activeSessionId]: selected,
	};
	saveSessionModel(activeSessionId, selected);
	showModelSelector = false;
}

function updateUrlSession(sessionId: string | null) {
	const params = new URLSearchParams(page.url.searchParams);
	if (sessionId) params.set("session", sessionId);
	else params.delete("session");
	if (urlFilePath) params.set("file", urlFilePath);
	void goto(`/spaces/${spaceId}?${params.toString()}`, {
		replaceState: true,
		keepFocus: true,
		noScroll: true,
	});
}

function scheduleResetScrollTarget() {
	if (resetScrollTargetTimer) clearTimeout(resetScrollTargetTimer);
	resetScrollTargetTimer = setTimeout(() => {
		scrollTargetSessionId = null;
	}, 0);
}

function notifyStreamingStatus(sessionId: string, isStreaming: boolean) {
	window.dispatchEvent(
		new CustomEvent("cohub:streaming-status", {
			detail: { spaceId, sessionId, isStreaming },
		}),
	);
}

function mergeMessagesById(
	existing: MessageRecord[],
	incoming: MessageRecord[],
	options?: { preferIncoming?: boolean },
) {
	const preferIncoming = options?.preferIncoming ?? true;
	const byId = new Map(existing.map((message) => [message.id, message]));
	for (const message of incoming) {
		const current = byId.get(message.id);
		if (!current) {
			byId.set(message.id, message);
			continue;
		}
		byId.set(
			message.id,
			preferIncoming ? { ...current, ...message } : { ...message, ...current },
		);
	}
	return Array.from(byId.values()).sort((a, b) => a.sequence - b.sequence);
}

function getPendingMessages(sessionId: string | null): PendingSessionMessage[] {
	if (!sessionId) return [];
	return sessionPendingStore.list(sessionId);
}

function buildPendingMessage(
	sessionId: string,
	pending: PendingSessionMessage,
	fallbackSequence: number,
): MessageRecord {
	return {
		id: `pending-${pending.clientMessageId}`,
		sessionId,
		role: "user",
		content: pending.content,
		text: pending.text,
		sequence: fallbackSequence,
		provider: null,
		model: null,
		stopReason: null,
		errorMessage:
			pending.status === "failed"
				? pending.error ?? "Failed to send message"
				: null,
		usageInput: null,
		usageOutput: null,
		costTotal: null,
		meta: {
			messageKind: "user_pending",
			clientMessageId: pending.clientMessageId,
			pendingStatus: pending.status,
		},
		createdAt: pending.createdAt,
	};
}

function mergeRenderableMessages(
	persisted: MessageRecord[],
	pending: PendingSessionMessage[],
): MessageRecord[] {
	let nextSequence = (persisted.at(-1)?.sequence ?? 0) + 1;
	const pendingMessages = pending.map((message) => buildPendingMessage(message.sessionId, message, nextSequence++));
	return mergeMessagesById(persisted, pendingMessages, { preferIncoming: false });
}

function makeFsNode(entry: SpaceFsEntry): SpaceFsNode {
	return {
		...entry,
		children: [],
		isOpen: false,
		isLoaded: false,
		isLoading: false,
	};
}

function replaceNodeChildren(
	nodes: SpaceFsNode[],
	nodePath: string,
	children: SpaceFsNode[],
): SpaceFsNode[] {
	return nodes.map((node) => {
		if (node.path === nodePath)
			return {
				...node,
				children,
				isLoaded: true,
				isLoading: false,
				isOpen: true,
			};
		if (node.children.length > 0)
			return {
				...node,
				children: replaceNodeChildren(node.children, nodePath, children),
			};
		return node;
	});
}

function updateNodeState(
	nodes: SpaceFsNode[],
	nodePath: string,
	updater: (node: SpaceFsNode) => SpaceFsNode,
): SpaceFsNode[] {
	return nodes.map((node) => {
		if (node.path === nodePath) return updater(node);
		if (node.children.length > 0)
			return {
				...node,
				children: updateNodeState(node.children, nodePath, updater),
			};
		return node;
	});
}

function seedSessions(sessions: SessionRecord[]) {
	const sorted = [...sessions].sort((a, b) => {
		const aTime = new Date(a.updatedAt ?? a.createdAt).getTime();
		const bTime = new Date(b.updatedAt ?? b.createdAt).getTime();
		return bTime - aTime;
	});
	spaceSessions = sorted;
	for (const session of sorted) {
		const existing = sessionStateById[session.id];
		sessionStateById = {
			...sessionStateById,
			[session.id]: {
				session,
				messages: existing?.messages ?? [],
				loading: existing?.loading ?? false,
				loaded: existing?.loaded ?? false,
				error: existing?.error ?? "",
				hasMore: existing?.hasMore ?? true,
				loadingOlder: existing?.loadingOlder ?? false,
				oldestCursor: existing?.oldestCursor,
			},
		};
	}
}

async function loadSpace(options?: { force?: boolean }) {
	spaceLoadError = "";

	const tasks: Array<Promise<void>> = [];
	tasks.push(
		(async () => {
			try {
				space = await getSpace(spaceId);
			} catch (error) {
				spaceLoadError =
					error instanceof Error ? error.message : "Failed to load space";
			}
		})(),
	);

	tasks.push(
		(async () => {
			try {
				const result = await getSpaceSessions(spaceId);
				seedSessions(result.sessions ?? []);
			} catch (error) {
				if (!spaceLoadError) {
					spaceLoadError =
						error instanceof Error ? error.message : "Failed to load sessions";
				}
			}
		})(),
	);

	tasks.push(
		(async () => {
			try {
				checkpoints = (await getSpaceCheckpoints(spaceId)).checkpoints;
			} catch {
				// Non-blocking
			}
		})(),
	);

	await Promise.all(tasks);
}

async function pollSandboxReady() {
	const startedAt = Date.now();
	const TIMEOUT = 120_000;
	sandboxElapsed = 0;

	const elapsedTimer = setInterval(() => {
		sandboxElapsed = Math.floor((Date.now() - startedAt) / 1000);
	}, 1000);

	try {
		while (Date.now() - startedAt < TIMEOUT) {
			try {
				const result = await getSpaceSandbox(spaceId);
				sandbox = result.sandbox;

				if (result.sandbox?.status === "ready") {
					return true;
				}
				if (result.sandbox?.status === "error") {
					sandboxError =
						(result.sandbox.meta?.lastError as string) ??
						"Sandbox provision failed";
					return false;
				}
			} catch {
				// Network error, retry
			}

			await new Promise((resolve) => setTimeout(resolve, 1500));
		}

		sandboxError = "Sandbox provision timed out";
		return false;
	} finally {
		clearInterval(elapsedTimer);
	}
}

function formatElapsedTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

async function handleRecreateSandbox() {
	if (!space) return;
	sandboxError = null;
	sandboxProvisioning = true;

	try {
		await recreateSpaceSandbox(spaceId);
		const ready = await pollSandboxReady();
		if (!ready) {
			sandboxProvisioning = false;
			return;
		}

		await loadSpace({ force: true });
		void loadFileTree(true);
		bootstrapping = false;
	} catch (error) {
		sandboxError =
			error instanceof Error ? error.message : "Failed to recreate sandbox";
	} finally {
		sandboxProvisioning = false;
	}
}

async function pollCheckpointJob(jobId: string) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < 90_000) {
		try {
			const { run } = await getTaskRun(jobId);
			latestCheckpointJob = run;
			if (run.status === "completed") return run;
			if (run.status === "failed")
				throw new Error(run.errorMessage || "Checkpoint job failed");
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("404")) {
				throw error;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
	throw new Error("Checkpoint job timed out");
}

async function handleSaveCheckpoint() {
	if (!space || checkpointSaving) return;
	checkpointError = "";
	checkpointNotice = "";

	const input =
		typeof window !== "undefined"
			? window.prompt("Checkpoint description (optional)", "")
			: "";
	if (input === null) return;

	checkpointSaving = true;
	try {
		const { jobId } = await createSpaceCheckpoint(
			space.id,
			input.trim() || null,
		);
		checkpointNotice = "Saving checkpoint…";
		const run = await pollCheckpointJob(jobId);
		latestCheckpointJob = run;
		checkpoints = (await getSpaceCheckpoints(space.id)).checkpoints;
		checkpointNotice = "Checkpoint saved.";
		await loadSpace({ force: true });
	} catch (error) {
		checkpointError =
			error instanceof Error ? error.message : "Failed to save checkpoint";
	} finally {
		checkpointSaving = false;
	}
}

async function loadSessionState(sessionId: string, force = false) {
	const existing = sessionStateById[sessionId];
	if (loadingSessionIds[sessionId] && !force) return;
	if (existing?.loaded && !force) return;

	const cached = await messageCache.get(sessionId);
	if (cached && cached.messages.length > 0 && !force) {
		sessionPendingStore.reconcilePersisted(sessionId, cached.messages);
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
				oldestCursor: cached.oldestSeq != null ? cached.oldestSeq : undefined,
			},
		};
		void syncSessionNewer(sessionId, cached);
		suppressScrollSaveSessionIds.add(sessionId);
		scrollTargetSessionId = sessionId;
		scheduleResetScrollTarget();
		return;
	}

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
		sessionPendingStore.reconcilePersisted(sessionId, response.messages);
		await messageCache.replaceAuthoritativeSnapshot({
			sessionId,
			messages: response.messages,
			hasMore: response.hasMore,
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
				oldestCursor:
					response.hasMore && response.messages.length > 0
						? response.messages[0].sequence
						: undefined,
			},
		};
		suppressScrollSaveSessionIds.add(sessionId);
		scrollTargetSessionId = sessionId;
		scheduleResetScrollTarget();
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

async function syncSessionNewer(
	sessionId: string,
	cached: Awaited<ReturnType<typeof messageCache.get>>,
) {
	if (!cached || cached.messages.length === 0 || cached.newestSeq == null)
		return;
	try {
		const response = await getSessionMessagesPaginated(sessionId, {
			cursor: cached.newestSeq,
			direction: "newer",
			limit: 100,
		});
		if (response.messages.length > 0) {
			await messageCache.mergeAuthoritativeNewerPage(
				sessionId,
				response.messages,
			);
			sessionPendingStore.reconcilePersisted(sessionId, response.messages);
			const state = sessionStateById[sessionId];
			if (state) {
				sessionStateById = {
					...sessionStateById,
					[sessionId]: {
						...state,
						session: response.session ?? state.session,
						messages: mergeMessagesById(state.messages, response.messages, {
							preferIncoming: true,
						}),
					},
				};
			}
		}
	} catch (error) {
		console.warn("[syncSessionNewer] Failed to sync newer messages:", error);
	}
}

async function loadOlderMessages(sessionId: string) {
	const state = sessionStateById[sessionId];
	if (!state || !state.hasMore || state.loadingOlder) return;
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
			await messageCache.mergeAuthoritativeOlderPage(
				sessionId,
				response.messages,
				response.hasMore,
			);
			const merged = mergeMessagesById(state.messages, response.messages, {
				preferIncoming: false,
			});
			sessionStateById = {
				...sessionStateById,
				[sessionId]: {
					...state,
					messages: merged,
					hasMore: response.hasMore,
					loadingOlder: false,
					oldestCursor:
						response.hasMore && merged.length > 0
							? merged[0].sequence
							: undefined,
				},
			};
			await tick();
			chatTimelineRef?.finalizePrepend();
		} else {
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
				error:
					error instanceof Error
						? error.message
						: "Failed to load older messages",
			},
		};
	}
}

function handleFirstVisible(index: number) {
	if (!activeSessionId) return;
	const state = sessionStateById[activeSessionId];
	if (!state || !state.hasMore || state.loadingOlder) return;
	if (
		index <= PRELOAD_THRESHOLD &&
		!preloadingSessionIds.has(activeSessionId)
	) {
		const sessionId = activeSessionId;
		preloadingSessionIds.add(sessionId);
		void loadOlderMessages(sessionId).finally(() =>
			preloadingSessionIds.delete(sessionId),
		);
	}
}

function shouldHandleWsEvents(): boolean {
	return pageMounted && pageVisible && pageOnline;
}

/**
 * Merge delta content blocks into existing streaming state.
 * Uses ordinal indexing (matching the backend's `computeDelta`) to
 * correctly append to the nth text/thinking block, even when multiple
 * blocks of the same type exist (e.g. text → tool_use → text).
 * tool_use/tool_result blocks are upserted by id/tool_use_id.
 */
function cloneContentBlock(block: ContentBlock): ContentBlock {
	if (block.type === "text") return { ...block };
	if (block.type === "thinking") return { ...block };
	if (block.type === "image") {
		return {
			...block,
			source: { ...block.source },
		};
	}
	if (block.type === "tool_use") {
		return {
			...block,
			input: { ...block.input },
		};
	}
	if (block.type === "tool_result") {
		return {
			...block,
			content: Array.isArray(block.content)
				? block.content.map((item) =>
						typeof item === "object" && item !== null && "type" in item
							? cloneContentBlock(item as ContentBlock)
							: item,
					)
				: block.content,
		};
	}
	return { ...block };
}

function mergeDeltaBlocks(
	existing: ContentBlock[],
	delta: ContentBlock[],
): ContentBlock[] {
	if (delta.length === 0) return existing;

	const result = existing.map((block) => cloneContentBlock(block));
	// Track ordinal position per append-only type, matching backend computeDelta
	const ordinal = { text: 0, thinking: 0 };

	for (const block of delta) {
		if (block.type === "text") {
			const idx = ordinal.text++;
			const existingTexts = result.filter(
				(b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
			);
			const target = existingTexts[idx];
			if (target) {
				target.text += block.text;
			} else {
				result.push(cloneContentBlock(block));
			}
		} else if (block.type === "thinking") {
			const idx = ordinal.thinking++;
			const existingThinkings = result.filter(
				(b): b is Extract<ContentBlock, { type: "thinking" }> =>
					b.type === "thinking",
			);
			const target = existingThinkings[idx];
			if (target) {
				target.thinking += block.thinking;
			} else {
				result.push(cloneContentBlock(block));
			}
		} else {
			const idKey = block.type === "tool_use" ? "id" : "tool_use_id";
			const idx = result.findIndex(
				(b) =>
					(b as Record<string, unknown>)[idKey] ===
					(block as Record<string, unknown>)[idKey],
			);
			if (idx !== -1) {
				Object.assign(result[idx], cloneContentBlock(block));
			} else {
				result.push(cloneContentBlock(block));
			}
		}
	}
	return result;
}

async function reconcileSessionTail(sessionId: string) {
	const state = sessionStateById[sessionId];
	if (!state?.session) return;
	try {
		const response = await getSessionMessagesPaginated(sessionId, { limit: 30 });
		sessionPendingStore.reconcilePersisted(sessionId, response.messages);
		await messageCache.replaceAuthoritativeSnapshot({
			sessionId,
			messages: response.messages,
			hasMore: response.hasMore,
		});
		const existingOlder = state.messages.filter(
			(message) => response.messages.every((incoming) => incoming.id !== message.id),
		);
		const merged = mergeMessagesById(existingOlder, response.messages, {
			preferIncoming: true,
		});
		sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				...state,
				session: response.session ?? state.session,
				messages: merged,
				hasMore: response.hasMore,
				loading: false,
				loaded: true,
				error: "",
				loadingOlder: false,
				oldestCursor:
					response.hasMore && merged.length > 0
						? merged[0].sequence
						: undefined,
			},
		};
		void messageCache.evict();
	} catch (error) {
		console.warn("[reconcileSessionTail] Failed to reconcile session tail:", error);
	}
}

/**
 * Handle a real-time event from the WebSocket gateway.
 * Called whenever the server persists a new message in the current session.
 */
async function handleWsEvent(payload: RealtimeEventPayload) {
	try {
		const currentActiveSessionId = activeSessionId;
		if (!currentActiveSessionId) return;
		if (payload.sessionId !== currentActiveSessionId) return;

		const eventType = payload.eventType ?? payload.meta?.eventType;
		if (eventType !== "session.message") return;

		const state = sessionStateById[currentActiveSessionId];
		if (!state) return;

		const messageKind = payload.meta?.messageKind as string | undefined;
		const content = payload.content;
		// Empty delta means no new content to merge; early return is safe.
		// This also guards against malformed events with missing content.
		if (!content || content.length === 0) return;

		const sessionMessageId = payload.sessionMessageId;
		const isIntermediate = messageKind === "assistant_intermediate";
		if (!sessionMessageId && !isIntermediate) return;

		const messageRole = payload.meta?.sessionMessageRole as string | undefined;
		const rawMeta = (payload.meta ?? {}) as Record<string, unknown>;
		const sequence = (state.messages.at(-1)?.sequence ?? 0) + 1;

		const incomingMessage: MessageRecord = {
			id: sessionMessageId ?? `stream-${currentActiveSessionId}`,
			sessionId: currentActiveSessionId,
			role: (messageRole ?? "assistant") as "user" | "assistant",
			content: content as MessageRecord["content"],
			text: content.find((b) => b.type === "text")?.text ?? "",
			sequence,
			provider: null,
			model: null,
			stopReason: null,
			errorMessage: null,
			usageInput: null,
			usageOutput: null,
			costTotal: null,
			meta: {
				messageKind,
				...(rawMeta.clientMessageId ? { clientMessageId: rawMeta.clientMessageId } : {}),
			},
			createdAt: new Date().toISOString(),
		};

		// Deduplicate: skip if we already have this message
		if (state.messages.some((m) => m.id === sessionMessageId)) return;

		if (messageKind === "assistant_intermediate") {
			const hadContentBefore = streamingContentBlocks.length > 0;
			const mergedContent = mergeDeltaBlocks(
				streamingContentBlocks,
				content as ContentBlock[],
			);
			const { thinking, answer } = extractSessionRenderState(mergedContent);
			streamingThinking = thinking;
			streamingAssistantText = answer;
			streamingContentBlocks = mergedContent;
			if (!hadContentBefore && state.messages.length > 0) {
				streamingDraftTruncatedStartBySessionId = {
					...streamingDraftTruncatedStartBySessionId,
					[currentActiveSessionId]: true,
				};
			}
			if (content.length > 0) {
				if (streamingSessionId !== currentActiveSessionId) {
					streamingSessionId = currentActiveSessionId;
					notifyStreamingStatus(currentActiveSessionId, true);
				}
				await tick();
				if (!userScrolledUp) scrollToBottomNow();
			}
		} else if (messageKind === "assistant_error") {
			// Error messages are persisted in DB for debugging, but not shown in UI.
			// Clear streaming state without merging the error into visible messages.
			streamingAssistantText = "";
			streamingThinking = "";
			streamingContentBlocks = [];
			streamStatus = "error";
			if (streamingSessionId) notifyStreamingStatus(streamingSessionId, false);
			streamingSessionId = null;

			// Update session list (lastMessageId, updatedAt) even for errors so the
			// sidebar reflects the latest activity.
			const updatedSession = state.session;
			if (updatedSession) {
				const refreshedSession: SessionRecord = {
					...updatedSession,
					lastMessageId: sessionMessageId ?? null,
					updatedAt: new Date().toISOString(),
				};
				spaceSessions = spaceSessions.map(
					(s): SessionRecord =>
						s.id === updatedSession.id ? refreshedSession : s,
				);
			}
		} else if (messageKind === "assistant_final") {
			// Final message — clear streaming state, then reconcile from DB.
			streamingAssistantText = "";
			streamingThinking = "";
			streamingContentBlocks = [];
			streamStatus = "done";
			streamingDraftTruncatedStartBySessionId = {
				...streamingDraftTruncatedStartBySessionId,
				[currentActiveSessionId]: false,
			};
			if (streamingSessionId) notifyStreamingStatus(streamingSessionId, false);
			streamingSessionId = null;

			const merged = mergeMessagesById(state.messages, [incomingMessage], {
				preferIncoming: true,
			});
			sessionStateById = {
				...sessionStateById,
				[currentActiveSessionId]: {
					...state,
					messages: merged,
					loading: false,
					loaded: true,
					error: "",
					hasMore: state.hasMore ?? true,
					loadingOlder: false,
					oldestCursor: state.oldestCursor,
				},
			};

			void reconcileSessionTail(currentActiveSessionId);

			// Update session list (lastMessageId, updatedAt)
			const updatedSession = state.session;
			if (updatedSession) {
				const refreshedSession: SessionRecord = {
					...updatedSession,
					lastMessageId: sessionMessageId ?? null,
					updatedAt: new Date().toISOString(),
				};
				spaceSessions = spaceSessions.map(
					(s): SessionRecord =>
						s.id === updatedSession.id ? refreshedSession : s,
				);
			}
			if (!userScrolledUp) scrollToBottomNow();
		} else if (messageKind === "user") {
			const clientMessageId =
				typeof payload.meta?.clientMessageId === "string"
					? payload.meta.clientMessageId
					: typeof incomingMessage.meta?.clientMessageId === "string"
						? (incomingMessage.meta.clientMessageId as string)
						: null;
			if (clientMessageId) {
				sessionPendingStore.remove(currentActiveSessionId, clientMessageId);
			}
			sessionPendingStore.reconcilePersisted(currentActiveSessionId, [incomingMessage]);
			const merged = mergeMessagesById(state.messages, [incomingMessage], {
				preferIncoming: false,
			});
			if (merged.length > state.messages.length) {
				sessionStateById = {
					...sessionStateById,
					[currentActiveSessionId]: {
						...state,
						messages: merged,
					},
				};
			}
		}
	} catch (error) {
		console.error("[WS] handleWsEvent error:", error);
	}
}

/**
 * Set up WebSocket event listeners for the current active session.
 * The RealtimeClient is a singleton — we only need to register/unregister handlers.
 */
function connectSessionWS(sessionId: string) {
	if (!shouldHandleWsEvents()) return;
	const client = getRealtimeClient();
	if (client.state === "idle") {
		void client.connect().catch((error) => {
			console.error("[WS] Failed to connect:", error);
		});
	}
}

/**
 * Disconnect WebSocket if no active session.
 * (The singleton stays alive across session switches — no need to fully disconnect.)
 */
function disconnectSessionWS() {
	// No-op: the singleton RealtimeClient stays connected.
	// Event handlers filter by activeSessionId so no stale events apply.
}

function disconnectAllWS() {
	// No-op on disconnect: keep the singleton connected.
	// The client's own ping/pong and reconnect logic handles network issues.
	// We only fully disconnect on page unload (handled in onMount cleanup).
}

function clearStreamingState() {
	streamingAssistantText = "";
	streamingThinking = "";
	streamingContentBlocks = [];
	if (activeSessionId) {
		streamingDraftTruncatedStartBySessionId = {
			...streamingDraftTruncatedStartBySessionId,
			[activeSessionId]: false,
		};
	}
	if (streamingSessionId) notifyStreamingStatus(streamingSessionId, false);
	streamingSessionId = null;
}

async function handleSend() {
	if (
		!activeSessionState ||
		(!input.trim() && imageAttachments.length === 0) ||
		sending ||
		!space
	)
		return;
	sending = true;
	streamError = "";
	streamStatus = "streaming";

	const text = input.trim();
	const attachmentBlocks: ContentBlock[] = imageAttachments.map(
		(attachment) => ({
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
		}),
	);
	const content: ContentBlock[] = [
		...attachmentBlocks,
		...(text ? [{ type: "text", text } satisfies ContentBlock] : []),
	];
	const sessionId = activeSessionState.session.id;
	const clientMessageId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

	try {
		const model = activeSessionModel;
		sessionPendingStore.upsert({
			clientMessageId,
			sessionId,
			role: "user",
			content,
			text,
			createdAt: new Date().toISOString(),
			status: "sending",
			error: null,
		});

		// Try WebSocket first; fall back to HTTP if not available
		try {
			const wsClient = getRealtimeClient();
			await Promise.race([
				wsClient.sendMessage({
					spaceId: space.id,
					sessionId,
					content,
					clientMessageId,
				}),
				new Promise<void>((_, reject) => {
					setTimeout(() => reject(new Error("WS send timeout")), 5000);
				}),
			]);
		} catch (wsError) {
			console.warn(
				"[handleSend] WS send failed, falling back to HTTP:",
				wsError,
			);
			await postSessionMessage(sessionId, content, {
				model: model?.id,
				provider: model?.provider,
				clientMessageId,
			});
		}

		sessionPendingStore.markStatus(sessionId, clientMessageId, "sent_unconfirmed");
		input = "";
		imageAttachments = [];
		clearStreamingState();
	} catch (error) {
		streamError =
			error instanceof Error ? error.message : "Failed to send message";
		streamStatus = "error";
		sessionPendingStore.markStatus(
			sessionId,
			clientMessageId,
			"failed",
			streamError,
		);
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
	if (!autoScrollGuard && distanceFromBottom > threshold) {
		userScrolledUp = true;
	}
	shouldAutoFollow = distanceFromBottom <= threshold;
	if (shouldAutoFollow) userScrolledUp = false;
	showScrollToBottom =
		userScrolledUp && listEl.scrollHeight > listEl.clientHeight + 24;
}

async function fileToDataUrl(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.onerror = () =>
			reject(reader.error ?? new Error("Failed to read file"));
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

async function compressImageFile(file: File) {
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
	if (blob.size > MAX_IMAGE_BYTES)
		throw new Error("Image is too large after compression");
	const dataUrl = await fileToDataUrl(blob);
	return { blob, dataUrl, mediaType: "image/webp", size: blob.size };
}

async function handlePickImages(files: FileList | File[] | null) {
	if (!files) return;
	const validFiles = Array.from(files).filter((file) =>
		file.type.startsWith("image/"),
	);
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
		streamError =
			error instanceof Error ? error.message : "Failed to read image";
	}
}

function handleRemoveAttachment(id: string) {
	imageAttachments = imageAttachments.filter(
		(attachment) => attachment.id !== id,
	);
}

function beginRightSidebarResize(event: PointerEvent) {
	event.preventDefault();
	if (window.innerWidth < 1024 || uiState.rightSidebarCollapsed) return;
	rightSidebarResizeCleanup?.();
	const startX = event.clientX;
	const startWidth = uiState.rightSidebarWidth;
	const minMainWidth = 720;
	const onPointerMove = (moveEvent: PointerEvent) => {
		const delta = startX - moveEvent.clientX;
		const viewportLimit = window.innerWidth - minMainWidth;
		const nextWidth = Math.min(
			RIGHT_SIDEBAR_MAX,
			Math.max(RIGHT_SIDEBAR_MIN, Math.min(startWidth + delta, viewportLimit)),
		);
		uiState.setRightSidebarWidth(nextWidth);
	};
	const stop = () => {
		document.body.classList.remove("sidebar-resizing");
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", stop);
		window.removeEventListener("pointercancel", stop);
		if (rightSidebarResizeCleanup === stop) rightSidebarResizeCleanup = null;
	};
	rightSidebarResizeCleanup = stop;
	document.body.classList.add("sidebar-resizing");
	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", stop);
	window.addEventListener("pointercancel", stop);
}

async function loadFileTree(force = false) {
	if (fileTreeLoading && !force) return;
	fileTreeLoading = true;
	fileTreeError = null;
	try {
		const tree = await getSpaceFsTree(spaceId, "");
		fileTree = tree.entries.map(makeFsNode);
	} catch (error) {
		fileTreeError =
			error instanceof Error ? error.message : "Failed to load files";
	} finally {
		fileTreeLoading = false;
	}
}

async function expandDirectory(node: SpaceFsNode) {
	if (node.type !== "dir") return;
	if (node.isOpen) {
		fileTree = updateNodeState(fileTree, node.path, (item) => ({
			...item,
			isOpen: false,
		}));
		return;
	}
	if (node.isLoaded) {
		fileTree = updateNodeState(fileTree, node.path, (item) => ({
			...item,
			isOpen: true,
		}));
		return;
	}
	fileTree = updateNodeState(fileTree, node.path, (item) => ({
		...item,
		isLoading: true,
		isOpen: true,
	}));
	try {
		const tree = await getSpaceFsTree(spaceId, node.path);
		fileTree = replaceNodeChildren(
			fileTree,
			node.path,
			tree.entries.map(makeFsNode),
		);
	} catch (error) {
		fileTree = updateNodeState(fileTree, node.path, (item) => ({
			...item,
			isLoading: false,
		}));
		fileTreeError =
			error instanceof Error ? error.message : "Failed to load directory";
	}
}

async function openSpaceFile(path: string) {
	const params = new URLSearchParams(page.url.searchParams);
	params.set("file", path);
	void goto(`/spaces/${spaceId}?${params.toString()}`, {
		replaceState: true,
		noScroll: true,
		keepFocus: true,
	});
}

async function refreshFileTree() {
	await loadFileTree(true);
}

async function openFileFromUrl(path: string) {
	openFileLoading = true;
	openFileError = null;
	openFileTooLarge = false;
	try {
		const file = await getSpaceFsFile(spaceId, path);
		openFile = file;
		openFileDraft = file.kind === "text" ? file.content : "";
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to open file";
		if (message.includes("413") || message.includes("too large")) {
			openFileTooLarge = true;
			openFile = null;
			openFileDraft = "";
			openFileError = null;
		} else {
			openFileError = message;
		}
	} finally {
		openFileLoading = false;
	}
}

async function saveOpenFile() {
	if (!openFile || openFile.kind !== "text") return;
	openFileSaving = true;
	openFileError = null;
	try {
		await putSpaceFsFile(spaceId, {
			path: openFile.path,
			content: openFileDraft,
			encoding: "utf-8",
		});
		openFile = {
			...openFile,
			content: openFileDraft,
			size: new Blob([openFileDraft]).size,
		};
		await loadFileTree(true);
	} catch (error) {
		openFileError =
			error instanceof Error ? error.message : "Failed to save file";
	} finally {
		openFileSaving = false;
	}
}

async function handleCreateFile(parentPath: string) {
	const name = prompt("New file name");
	if (!name?.trim()) return;
	const path = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
	try {
		await putSpaceFsFile(spaceId, { path, content: "", encoding: "utf-8" });
		await loadFileTree(true);
		await openSpaceFile(path);
	} catch (error) {
		fileTreeError =
			error instanceof Error ? error.message : "Failed to create file";
	}
}

async function handleCreateDir(parentPath: string) {
	const name = prompt("New folder name");
	if (!name?.trim()) return;
	const path = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
	try {
		await createSpaceFsDir(spaceId, path);
		await loadFileTree(true);
	} catch (error) {
		fileTreeError =
			error instanceof Error ? error.message : "Failed to create folder";
	}
}

async function handleRenameNode(node: SpaceFsNode) {
	const nextName = prompt("Rename", node.name);
	if (!nextName?.trim() || nextName.trim() === node.name) return;
	const parent = node.path.includes("/")
		? node.path.slice(0, node.path.lastIndexOf("/"))
		: "";
	const toPath = parent ? `${parent}/${nextName.trim()}` : nextName.trim();
	try {
		await moveSpaceFsNode(spaceId, { fromPath: node.path, toPath });
		await loadFileTree(true);
		if (openFile?.path === node.path) {
			await openSpaceFile(toPath);
		}
	} catch (error) {
		fileTreeError = error instanceof Error ? error.message : "Failed to rename";
	}
}

async function handleDeleteNode(node: SpaceFsNode) {
	if (!confirm(`Delete ${node.name}?`)) return;
	try {
		await deleteSpaceFsNode(spaceId, node.path, node.type === "dir");
		await loadFileTree(true);
		if (openFile?.path === node.path) closeFile();
	} catch (error) {
		fileTreeError = error instanceof Error ? error.message : "Failed to delete";
	}
}

function closeFile() {
	const params = new URLSearchParams(page.url.searchParams);
	params.delete("file");
	void goto(`/spaces/${spaceId}?${params.toString()}`, {
		replaceState: true,
		noScroll: true,
		keepFocus: true,
	});
}

function handleCreateNewSession() {
	if (creatingSession || !space) return;
	creatingSession = true;
	createSessionError = "";
	const createSpaceId = space.id;
	void createSpaceSession(createSpaceId, { source: "web" })
		.then(async (result) => {
			const newSession = result.session;
			const nextSessions = [
				newSession,
				...spaceSessions.filter((session) => session.id !== newSession.id),
			];
			seedSessions(nextSessions);
			activeSessionId = newSession.id;
			ensureSessionModelLoaded(newSession.id);
			updateUrlSession(newSession.id);
			await loadSessionState(newSession.id, true);
			shouldAutoFollow = true;
			await forceScrollToBottom();
		})
		.catch((error) => {
			createSessionError =
				error instanceof Error ? error.message : "Failed to create session";
		})
		.finally(() => {
			creatingSession = false;
		});
}

onMount(() => {
	pageMounted = true;
	pageVisible = !document.hidden;
	pageOnline = navigator.onLine;

	// Set up WebSocket event listener once — filters by activeSessionId internally
	const wsClient = getRealtimeClient();
	const wsEventCleanup = wsClient.on("event", (payload) => {
		void handleWsEvent(payload);
	});

	const handleVisibility = () => {
		pageVisible = !document.hidden;
		if (pageVisible && activeSessionId) connectSessionWS(activeSessionId);
		if (!pageVisible) disconnectAllWS();
	};
	const handleOnline = () => {
		pageOnline = true;
		if (activeSessionId) connectSessionWS(activeSessionId);
	};
	const handleOffline = () => {
		pageOnline = false;
		disconnectAllWS();
	};

	window.addEventListener("visibilitychange", handleVisibility);
	window.addEventListener("online", handleOnline);
	window.addEventListener("offline", handleOffline);

	void loadSpace()
		.then(async () => {
			// If sandbox is not ready yet, poll until it is
			if (space && space.sandboxStatus !== "ready") {
				sandboxProvisioning = true;
				const ready = await pollSandboxReady();
				if (!ready) {
					sandboxProvisioning = false;
					bootstrapping = false;
					return;
				}
				sandboxProvisioning = false;
				// Refresh space data now that sandbox is ready
				await loadSpace({ force: true });
			}

			// Only load file tree after sandbox is confirmed ready
			void loadFileTree(true);

			const initialSessionId = urlSessionId ?? spaceSessions[0]?.id ?? null;
			if (initialSessionId) {
				activeSessionId = initialSessionId;
				ensureSessionModelLoaded(initialSessionId);
				void loadSessionState(initialSessionId).finally(() => {
					bootstrapping = false;
				});
				return;
			}

			bootstrapping = false;
		})
		.catch(() => {
			bootstrapping = false;
		});

	return () => {
		pageMounted = false;
		wsEventCleanup();
		void wsClient.disconnect();
		window.removeEventListener("visibilitychange", handleVisibility);
		window.removeEventListener("online", handleOnline);
		window.removeEventListener("offline", handleOffline);
		rightSidebarResizeCleanup?.();
	};
});

$effect(() => {
	if (urlSessionId && urlSessionId !== activeSessionId) {
		activeSessionId = urlSessionId;
		clearStreamingState();
		ensureSessionModelLoaded(urlSessionId);
		shouldAutoFollow = true;
		const state = sessionStateById[urlSessionId];
		if (state?.session?.lastMessageId)
			unreadTracker.markViewed(urlSessionId, state.session.lastMessageId);
		suppressScrollSaveSessionIds.add(urlSessionId);
		scrollTargetSessionId = urlSessionId;
		scheduleResetScrollTarget();
	}
});

$effect(() => {
	const el = listEl;
	if (!el) return;
	const container = el as HTMLDivElement;
	function handleScrollTrack() {
		if (activeSessionId && !suppressScrollSaveSessionIds.has(activeSessionId)) {
			scrollPosBySession.set(activeSessionId, container.scrollTop);
		}
	}
	container.addEventListener("scroll", handleScrollTrack, { passive: true });
	return () => container.removeEventListener("scroll", handleScrollTrack);
});

$effect(() => {
	if (!listEl) return;
	const targetId = scrollTargetSessionId;
	if (!targetId) return;
	const state = sessionStateById[targetId];
	if (!state?.loaded) return;

	const isFirstVisit = !visitedSessions.has(targetId);
	if (isFirstVisit) {
		visitedSessions.add(targetId);
	}

	const savedPos = scrollPosBySession.get(targetId);
	const shouldScrollToBottom = isFirstVisit || savedPos == null;
	const doScroll = (retries = shouldScrollToBottom ? 6 : 2) => {
		requestAnimationFrame(() => {
			if (!listEl) {
				suppressScrollSaveSessionIds.delete(targetId);
				return;
			}
			if (shouldScrollToBottom) {
				scrollToBottomNow();
				shouldAutoFollow = true;
				userScrolledUp = false;
			} else {
				listEl.scrollTop = savedPos;
			}
			if (retries > 0) {
				doScroll(retries - 1);
				return;
			}
			suppressScrollSaveSessionIds.delete(targetId);
			scrollPosBySession.set(targetId, listEl.scrollTop);
			updateAutoFollow();
		});
	};
	void tick().then(() => doScroll());
});

$effect(() => {
	if (!activeSessionId) return;
	const state = sessionStateById[activeSessionId];
	if (!state?.loaded && !state?.loading) {
		void loadSessionState(activeSessionId);
	}
	connectSessionWS(activeSessionId);
	return () => {
		disconnectSessionWS();
	};
});

$effect(() => {
	if (!urlFilePath) {
		openFile = null;
		openFileDraft = "";
		openFileError = null;
		openFileTooLarge = false;
		return;
	}
	void openFileFromUrl(urlFilePath);
});

$effect(() => {
	if (!listEl || !activeSessionId) return;
	requestAnimationFrame(() => updateAutoFollow());
});

$effect(() => {
	const state = activeSessionState;
	if (!state) return;
	if (userScrolledUp) return;
	state.messages.length;
	requestAnimationFrame(() => {
		if (listEl && !userScrolledUp) {
			scrollToBottomNow();
			updateAutoFollow();
		}
	});
});
</script>

<PageHeader>
  {#snippet left()}
    <div class="flex items-center gap-2 min-w-0">
      <Terminal class="w-3.5 h-3.5 text-text-tertiary shrink-0 hidden sm:block" />
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="text-[13px] text-text-primary truncate cursor-default select-none"
        onclick={handleTitleClick}
      >{space?.name || space?.title || space?.id || spaceId}</span>
    </div>
  {/snippet}
  {#snippet right()}
    <button
      type="button"
      class="flex items-center gap-1.5 px-2 h-8 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100 disabled:opacity-50"
      onclick={handleSaveCheckpoint}
      disabled={checkpointSaving || !space}
      title="Save checkpoint"
    >
      {#if checkpointSaving}
        <div class="w-3.5 h-3.5 rounded-full border-2 border-border-subtle border-t-brand animate-spin shrink-0"></div>
      {:else}
        <FolderKanban class="w-4 h-4 shrink-0" />
      {/if}
      <span class="hidden lg:inline text-[13px] font-medium">Save checkpoint</span>
    </button>

    <button
      type="button"
      class="flex items-center gap-1.5 px-2 h-8 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100 disabled:opacity-50"
      onclick={handleCreateNewSession}
      disabled={creatingSession || !space}
      title="New session"
    >
      {#if creatingSession}
        <div class="w-3.5 h-3.5 rounded-full border-2 border-border-subtle border-t-brand animate-spin shrink-0"></div>
      {:else}
        <Plus class="w-4 h-4 shrink-0" />
      {/if}
      <span class="hidden lg:inline text-[13px] font-medium">New session</span>
    </button>

    <div class="relative">
      <button
        type="button"
        class="flex items-center gap-1.5 px-2 h-8 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
        onclick={() => {
          if (window.innerWidth < 1024) {
            uiState.mobileRightDrawerOpen = !uiState.mobileRightDrawerOpen;
            return;
          }
          uiState.setRightSidebarCollapsed(!uiState.rightSidebarCollapsed);
        }}
        title={uiState.rightSidebarCollapsed ? "Show files" : "Hide files"}
      >
        {#if uiState.rightSidebarCollapsed}
          <PanelRightOpen class="w-4 h-4 shrink-0" />
          <span class="hidden 2xl:inline text-[13px] font-medium">Show files</span>
        {:else}
          <PanelRightClose class="w-4 h-4 shrink-0" />
          <span class="hidden 2xl:inline text-[13px] font-medium">Hide files</span>
        {/if}
      </button>
    </div>
  {/snippet}
</PageHeader>

<div class="relative flex-1 min-h-0 flex bg-bg-content">
  <div class="flex-1 flex flex-col min-w-0 bg-bg-content">
    {#if spaceLoadError && !sandboxProvisioning && !sandboxError}
      <div class="m-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{spaceLoadError}</div>
    {/if}

    {#if createSessionError && !sandboxProvisioning && !sandboxError}
      <div class="m-4 mt-0 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{createSessionError}</div>
    {/if}

    {#if checkpointError}
      <div class="m-4 mt-0 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{checkpointError}</div>
    {/if}

    {#if checkpointNotice}
      <div class="m-4 mt-0 rounded-md border border-border-subtle bg-bg-hover p-3 text-[12px] text-text-secondary break-all">{checkpointNotice}</div>
    {/if}

    {#if sandboxProvisioning || (sandbox && (sandbox.status === "pending" || sandbox.status === "provisioning"))}
      <div class="flex-1 flex items-center justify-center sandbox-provision-view">
        <div class="w-full max-w-md px-6">
          <div class="text-center space-y-6">
            <!-- Status indicator -->
            <div class="flex items-center justify-center gap-3">
              <div class="sandbox-pulse-ring"></div>
              <div class="text-[13px] font-mono uppercase tracking-wider text-brand">
                {sandbox?.status ?? "pending"}
              </div>
            </div>

            <!-- Elapsed time -->
            <div class="text-[11px] font-mono text-text-placeholder tabular-nums">
              elapsed {formatElapsedTime(sandboxElapsed)}
            </div>

            <!-- Stage messages -->
            <div class="space-y-1.5 text-[12px] font-mono">
              {#if !sandbox || sandbox.status === "pending"}
                <div class="text-text-tertiary">allocating resources…</div>
              {:else}
                <div class="text-text-secondary">starting sandbox environment</div>
                <div class="text-text-placeholder">pulling image · cloning repo · installing deps</div>
              {/if}
            </div>
          </div>
        </div>
      </div>
    {:else if sandboxError}
      <div class="flex-1 flex items-center justify-center sandbox-error-view">
        <div class="w-full max-w-md px-6">
          <div class="text-center space-y-5">
            <div class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-error-soft/10 border border-error-soft/20">
              <AlertCircle class="w-[18px] h-[18px] text-error-soft" />
            </div>
            <div>
              <div class="text-[14px] font-medium text-text-primary">Sandbox error</div>
              <div class="text-[12px] text-text-tertiary mt-1">The sandbox failed to provision.</div>
            </div>
            {#if sandboxError}
              <div class="rounded-[5px] border border-border-subtle bg-bg-surface p-3 text-[11px] font-mono text-text-secondary text-left break-all max-h-24 overflow-y-auto">
                {sandboxError}
              </div>
            {/if}
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-4 py-2 rounded-[5px] bg-[#FF3E00]/10 border border-[#FF3E00]/20 text-[13px] text-brand font-medium hover:bg-[#FF3E00]/15 active:scale-[0.97] transition-all duration-100"
              onclick={handleRecreateSandbox}
            >
              <RefreshCw class="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if checkpoints.length > 0 && !sandboxProvisioning && !sandboxError}
      <div class="mx-4 mb-4 mt-0 rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
        <div class="mb-2 flex items-center justify-between gap-3">
          <div class="text-[12px] font-medium text-text-secondary">Checkpoints</div>
          <div class="text-[11px] text-text-tertiary">{checkpoints.length} total</div>
        </div>
        <div class="space-y-2">
          {#each checkpoints.slice(0, 5) as checkpoint}
            <div class="flex items-start justify-between gap-3 rounded-[6px] border border-border-subtle/70 bg-bg-content/70 px-2.5 py-2">
              <div class="min-w-0">
                <div class="truncate text-[12px] text-text-primary">{checkpoint.description}</div>
                <div class="mt-0.5 text-[11px] text-text-tertiary font-mono">
                  {checkpoint.commitHash.slice(0, 12)}
                </div>
              </div>
              <div class="shrink-0 text-[11px] text-text-tertiary">
                {new Date(checkpoint.createdAt).toLocaleString()}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if bootstrapping && !activeSessionState}
      <div class="flex-1 flex items-center justify-center">
        <div class="flex flex-col items-center gap-3 text-text-tertiary">
          <div class="w-6 h-6 rounded-full border-2 border-border-subtle border-t-brand animate-spin"></div>
          <div class="text-[12px]">Loading messages…</div>
        </div>
      </div>
    {:else if !activeSessionState}
      <div class="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-4">
        <div class="text-[14px]">No session selected</div>
        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-2 rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary transition-colors duration-100 disabled:opacity-50"
          onclick={() => handleCreateNewSession()}
          disabled={creatingSession || !space}
        >
          <Plus class="w-3.5 h-3.5" />
          Create a session
        </button>
      </div>
    {:else if activeSessionState.loading && !activeSessionState.loaded}
      <div class="flex-1 flex items-center justify-center">
        <div class="flex flex-col items-center gap-3 text-text-tertiary">
          <div class="w-6 h-6 rounded-full border-2 border-border-subtle border-t-brand animate-spin"></div>
          <div class="text-[12px]">Loading messages…</div>
        </div>
      </div>
    {:else if !(sandboxProvisioning || sandboxError)}
      {#if activeSessionState.error}
        <div class="m-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">
          {activeSessionState.error}
        </div>
      {/if}

      <div class="relative flex-1 min-h-0 flex flex-col">
        <ChatTimeline
          bind:this={chatTimelineRef}
          bindListEl={listEl}
          timeline={timeline}
          topInsetClass="pt-[calc(4rem+env(safe-area-inset-bottom))] sm:pt-[4rem]"
          preloadThreshold={10}
          onFirstVisible={handleFirstVisible}
          loadingOlder={activeSessionState?.loadingOlder ?? false}
        />

        {#if showScrollToBottom && timeline.length > 0}
          <button
            type="button"
            class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-elevated/92 px-3 py-1.5 text-[12px] text-text-secondary shadow-lg backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-bg-hover-strong hover:text-text-primary"
            onclick={() => {
              shouldAutoFollow = true;
              void forceScrollToBottom();
            }}
          >
            <ArrowDown class="w-3.5 h-3.5" />
            <span>Scroll to bottom</span>
          </button>
        {/if}

        <SessionComposer
          bind:value={input}
          disabled={sending || !activeSessionState}
          streamError={streamError}
          attachments={imageAttachments}
          currentModel={activeSessionModel}
          onpickimage={handlePickImages}
          onremoveattachment={handleRemoveAttachment}
          onsubmit={handleSend}
          onModelSelect={() => {
            void loadModelsCatalog();
            showModelSelector = true;
          }}
        />
      </div>
    {/if}
  </div>

  <!-- File viewer overlay — floats above main content on screens without right sidebar -->
  {#if urlFilePath}
    <div class="lg:hidden absolute inset-0 z-30 flex flex-col bg-bg-content">
      <SpaceFilePane
        file={openFile}
        draftContent={openFileDraft}
        dirty={Boolean(openFile && openFile.kind === 'text' && openFileDraft !== openFile.content)}
        loading={openFileLoading}
        saving={openFileSaving}
        error={openFileError}
        onInput={(value) => openFileDraft = value}
        onSave={saveOpenFile}
        onClose={closeFile}
        onDownload={() => openFile && triggerSpaceFsDownload(spaceId, openFile.path)}
      >
        {#if openFileTooLarge}
          <div class="px-4 py-3 text-[12px] text-text-tertiary">This file is too large to preview. Download it instead.</div>
        {/if}
      </SpaceFilePane>
    </div>
  {/if}

  {#if !uiState.rightSidebarCollapsed}
    <div class="hidden shrink-0 lg:flex border-l border-border-subtle" style={`width: ${uiState.rightSidebarWidth}px`}>
      <div class="w-full relative">
        <SpaceFileSidebar
          nodes={fileTree}
          selectedPath={urlFilePath ?? ""}
          loading={fileTreeLoading}
          error={fileTreeError}
          onToggle={expandDirectory}
          onSelect={(node) => { if (node.type === "file") void openSpaceFile(node.path); }}
          onRefresh={refreshFileTree}
          onCreateFile={handleCreateFile}
          onCreateDir={handleCreateDir}
          onRename={handleRenameNode}
          onDelete={handleDeleteNode}
          canWrite={true}
        />
        <button
          type="button"
          class="right-sidebar-resize-handle"
          aria-label="Resize files sidebar"
          title="Resize files sidebar"
          onpointerdown={beginRightSidebarResize}
        ></button>
      </div>
    </div>
  {/if}

  <MobileRightDrawer
    dragOffsetPx={uiState.rightDragOffsetPx}
    isDragging={uiState.rightIsDragging}
    isDrawerVisible={isRightDrawerVisible}
  >
    <SpaceFileSidebar
      nodes={fileTree}
      selectedPath={urlFilePath ?? ""}
      loading={fileTreeLoading}
      error={fileTreeError}
      onToggle={expandDirectory}
      onSelect={(node) => { if (node.type === "file") { void openSpaceFile(node.path); uiState.mobileRightDrawerOpen = false; } }}
      onRefresh={refreshFileTree}
      onCreateFile={handleCreateFile}
      onCreateDir={handleCreateDir}
      onRename={handleRenameNode}
      onDelete={handleDeleteNode}
      canWrite={true}
    />
  </MobileRightDrawer>

  <ModelSelector
    open={showModelSelector}
    onClose={() => { showModelSelector = false; }}
    onSelect={handleModelSelect}
    models={modelsCatalog ?? []}
    currentModel={activeSessionModel}
  />
</div>

<style>
  :global(body.sidebar-resizing) {
    cursor: col-resize;
    user-select: none;
  }

  .right-sidebar-resize-handle {
    position: absolute;
    top: 0;
    left: -4px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    background: transparent;
  }

  .right-sidebar-resize-handle::after {
    content: "";
    position: absolute;
    left: 3px;
    top: 0;
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background-color 120ms ease;
  }

  .right-sidebar-resize-handle:hover::after {
    background: var(--border-subtle);
  }

  /* Sandbox provisioning pulse ring */
  .sandbox-pulse-ring {
    position: relative;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--brand, #FF3E00);
  }

  .sandbox-pulse-ring::after {
    content: "";
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: var(--brand, #FF3E00);
    opacity: 0;
    animation: sandboxPulse 2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
  }

  @keyframes sandboxPulse {
    0% {
      transform: scale(1);
      opacity: 0.4;
    }
    100% {
      transform: scale(2.5);
      opacity: 0;
    }
  }

  /* Entrance animations for sandbox views */
  .sandbox-provision-view,
  .sandbox-error-view {
    animation: sandboxFadeIn 0.4s cubic-bezier(0.25, 1, 0.5, 1) both;
  }

  .sandbox-error-view {
    animation-delay: 0.05s;
  }

  @keyframes sandboxFadeIn {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sandbox-pulse-ring::after {
      animation: none;
      opacity: 0.2;
    }

    .sandbox-provision-view,
    .sandbox-error-view {
      animation: none;
    }
  }
</style>
