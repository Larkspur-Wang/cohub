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
	getModels,
	getSessionMessages,
	getSessionMessagesPaginated,
	hibernateRuntime,
	postSessionMessage,
	streamSessionEvents,
	updateRuntimeChannelConfig,
	wakeRuntime,
	createRuntimePermission,
	createSessionPermission,
	deleteRuntimePermission,
	deleteSessionPermission,
	type ResourcePermission,
	getRuntimeFsTree,
	getRuntimeFsFile,
	putRuntimeFsFile,
	createRuntimeFsDir,
	deleteRuntimeFsNode,
	moveRuntimeFsNode,
	type RuntimeFsFileResponse,
	addRuntimeCollaborator,
	listRuntimeCollaborators,
	updateRuntimeCollaborator,
	removeRuntimeCollaborator,
} from "$lib/api";
import PageHeader from "$lib/components/PageHeader.svelte";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import MobileRightDrawer from "$lib/components/MobileRightDrawer.svelte";
import ModelSelector from "$lib/components/ModelSelector.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import SettingsOverlay from "$lib/components/SettingsOverlay.svelte";
import RuntimeFileSidebar from "$lib/components/RuntimeFileSidebar.svelte";
import CodeEditor from "$lib/components/CodeEditor.svelte";
import type { RuntimeFsNode } from "$lib/runtime-fs";
import { renderMarkdown } from "$lib/markdown";
import { getRuntimeStatusMeta } from "$lib/runtime-status";
import { triggerRuntimeFsDownload } from "$lib/api";
import { type ChatMessage, type TimelineItem, toChatMessages } from "$lib/session-tree";
import { unreadTracker } from "$lib/stores/session-state.svelte";
import { messageCache } from "$lib/stores/message-cache";
import { authStore } from "$lib/stores/auth.svelte";
import { runtimeStore } from "$lib/stores/runtime-store.svelte";
import { uiState, RIGHT_SIDEBAR_MAX, RIGHT_SIDEBAR_MIN } from "$lib/stores/ui.svelte";
import { hydrateSessionCacheToRuntimeStore } from "$lib/stores/cache-hydration";
import {
	MOBILE_DRAWER_WIDTH_PX,
	getDrawerOpenRatio,
	resolveDrawerGestureDirection,
	getRightDrawerOffsetFromDrag,
	shouldOpenRightDrawer,
	shouldKeepRightDrawerOpen,
	shouldStartRightDrawerGesture,
	type DrawerGesturePhase,
	type DrawerGestureDirection,
} from "$lib/gestures/drawer-swipe";
import type { MessageRecord } from "@cohub/protocol";
import {
	ArrowDown,
	Brain,
	Check,
	Copy,
	Download,
	Eye,
	Globe,
	Hash,
	Loader2,
	Lock,
	Moon,
	MoreVertical,
	PanelRightClose,
	PanelRightOpen,
	Pencil,
	Plus,
	Power,
	Save,
	Settings,
	Share2,
	Terminal,
	Trash2,
	User,
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
const urlFilePath = $derived(page.url.searchParams.get("file"));

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

// ─── Model selection ───

type SelectedModel = {
	provider: string;
	id: string;
	name?: string;
};

let modelsCatalog = $state<Array<{ provider: string; id: string; model: Record<string, unknown> }> | null>(null);
let showModelSelector = $state(false);

// Per-session model selection stored in localStorage
function getSessionModelKey(sessionId: string): string {
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

// Current model for the active session
let sessionModelById = $state<Record<string, SelectedModel | null>>({});

// The first model from the catalog (used as fallback when no explicit selection)
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
	const explicit = sessionModelById[activeSessionId];
	// Explicit selection wins; otherwise fall back to the first catalog model
	return explicit ?? firstCatalogModel;
});

async function loadModelsCatalog() {
	if (modelsCatalog) return;
	try {
		const catalog = await getModels();
		// API returns { provider: ModelCatalogEntry[] } — flatten to array
		const items: Array<{ provider: string; id: string; model: Record<string, unknown> }> = [];
		for (const [, entries] of Object.entries(catalog)) {
			for (const entry of entries) {
				items.push(entry);
			}
		}
		modelsCatalog = items;
	} catch (err) {
		console.error("Failed to load models catalog:", err);
	}
}

function handleModelSelect(model: { provider: string; id: string }) {
	if (!activeSessionId) return;
	// Look up the display name from the catalog
	const catalogItem = modelsCatalog?.find(
		(m) => m.provider === model.provider && m.id === model.id,
	);
	const selected: SelectedModel = {
		provider: model.provider,
		id: model.id,
		name: catalogItem?.model.name as string | undefined,
	};
	sessionModelById = {
		...sessionModelById,
		[activeSessionId]: selected,
	};
	saveSessionModel(activeSessionId, selected);
	showModelSelector = false;
}

// SSE - per-session connections
let sessionSSEs = new Map<string, AbortController>();
let sessionLastEventIds = new Map<string, string>();
let sessionReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
let sessionReconnectAttempts = new Map<string, number>();
let pageMounted = false;
let pageVisible = true;
let pageOnline = true;

// Sequential event processing queue to prevent race conditions
let eventProcessing = false;
let eventQueue: SessionStreamEvent[] = [];

// Track which session is currently streaming (for sidebar status)
let streamingSessionId: string | null = null;

// Broadcast channel for cross-tab / cross-component session updates
let broadcastChannel: BroadcastChannel | null = null;

function notifySessionsUpdate() {
	// Use sorted sessions from store, not the local unsorted runtimeSessions
	const sessions = runtimeStore.getSessions(runtimeId) ?? runtimeSessions;
	// Notify sidebar about session changes
	window.dispatchEvent(
		new CustomEvent("cohub:sessions-updated", {
			detail: { runtimeId, sessions },
		}),
	);
	broadcastChannel?.postMessage({
		type: "sessions-updated",
		runtimeId,
		sessions: JSON.parse(JSON.stringify(sessions)),
	});
}

function notifyPermissionsUpdate() {
	window.dispatchEvent(
		new CustomEvent("cohub:permissions-updated", {
			detail: { runtimeId },
		}),
	);
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

let runtimePollingTimer: ReturnType<typeof setTimeout> | null = null;
let loadingPermissions = $state(false);
let loadingChannels = $state(false);
const listEl = $state<HTMLDivElement | null>(null);
let savingChannelConfigById = $state<Record<string, boolean>>({});
let channelConfigErrorById = $state<Record<string, string>>({});
let loadingSessionIds = $state<Record<string, boolean>>({});
let bootstrapping = $state(true);
// In column-reverse: scrollTop=0 means the user is at the visual bottom.
// We track if the user has manually scrolled up (away from bottom).
let hasScrolledUp = $state(false);

let creatingSession = $state(false);
let createSessionError = $state("");
let showSettings = $state(false);
let showMoreMenu = $state(false);
let showScrollToBottom = $state(false);
let rightSidebarResizeCleanup: (() => void) | null = null;

// Share / Permissions
let runtimePermissions = $state<ResourcePermission[]>([]);
let runtimePermissionsLoaded = $state(false);
const sessionTitleById = $derived.by(() => {
	const map = new Map<string, string>();
	for (const session of runtimeSessions) {
		const label = session.title || session.latestMessageText || `Session ${session.id.slice(0, 8)}`;
		map.set(session.id, label);
	}
	return map;
});
const sharedSessionPermissions = $derived(
	runtimePermissions.filter((permission) => permission.resourceType === "session"),
);
let runtimePublicRead = $state(false);
let savingRuntimePerm = $state(false);
let shareCopied = $state(false);
let shareCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let showShareModal = $state(false);
let shareModalSessionId = $state<string | null>(null);

let shareModalError = $state("");
let shareModalSaving = $state(false);
let sessionPermError = $state("");
let isOwner = $state(false);

// Collaborators
let runtimeCollaborators = $state<ResourcePermission[]>([]);
let collaboratorsLoaded = $state(false);
let loadingCollaborators = $state(false);
let addingCollaboratorUuid = $state("");
let addingCollaboratorLevel = $state<"read" | "write">("write");
let addingCollaboratorError = $state("");
let savingCollaborator = $state(false);

// Write permission: owner always has write access;
// non-owners need to be a collaborator with "write" level.
let canWrite = $derived(
  isOwner ||
  runtimeCollaborators.some(
    (c) => c.granteeUuid === authStore.userUuid && c.level === "write",
  ),
);


// Chat timeline ref (for API compat with preparePrepend/finalizePrepend no-ops)
type ChatTimelineHandle = {
	preparePrepend: () => void;
	finalizePrepend: () => void;
};
let chatTimelineRef = $state<ChatTimelineHandle | null>(null);

// Preload tracking: debounce to avoid multiple concurrent loads
let preloadingSessionIds = new Set<string>();
const PRELOAD_THRESHOLD = 10;

// Runtime actions
let runtimeActionError = $state("");
let runtimeActionInProgress: string | null = $state(null);

// No-write-permission hint toast
let showNoWriteHint = $state(false);
let noWriteHintTimer: ReturnType<typeof setTimeout> | null = null;

function triggerNoWriteHint() {
	if (noWriteHintTimer) clearTimeout(noWriteHintTimer);
	showNoWriteHint = true;
	noWriteHintTimer = setTimeout(() => { showNoWriteHint = false; }, 3000);
}

let fileTree = $state<RuntimeFsNode[]>([]);
let fileTreeLoading = $state(false);
let fileTreeError = $state<string | null>(null);
const fileMode = $derived<("chat" | "file")>(urlFilePath ? "file" : "chat");
let openFile = $state<RuntimeFsFileResponse | null>(null);
let openFileDraft = $state("");
let openFileLoading = $state(false);
let openFileSaving = $state(false);
let openFileError = $state<string | null>(null);
let fileEdit = $state(true);
let fileMarkdownHtml = $state("");
let openFileTooLarge = $state(false);

async function handleHibernate() {
	if (!confirm("Hibernate this runtime? The sandbox pod will be stopped."))
		return;
	runtimeActionInProgress = "hibernate";
	runtimeActionError = "";
	try {
		await hibernateRuntime(runtimeId);
		await loadRuntime({ force: true });
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
		await loadRuntime({ force: true });
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
		runtimeStore.removeRuntime(runtimeId);
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

function isIntermediate(msg: ChatMessage): boolean {
	if (msg.meta?.messageKind === "assistant_intermediate") return true;
	return msg.content?.some((b) => b.type === "tool_use") ?? false;
}

function groupIntermediateMessages(items: TimelineItem[]): TimelineItem[] {
	const result: TimelineItem[] = [];
	let buffer: ChatMessage[] = [];

	function flushBuffer() {
		if (buffer.length === 0) return;
		const id = `process-${buffer.map((m) => m.id).join("|")}`;
		result.push({ id, kind: "process", messages: [...buffer] });
		buffer = [];
	}

	for (const item of items) {
		if (item.kind !== "message") {
			flushBuffer();
			result.push(item);
			continue;
		}

		const msg = item.message;
		if (msg.role !== "assistant" || !isIntermediate(msg)) {
			// user/system message or assistant without tool_use → final
			flushBuffer();
			result.push(item);
		} else {
			// Intermediate assistant message → collect
			buffer.push(msg);
		}
	}

	flushBuffer();
	return result;
}

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

	// Group historical messages (before the current turn) into process cards.
	// Only the messages after the last user turn are kept flat during streaming
	// so tool cards and streaming text render inline as they arrive.
	const lastUserIndex = (() => {
		for (let i = items.length - 1; i >= 0; i--) {
			const item = items[i];
			if (item.kind === "message" && item.message.role === "user") {
				return i;
			}
		}
		return -1;
	})();

	// Group the historical portion
	if (lastUserIndex >= 0) {
		const historyItems = items.slice(0, lastUserIndex + 1);
		const groupedHistory = groupIntermediateMessages(historyItems);
		const streamingItems = items.slice(lastUserIndex + 1);

		if (streamStatus === "streaming" || streamingContentBlocks.length > 0) {
			// Append items that arrived after the last user message first
			for (const item of streamingItems) {
				groupedHistory.push(item);
			}

			// Then append the live streaming content at the very end
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

					groupedHistory.push({
						id: `assistant-streaming-seg-${groupedHistory.length}`,
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
						groupedHistory.push({
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
				groupedHistory.push({
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

			// Group all items (including streaming) so process cards stay collapsed
			// by default and the summary numbers update as messages arrive
			return groupIntermediateMessages(groupedHistory);
		}

		// Not streaming: group the streaming portion too
		return groupIntermediateMessages([...groupedHistory, ...streamingItems]);
	}

	// No user messages at all: group everything
	return groupIntermediateMessages(items);
});

$effect(() => {
	const currentRuntime = runtime;
	const userUuid = authStore.userUuid;
	if (currentRuntime) {
		isOwner = currentRuntime.userUuid === userUuid;
	}
});

// Collapse right sidebar when user doesn't have write permission
$effect(() => {
	if (!canWrite && typeof window !== "undefined") {
		uiState.setRightSidebarCollapsed(true);
	}
});

// Inject shared runtime into sidebar when non-owner views it
$effect(() => {
	const currentRuntime = runtime;
	if (currentRuntime && !isOwner) {
		// Check if already in the runtime list
		const alreadyInList = runtimeStore.runtimeList.some((r) => r.id === currentRuntime.id);
		if (!alreadyInList) {
			// Inject at the front of the list so it appears first in sidebar
			runtimeStore.injectSharedRuntime(currentRuntime);
		}
	}
});

// Sync active session with URL
$effect(() => {
	if (urlSessionId && urlSessionId !== activeSessionId) {
		activeSessionId = urlSessionId;
		ensureSessionModelLoaded(urlSessionId);
		// Reset scroll state on session switch
		hasScrolledUp = false;
		// Mark session as viewed when navigating to it
		const state = sessionStateById[urlSessionId];
		if (state?.session?.lastMessageId) {
			unreadTracker.markViewed(urlSessionId, state.session.lastMessageId);
		}
	}
});

// Load saved model for a session (called explicitly, not via $effect)
function ensureSessionModelLoaded(sessionId: string) {
	if (sessionModelById[sessionId]) return;
	const saved = loadSessionModel(sessionId);
	sessionModelById = {
		...sessionModelById,
		[sessionId]: saved,
	};
}

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

function mergeMessagesById(
	existing: MessageRecord[],
	incoming: MessageRecord[],
	options?: { preferIncoming?: boolean },
): MessageRecord[] {
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
			preferIncoming
				? {
					...current,
					...message,
				}
				: {
					...message,
					...current,
				},
		);
	}
	return Array.from(byId.values()).sort((a, b) => a.sequence - b.sequence);
}

function makeFsNode(entry: {
	name: string;
	path: string;
	type: "file" | "dir" | "symlink";
	size: number;
	mimeType: string | null;
	mtimeMs: number;
}): RuntimeFsNode {
	return {
		...entry,
		children: [],
		isOpen: false,
		isLoaded: false,
		isLoading: false,
	};
}

function replaceNodeChildren(nodes: RuntimeFsNode[], nodePath: string, children: RuntimeFsNode[]): RuntimeFsNode[] {
	return nodes.map((node) => {
		if (node.path === nodePath) {
			return { ...node, children, isLoaded: true, isLoading: false, isOpen: true };
		}
		if (node.children.length > 0) {
			return { ...node, children: replaceNodeChildren(node.children, nodePath, children) };
		}
		return node;
	});
}

function updateNodeState(nodes: RuntimeFsNode[], nodePath: string, updater: (node: RuntimeFsNode) => RuntimeFsNode): RuntimeFsNode[] {
	return nodes.map((node) => {
		if (node.path === nodePath) return updater(node);
		if (node.children.length > 0) {
			return { ...node, children: updateNodeState(node.children, nodePath, updater) };
		}
		return node;
	});
}

async function loadFileTree(force = false) {
	if (fileTreeLoading && !force) return;
	fileTreeLoading = true;
	fileTreeError = null;
	try {
		const tree = await getRuntimeFsTree(runtimeId, "");
		fileTree = tree.entries.map(makeFsNode);
	} catch (error) {
		fileTreeError = error instanceof Error ? error.message : "Failed to load files";
	} finally {
		fileTreeLoading = false;
	}
}

async function expandDirectory(node: RuntimeFsNode) {
	if (node.type !== "dir") return;
	if (node.isOpen) {
		fileTree = updateNodeState(fileTree, node.path, (item) => ({ ...item, isOpen: false }));
		return;
	}
	if (node.isLoaded) {
		fileTree = updateNodeState(fileTree, node.path, (item) => ({ ...item, isOpen: true }));
		return;
	}
	fileTree = updateNodeState(fileTree, node.path, (item) => ({ ...item, isLoading: true, isOpen: true }));
	try {
		const tree = await getRuntimeFsTree(runtimeId, node.path);
		fileTree = replaceNodeChildren(fileTree, node.path, tree.entries.map(makeFsNode));
	} catch (error) {
		fileTree = updateNodeState(fileTree, node.path, (item) => ({ ...item, isLoading: false }));
		fileTreeError = error instanceof Error ? error.message : "Failed to load directory";
	}
}

async function openRuntimeFile(path: string) {
	const params = new URLSearchParams(page.url.searchParams);
	params.set("file", path);
	void goto(`/runtimes/${runtimeId}?${params.toString()}`, { replaceState: true });
}

async function saveOpenFile() {
	if (!openFile || openFile.kind !== "text") return;
	openFileSaving = true;
	openFileError = null;
	try {
		await putRuntimeFsFile(runtimeId, {
			path: openFile.path,
			content: openFileDraft,
			encoding: "utf-8",
		});
		openFile = { ...openFile, content: openFileDraft, size: new Blob([openFileDraft]).size };
		await loadFileTree(true);
	} catch (error) {
		openFileError = error instanceof Error ? error.message : "Failed to save file";
	} finally {
		openFileSaving = false;
	}
}

async function handleCreateFile(parentPath: string) {
	const name = prompt("New file name");
	if (!name?.trim()) return;
	const path = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
	try {
		await putRuntimeFsFile(runtimeId, { path, content: "", encoding: "utf-8" });
		await loadFileTree(true);
		await openRuntimeFile(path);
	} catch (error) {
		fileTreeError = error instanceof Error ? error.message : "Failed to create file";
	}
}

async function handleCreateDir(parentPath: string) {
	const name = prompt("New folder name");
	if (!name?.trim()) return;
	const path = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
	try {
		await createRuntimeFsDir(runtimeId, path);
		await loadFileTree(true);
	} catch (error) {
		fileTreeError = error instanceof Error ? error.message : "Failed to create folder";
	}
}

async function handleRenameNode(node: RuntimeFsNode) {
	const nextName = prompt("Rename", node.name);
	if (!nextName?.trim() || nextName.trim() === node.name) return;
	const parent = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";
	const toPath = parent ? `${parent}/${nextName.trim()}` : nextName.trim();
	try {
		await moveRuntimeFsNode(runtimeId, { fromPath: node.path, toPath });
		await loadFileTree(true);
		if (urlFilePath === node.path) {
			await openRuntimeFile(toPath);
		}
	} catch (error) {
		fileTreeError = error instanceof Error ? error.message : "Failed to rename";
	}
}

async function handleDeleteNode(node: RuntimeFsNode) {
	if (!confirm(`Delete ${node.name}?`)) return;
	try {
		await deleteRuntimeFsNode(runtimeId, node.path, node.type === "dir");
		if (urlFilePath === node.path) {
			const params = new URLSearchParams(page.url.searchParams);
			params.delete("file");
			void goto(`/runtimes/${runtimeId}?${params.toString()}`, { replaceState: true });
		}
		await loadFileTree(true);
	} catch (error) {
		fileTreeError = error instanceof Error ? error.message : "Failed to delete";
	}
}

const fileDirty = $derived(Boolean(openFile && openFile.kind === "text" && openFileDraft !== openFile.content));

const openFileIsMarkdown = $derived(Boolean(openFile?.kind === "text" && /\.md$/i.test(openFile.path)));
const openFileExt = $derived.by(() => {
	if (!openFile || openFile.kind !== "text") return "plaintext";
	return openFile.name.split(".").pop()?.toLowerCase() ?? "plaintext";
});
const openFileIsImage = $derived(Boolean(openFile?.mimeType?.startsWith("image/")));
const openFileIsVideo = $derived(Boolean(openFile?.mimeType?.startsWith("video/")));
const openFileIsText = $derived(Boolean(openFile?.kind === "text"));
const openFileDownloadUrl = $derived.by(() => {
	if (!urlFilePath) return "";
	return `/api/runtimes/${runtimeId}/fs/download?path=${encodeURIComponent(urlFilePath)}`;
});
const openFileDownloadName = $derived.by(() => {
	if (!urlFilePath) return "";
	return urlFilePath.split("/").pop() ?? "download";
});

// Render markdown preview when file is markdown
$effect(() => {
	const current = openFile;
	if (!current || current.kind !== "text" || !/\.md$/i.test(current.path)) {
		fileMarkdownHtml = "";
		return;
	}
	void renderMarkdown(current.content).then((html) => {
		if (openFile?.path === current.path) fileMarkdownHtml = html;
	}).catch(() => {
		fileMarkdownHtml = "";
	});
});

async function handleFileSelect(node: RuntimeFsNode) {
	if (node.type !== "file") {
		await expandDirectory(node);
		return;
	}
	await openRuntimeFile(node.path);
	uiState.mobileRightDrawerOpen = false;
}

async function handleFileToggle(node: RuntimeFsNode) {
	await expandDirectory(node);
}

async function refreshFileTree() {
	await loadFileTree(true);
}

// URL-driven file viewer: load file when ?file= is set, close when cleared
$effect(() => {
	const path = urlFilePath;
	if (path) {
		void (async () => {
			openFileLoading = true;
			openFileError = null;
			openFileTooLarge = false;
			try {
				const file = await getRuntimeFsFile(runtimeId, path);
				if (urlFilePath !== path) return;
				openFile = file;
				openFileDraft = file.kind === "text" ? file.content : "";
				fileEdit = true;
			} catch (error) {
				if (urlFilePath !== path) return;
				const msg = error instanceof Error ? error.message : "";
				// Detect file_too_large error (API returns 413 with code "file_too_large")
				if (msg.includes("file_too_large")) {
					openFileTooLarge = true;
					openFileError = null;
				} else {
					openFile = null;
					openFileDraft = "";
					openFileError = error instanceof Error ? error.message : "Failed to open file";
					openFileTooLarge = false;
				}
			} finally {
				if (urlFilePath === path) {
					openFileLoading = false;
				}
			}
		})();
	} else {
		openFile = null;
		openFileDraft = "";
		openFileError = null;
		openFileTooLarge = false;
		fileMarkdownHtml = "";
	}
});

function closeFile() {
	const params = new URLSearchParams(page.url.searchParams);
	params.delete("file");
	void goto(`/runtimes/${runtimeId}?${params.toString()}`, { replaceState: true });
}

function handleFileInput(value: string) {
	openFileDraft = value;
}

async function handleFileKeyboardSave(event: KeyboardEvent) {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && fileMode === "file") {
		event.preventDefault();
		await saveOpenFile();
	}
}

async function handleCreateNewSession() {
	if (creatingSession || !runtime) return;
	creatingSession = true;
	createSessionError = "";

	try {
		const result = await createRuntimeSession(runtime.id, { source: "web" });
		const newSession = result.session;

		runtimeSessions = [...runtimeSessions, newSession];
		runtimeStore.patchSession(runtime.id, newSession);
		sessionStateById = {
			...sessionStateById,
			[newSession.id]: {
				session: newSession,
				messages: [],
				loading: false,
				loaded: true,
				error: "",
				hasMore: false,
				loadingOlder: false,
				oldestCursor: undefined,
			},
		};

		activeSessionId = newSession.id;
		ensureSessionModelLoaded(newSession.id);
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
	runtimeStore.setSessions(runtimeId, sessions);
	notifySessionsUpdate();

	// Auto-select session from URL or fallback to latest
	if (urlSessionId && !sessionStateById[urlSessionId]?.loaded) {
		ensureSessionModelLoaded(urlSessionId);
		// Will be loaded by the effect below
	} else if (!activeSessionId && sessions.length > 0) {
		const nextId = sessions.at(-1)?.id ?? null;
		if (nextId) {
			activeSessionId = nextId;
			ensureSessionModelLoaded(nextId);
			updateUrlSession(nextId);
		}
	}
}

function getDiscordRuntimeChannelConfig(
	runtimeChannel: RuntimeChannelRecord,
): DiscordChannelConfig {
	return (
		(runtimeChannel.config as DiscordChannelConfig) ?? {
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

async function loadRuntime(options?: { force?: boolean; includeChannels?: boolean }) {
	runtimeLoadError = "";
	const force = options?.force ?? false;
	const includeChannels = options?.includeChannels ?? false;

	const cachedRuntime = runtimeStore.getRuntime(runtimeId);
	if (cachedRuntime && !runtime) {
		runtime = cachedRuntime as RuntimeRecord;
		isOwner = cachedRuntime.userUuid === authStore.userUuid;
	}

	const cachedSessions = runtimeStore.getSessions(runtimeId);
	if (!cachedSessions) {
		hydrateSessionCacheToRuntimeStore(runtimeId);
	}
	const fallbackSessions = cachedSessions ?? runtimeStore.getSessions(runtimeId);
	if (fallbackSessions && runtimeSessions.length === 0) {
		seedSessions(fallbackSessions);
	}

	const tasks: Array<Promise<void>> = [];

	tasks.push((async () => {
		try {
			const runtimeResult = await runtimeStore.ensureRuntimeDetail(runtimeId, { force: force || shouldPollRuntime(runtimeStore.getRuntime(runtimeId) as RuntimeRecord | null) });
			runtime = runtimeResult;
			isOwner = runtimeResult.userUuid === authStore.userUuid;
		} catch (error) {
			runtimeLoadError =
				error instanceof Error
					? error.message
					: "Failed to load runtime";
		}
	})());

	tasks.push((async () => {
		try {
			const sessions = await runtimeStore.ensureRuntimeSessions(runtimeId, { force });
			seedSessions(sessions);
		} catch (error) {
			if (!runtimeLoadError) {
				runtimeLoadError =
					error instanceof Error
						? error.message
						: "Failed to load runtime sessions";
			}
		}
	})());

	if (includeChannels) {
		tasks.push((async () => {
			try {
				const channels = await runtimeStore.ensureRuntimeChannels(runtimeId, { force });
				runtimeChannels = channels;
			} catch (error) {
				if (!runtimeLoadError) {
					runtimeLoadError =
						error instanceof Error
							? error.message
							: "Failed to load runtime channels";
				}
			}
		})());
	} else {
		const cachedChannels = runtimeStore.getRuntimeChannels(runtimeId);
		if (cachedChannels && runtimeChannels.length === 0) {
			runtimeChannels = cachedChannels;
		}
	}

	await Promise.all(tasks);
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
				oldestCursor: cached.oldestSeq != null ? cached.oldestSeq : undefined,
			},
		};

		// Background sync: fetch newer messages since cache
		void syncSessionNewer(sessionId, cached);

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
				const merged = mergeMessagesById(state.messages, response.messages, {
					preferIncoming: true,
				});
				if (merged.length !== state.messages.length) {
					sessionStateById = {
						...sessionStateById,
						[sessionId]: {
							...state,
							messages: merged,
						},
					};
				} else if (response.messages.some((m) => state.messages.some((s) => s.id === m.id))) {
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

	const unseenTopCount = index;
	if (unseenTopCount <= PRELOAD_THRESHOLD && !preloadingSessionIds.has(activeSessionId)) {
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

function getRuntimePollInterval(runtime: RuntimeRecord | null) {
	return runtime?.status === "starting" ? 1_000 : 3_000;
}

// ─── Share / Permissions ───

async function loadPermissions(force = false) {
	if (!force && runtimePermissionsLoaded) return;
	// Mark as loading immediately so the $effect doesn't re-trigger
	// while the async call is in-flight.
	runtimePermissionsLoaded = true;
	try {
		const perms = await runtimeStore.ensureRuntimePermissionRecords(runtimeId, { force });
		runtimePermissions = perms;
		runtimePublicRead = perms.some((p) => p.resourceType === "runtime");
		runtimeSessions = runtimeStore.getSessions(runtimeId) ?? runtimeSessions;
	} catch {
		// Reset on failure so it can retry
		runtimePermissionsLoaded = false;
		// Ignore — permissions may not exist yet
	}
}

async function toggleRuntimePublicRead(enabled: boolean) {
	savingRuntimePerm = true;
	try {
		if (enabled) {
			await createRuntimePermission(runtimeId, "read");
		} else {
			await deleteRuntimePermission(runtimeId);
		}
		runtimePublicRead = enabled;
		await loadPermissions(true);
		notifyPermissionsUpdate();
	} catch {
		// Revert
		runtimePublicRead = !enabled;
	} finally {
		savingRuntimePerm = false;
	}
}

function openShareModal(sessionId: string) {
	shareModalSessionId = sessionId;
	shareCopied = false;
	showShareModal = true;
}

async function shareAndCopyLink() {
	if (!shareModalSessionId) return;
	shareModalError = "";
	shareModalSaving = true;
	try {
		await createSessionPermission(shareModalSessionId, "read");
		await loadPermissions(true);
		notifyPermissionsUpdate();
		const url = `${window.location.origin}/runtimes/${runtimeId}?session=${shareModalSessionId}`;
		await navigator.clipboard.writeText(url);
		shareCopied = true;
		if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
		shareCopiedTimer = setTimeout(() => { shareCopied = false; }, 2000);
		showShareModal = false;
	} catch (error) {
		shareModalError = error instanceof Error ? error.message : "Failed to share session";
	} finally {
		shareModalSaving = false;
	}
}

async function makeSessionPrivate() {
	if (!shareModalSessionId) return;
	shareModalError = "";
	shareModalSaving = true;
	try {
		await createSessionPermission(shareModalSessionId, "private");
		await loadPermissions(true);
		notifyPermissionsUpdate();
		showShareModal = false;
	} catch (error) {
		shareModalError = error instanceof Error ? error.message : "Failed to make session private";
	} finally {
		shareModalSaving = false;
	}
}

async function removeSessionPermission(sessionId: string): Promise<boolean> {
	try {
		sessionPermError = "";
		await deleteSessionPermission(sessionId);
		await loadPermissions(true);
		notifyPermissionsUpdate();
		return true;
	} catch (error) {
		sessionPermError = error instanceof Error ? error.message : "Failed to remove permission";
		setTimeout(() => { sessionPermError = ""; }, 4000);
		return false;
	}
}

function hasSessionPermission(sessionId: string): boolean {
	return runtimePermissions.some(
		(p) => p.resourceType === "session" && p.resourceId === sessionId && p.level !== "private",
	);
}

// ─── Collaborators ───

async function loadCollaborators(force = false) {
	if (!force && collaboratorsLoaded) return;
	loadingCollaborators = true;
	try {
		const perms = await listRuntimeCollaborators(runtimeId);
		runtimeCollaborators = perms;
		collaboratorsLoaded = true;
	} catch {
		// ignore — collaborator endpoint requires auth; anonymous users stay read-only
	} finally {
		loadingCollaborators = false;
	}
}

async function handleAddCollaborator() {
	if (!addingCollaboratorUuid.trim() || savingCollaborator) return;
	savingCollaborator = true;
	addingCollaboratorError = "";
	try {
		await addRuntimeCollaborator(runtimeId, addingCollaboratorUuid.trim(), addingCollaboratorLevel);
		addingCollaboratorUuid = "";
		await loadCollaborators(true);
		notifyPermissionsUpdate();
	} catch (error) {
		addingCollaboratorError = error instanceof Error ? error.message : "Failed to add collaborator";
	} finally {
		savingCollaborator = false;
	}
}

async function handleUpdateCollaboratorLevel(granteeUuid: string, level: "read" | "write") {
	try {
		await updateRuntimeCollaborator(runtimeId, granteeUuid, level);
		await loadCollaborators(true);
		notifyPermissionsUpdate();
	} catch (error) {
		addingCollaboratorError = error instanceof Error ? error.message : "Failed to update collaborator";
	}
}

async function handleRemoveCollaborator(granteeUuid: string) {
	try {
		await removeRuntimeCollaborator(runtimeId, granteeUuid);
		await loadCollaborators(true);
		notifyPermissionsUpdate();
	} catch (error) {
		addingCollaboratorError = error instanceof Error ? error.message : "Failed to remove collaborator";
	}
}

// ─── SSE streaming (per-session) ───

const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 15000;
const HIDDEN_TAB_MIN_RECONNECT_DELAY_MS = 5000;

function clearStreamingState() {
	streamingAssistantText = "";
	streamingThinking = "";
	streamingContentBlocks = [];
	streamingSessionId = null;
}

function clearReconnectTimer(sessionId: string) {
	const timer = sessionReconnectTimers.get(sessionId);
	if (timer) {
		clearTimeout(timer);
		sessionReconnectTimers.delete(sessionId);
	}
}

function shouldKeepSessionSSE(sessionId: string) {
	return pageMounted && pageOnline && activeSessionId === sessionId;
}

function scheduleSessionReconnect(sessionId: string) {
	if (!shouldKeepSessionSSE(sessionId)) return;
	if (sessionSSEs.has(sessionId) || sessionReconnectTimers.has(sessionId)) return;

	const attempt = (sessionReconnectAttempts.get(sessionId) ?? 0) + 1;
	sessionReconnectAttempts.set(sessionId, attempt);

	const expDelay = Math.min(
		BASE_RECONNECT_DELAY_MS * 2 ** Math.max(0, attempt - 1),
		MAX_RECONNECT_DELAY_MS,
	);
	const delay = pageVisible
		? expDelay
		: Math.max(expDelay, HIDDEN_TAB_MIN_RECONNECT_DELAY_MS);

	const timer = setTimeout(() => {
		sessionReconnectTimers.delete(sessionId);
		if (shouldKeepSessionSSE(sessionId)) {
			connectSessionSSE(sessionId);
		}
	}, delay);

	sessionReconnectTimers.set(sessionId, timer);
}

function ensureSessionSSE(sessionId: string) {
	clearReconnectTimer(sessionId);
	if (!shouldKeepSessionSSE(sessionId)) return;
	if (sessionSSEs.has(sessionId)) return;
	connectSessionSSE(sessionId);
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
			const hasStreamingContent = event.content.length > 0;
			if (hasStreamingContent) {
				if (streamingSessionId !== currentActiveSessionId) {
					streamingSessionId = currentActiveSessionId;
					notifyStreamingStatus(currentActiveSessionId, true);
				}
				// No manual scroll needed: column-reverse + scroll anchoring keeps
				// the view pinned to the bottom automatically.
			}

			if (event.turnEnd) {
				// Sync with persisted server messages. Use a retry loop because
				// the agent enqueues persistence asynchronously — turnEnd may
				// fire before DB writes complete.
				const state = sessionStateById[currentActiveSessionId];
				let newMessages: MessageRecord[] = [];
				let updatedSession = state?.session;

				try {
					const prevSeq = state?.messages.length >= 2
						? state.messages.at(-2)?.sequence ?? 0
						: 0;

					// Retry up to 3 times with 300ms backoff to give the agent's
					// persistence queue time to flush to the API database.
					for (let attempt = 1; attempt <= 3; attempt++) {
						const response = await getSessionMessagesPaginated(currentActiveSessionId, {
							cursor: prevSeq,
							direction: "newer",
							limit: 100,
						});
						if (response.messages.length > 0) {
							newMessages = response.messages;
							updatedSession = response.session;
							break;
						}
						if (attempt < 3) {
							await new Promise((r) => setTimeout(r, 300));
						}
					}

					// Fallback: if retry didn't find messages, the agent's persistence
					// may still be writing (especially for turns with many tool calls).
					// Wait longer then fetch latest messages directly.
					if (newMessages.length === 0) {
						await new Promise((r) => setTimeout(r, 2000));
						const response = await getSessionMessagesPaginated(currentActiveSessionId, {
							limit: 100,
						});
						if (response.messages.length > 0) {
							newMessages = response.messages;
							updatedSession = response.session;
						}
					}

					// Update cache with server-persisted messages (user + assistant).
					if (newMessages.length > 0) {
						await messageCache.append(currentActiveSessionId, newMessages);
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

				// Merge new messages with existing ones, replacing optimistic copies with persisted versions.
				const existingMessages = state?.messages ?? [];
				const merged = mergeMessagesById(existingMessages, newMessages, {
					preferIncoming: true,
				});

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

				// column-reverse + scroll anchoring keeps the view pinned to
				// the bottom automatically — no manual scroll needed.
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
	clearReconnectTimer(sessionId);
	if (!shouldKeepSessionSSE(sessionId)) return;

	const abort = new AbortController();
	sessionSSEs.set(sessionId, abort);
	const lastEventId = sessionLastEventIds.get(sessionId);

	(async () => {
		let shouldReconnect = true;
		try {
			for await (const packet of streamSessionEvents(
				sessionId,
				lastEventId,
				abort.signal,
			)) {
				if (packet.id) {
					sessionLastEventIds.set(sessionId, packet.id);
				}
				sessionReconnectAttempts.set(sessionId, 0);
				eventQueue.push(packet.event);
				void processEventQueue();
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") {
				shouldReconnect = false;
				return;
			}
			console.error(`[SSE] Session ${sessionId} stream error:`, error);
		} finally {
			sessionSSEs.delete(sessionId);
			if (shouldReconnect && shouldKeepSessionSSE(sessionId)) {
				scheduleSessionReconnect(sessionId);
			}
		}
	})();
}

// Disconnect SSE for a specific session
function disconnectSessionSSE(sessionId: string) {
	clearReconnectTimer(sessionId);
	const existing = sessionSSEs.get(sessionId);
	if (existing) {
		existing.abort();
		sessionSSEs.delete(sessionId);
	}
}

// Disconnect all SSE connections
function disconnectAllSSE() {
	for (const timer of sessionReconnectTimers.values()) {
		clearTimeout(timer);
	}
	sessionReconnectTimers.clear();
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
		// Get server-assigned userMessageId BEFORE showing optimistic message
		const model = activeSessionModel;
		const result = await postSessionMessage(sessionId, content, {
			model: model?.id,
			provider: model?.provider,
		});
		const userMessageId = result?.userMessageId;

		input = "";
		imageAttachments = [];
		clearStreamingState();

		const currentState = sessionStateById[sessionId];
		if (currentState) {
			const optimisticMessage = {
				id: userMessageId || `optimistic-user-${Date.now()}`,
				sessionId,
				role: "user" as const,
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
				meta: null,
				createdAt: new Date().toISOString(),
			} satisfies MessageRecord;

			sessionStateById = {
				...sessionStateById,
				[sessionId]: {
					...currentState,
					messages: [...currentState.messages, optimisticMessage],
				},
			};

			// Persist optimistic user message to IndexedDB immediately so it
			// survives page reload. Without this, turnEnd's server-side fetch
			// (sequence > cursor) skips it, and the cache ends up missing the
			// user message permanently.
			await messageCache.append(sessionId, [optimisticMessage]);
		}
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

// In column-reverse: scrollTop=0 is the visual bottom. The browser's scroll
// anchoring automatically keeps the view pinned as content grows.
function scrollToBottom() {
	if (!listEl) return;
	try {
		listEl.scrollTop = 0;
	} catch {
		// Element may have been detached between the null check and assignment
	}
	hasScrolledUp = false;
}

function updateScrollState() {
	if (!listEl) return;
	// In column-reverse, the anchor edge is the start (scrollTop=0 = bottom).
	// If the user has scrolled away from 0, they've scrolled "up" visually.
	// Only write to $state when the value actually changes to avoid unnecessary
	// Svelte reactivity updates on every scroll event tick.
	const threshold = 80;
	const scrolledUp = listEl.scrollTop > threshold;
	if (scrolledUp !== hasScrolledUp) {
		hasScrolledUp = scrolledUp;
	}
	const shouldShow = hasScrolledUp && listEl.scrollHeight > listEl.clientHeight + 24;
	if (shouldShow !== showScrollToBottom) {
		showScrollToBottom = shouldShow;
	}
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

function beginRightSidebarResize(event: PointerEvent) {
	event.preventDefault();
	if (window.innerWidth < 1280 || uiState.rightSidebarCollapsed) return;

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
		if (rightSidebarResizeCleanup === stop) {
			rightSidebarResizeCleanup = null;
		}
	};

	rightSidebarResizeCleanup = stop;
	document.body.classList.add("sidebar-resizing");
	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", stop);
	window.addEventListener("pointercancel", stop);
}

// ─── Mobile right drawer gestures (mirrors left-drawer logic in +layout.svelte) ───

let rightDrawerGesturePhase = $state<DrawerGesturePhase>("idle");
let rightDrawerGestureDirection = $state<DrawerGestureDirection>(null);
let rightDrawerActiveTouchId = $state<number | null>(null);
let rightDrawerPointerStartX = $state(0);
let rightDrawerPointerStartY = $state(0);
let rightDrawerLastPointerX = $state(0);
let rightDrawerLastPointerTime = $state(0);
let rightDrawerDragOffsetPx = $state(0);
let rightDrawerVelocityX = $state(0);
let rightDrawerIsDragging = $state(false);
let rightDrawerIsVisible = $state(false);

function rightDrawerResetGesture() {
	rightDrawerGesturePhase = "idle";
	rightDrawerGestureDirection = null;
	rightDrawerActiveTouchId = null;
	rightDrawerPointerStartX = 0;
	rightDrawerPointerStartY = 0;
	rightDrawerLastPointerX = 0;
	rightDrawerLastPointerTime = 0;
	rightDrawerDragOffsetPx = 0;
	rightDrawerVelocityX = 0;
	rightDrawerIsDragging = false;
}

function rightDrawerFindTrackedTouch(touches: TouchList) {
	if (rightDrawerActiveTouchId === null) return null;
	for (const touch of Array.from(touches)) {
		if (touch.identifier === rightDrawerActiveTouchId) return touch;
	}
	return null;
}

function rightDrawerBeginSettling(open: boolean) {
	rightDrawerGesturePhase = "settling";
	uiState.mobileRightDrawerOpen = open;
	rightDrawerIsDragging = false;
	rightDrawerActiveTouchId = null;
	rightDrawerGestureDirection = null;
	rightDrawerVelocityX = 0;
	rightDrawerLastPointerTime = 0;
	rightDrawerLastPointerX = 0;
	rightDrawerPointerStartX = 0;
	rightDrawerPointerStartY = 0;
}

function rightDrawerHandleTouchStart(e: TouchEvent) {
	if (window.innerWidth >= 1024 || rightDrawerActiveTouchId !== null) return;
	const touch = e.changedTouches[0];
	if (!touch) return;

	if (
		!shouldStartRightDrawerGesture({
			isOpen: uiState.mobileRightDrawerOpen,
			target: e.target,
			viewportWidth: window.innerWidth,
			touchStartX: touch.clientX,
			otherDrawerOpen: uiState.mobileDrawerOpen,
		})
	) {
		return;
	}

	rightDrawerActiveTouchId = touch.identifier;
	rightDrawerGesturePhase = "tracking";
	rightDrawerGestureDirection = null;
	rightDrawerPointerStartX = touch.clientX;
	rightDrawerPointerStartY = touch.clientY;
	rightDrawerLastPointerX = touch.clientX;
	rightDrawerLastPointerTime = e.timeStamp;
	rightDrawerDragOffsetPx = uiState.mobileRightDrawerOpen ? MOBILE_DRAWER_WIDTH_PX : 0;
	rightDrawerVelocityX = 0;
	rightDrawerIsDragging = false;
}

function rightDrawerHandleTouchMove(e: TouchEvent) {
	const touch = rightDrawerFindTrackedTouch(e.touches);
	if (!touch) return;

	const dx = touch.clientX - rightDrawerPointerStartX;
	const dy = touch.clientY - rightDrawerPointerStartY;
	const absDx = Math.abs(dx);
	const absDy = Math.abs(dy);

	if (rightDrawerGestureDirection === null) {
		const resolvedDirection = resolveDrawerGestureDirection({ absDx, absDy });
		if (resolvedDirection === null) return;
		if (resolvedDirection === "vertical") {
			rightDrawerResetGesture();
			return;
		}
		rightDrawerGestureDirection = resolvedDirection;
	}

	const deltaTime = Math.max(e.timeStamp - rightDrawerLastPointerTime, 1);
	rightDrawerVelocityX = (touch.clientX - rightDrawerLastPointerX) / deltaTime;
	rightDrawerLastPointerX = touch.clientX;
	rightDrawerLastPointerTime = e.timeStamp;

	const nextOffsetPx = getRightDrawerOffsetFromDrag({
		isOpen: uiState.mobileRightDrawerOpen,
		deltaX: dx,
	});

	if (!uiState.mobileRightDrawerOpen && nextOffsetPx <= 0) return;
	// When open, positive deltaX (swipe right towards edge) reduces offset;
	// negative deltaX (swipe left into screen) increases offset, capped at max.
	if (uiState.mobileRightDrawerOpen && nextOffsetPx >= MOBILE_DRAWER_WIDTH_PX && dx <= 0) return;

	rightDrawerIsDragging = true;
	rightDrawerDragOffsetPx = nextOffsetPx;
	rightDrawerGesturePhase = uiState.mobileRightDrawerOpen ? "dragging-close" : "dragging-open";

	if (e.cancelable) {
		e.preventDefault();
	}
}

function rightDrawerFinalizeGesture() {
	if (!rightDrawerIsDragging) {
		rightDrawerResetGesture();
		return;
	}

	const shouldOpen = uiState.mobileRightDrawerOpen
		? shouldKeepRightDrawerOpen({ offsetPx: rightDrawerDragOffsetPx, velocityX: rightDrawerVelocityX })
		: shouldOpenRightDrawer({ offsetPx: rightDrawerDragOffsetPx, velocityX: rightDrawerVelocityX });

	rightDrawerBeginSettling(shouldOpen);
}

function rightDrawerHandleTouchEnd(e: TouchEvent) {
	const touch = rightDrawerFindTrackedTouch(e.changedTouches);
	if (!touch) return;
	rightDrawerFinalizeGesture();
}

function rightDrawerHandleTouchCancel(e: TouchEvent) {
	const touch = rightDrawerFindTrackedTouch(e.changedTouches);
	if (!touch) return;
	rightDrawerFinalizeGesture();
}

onMount(() => {
	uiState.loadLayoutPrefs();
	pageMounted = true;
	pageVisible = document.visibilityState === "visible";
	pageOnline = typeof navigator === "undefined" ? true : navigator.onLine;
	// Preload model catalog so the composer shows a default model immediately
	void loadModelsCatalog();
	void authStore.ensureLoaded().then(() => {
		if (runtime) {
			isOwner = runtime.userUuid === authStore.userUuid;
		}
	});

	function handleVisibilityChange() {
		pageVisible = document.visibilityState === "visible";
		if (activeSessionId && pageVisible) {
			ensureSessionSSE(activeSessionId);
		}
	}

	function handleOnline() {
		pageOnline = true;
		if (activeSessionId) {
			ensureSessionSSE(activeSessionId);
		}
	}

	function handleOffline() {
		pageOnline = false;
		if (activeSessionId) {
			disconnectSessionSSE(activeSessionId);
		}
	}

	window.addEventListener("online", handleOnline);
	window.addEventListener("offline", handleOffline);
	window.addEventListener("keydown", handleFileKeyboardSave);
	document.addEventListener("visibilitychange", handleVisibilityChange);

	// Mobile right drawer touch gestures
	function onRightDrawerTouchStart(e: TouchEvent) {
		rightDrawerHandleTouchStart(e);
	}
	function onRightDrawerTouchMove(e: TouchEvent) {
		rightDrawerHandleTouchMove(e);
	}
	function onRightDrawerTouchEnd(e: TouchEvent) {
		rightDrawerHandleTouchEnd(e);
	}
	function onRightDrawerTouchCancel(e: TouchEvent) {
		rightDrawerHandleTouchCancel(e);
	}

	document.addEventListener("touchstart", onRightDrawerTouchStart, { passive: true });
	document.addEventListener("touchmove", onRightDrawerTouchMove, { passive: false });
	document.addEventListener("touchend", onRightDrawerTouchEnd, { passive: true });
	document.addEventListener("touchcancel", onRightDrawerTouchCancel, { passive: true });

	// Initialize broadcast channel for cross-component communication
	try {
		broadcastChannel = new BroadcastChannel(`cohub:runtime:${runtimeId}`);
	} catch {
		// BroadcastChannel not supported, fallback to window events
	}

	void loadRuntime({ force: true }).finally(() => {
		void loadFileTree(true);
		if (authStore.isAuthenticated) {
			void loadPermissions(true).finally(() => {
				bootstrapping = false;
			});
		} else {
			bootstrapping = false;
		}
	});

	// Polling is handled by the $effect below to avoid competing timer
	// mechanisms. The $effect re-schedules whenever runtime state changes,
	// so no recursive self-scheduling is needed here.

	return () => {
		rightSidebarResizeCleanup?.();
		document.body.classList.remove("sidebar-resizing");
		pageMounted = false;
		if (runtimePollingTimer) clearTimeout(runtimePollingTimer);
		window.removeEventListener("online", handleOnline);
		window.removeEventListener("offline", handleOffline);
		window.removeEventListener("keydown", handleFileKeyboardSave);
		document.removeEventListener("visibilitychange", handleVisibilityChange);
		// Mobile right drawer gesture cleanup
		document.removeEventListener("touchstart", onRightDrawerTouchStart);
		document.removeEventListener("touchmove", onRightDrawerTouchMove);
		document.removeEventListener("touchend", onRightDrawerTouchEnd);
		document.removeEventListener("touchcancel", onRightDrawerTouchCancel);
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
	for (const [id] of sessionReconnectTimers) {
		if (id !== currentId) {
			clearReconnectTimer(id);
		}
	}

	// Ensure the active session always has exactly one live stream or pending reconnect
	if (currentId) {
		ensureSessionSSE(currentId);
	}

	// Clear streaming state when switching sessions
	if (prevActiveSessionId && prevActiveSessionId !== currentId) {
		clearStreamingState();
	}
	prevActiveSessionId = currentId;
});

// Sync mobile right drawer visibility + settling animation
$effect(() => {
	if (rightDrawerGesturePhase === "settling") {
		// Keep visible during settle animation
		rightDrawerIsVisible = true;
		return;
	}
	if (uiState.mobileRightDrawerOpen || rightDrawerIsDragging) {
		rightDrawerIsVisible = true;
		return;
	}
	rightDrawerIsVisible = false;
});

$effect(() => {
	if (rightDrawerGesturePhase !== "settling") return;

	const timer = window.setTimeout(() => {
		if (rightDrawerGesturePhase === "settling") {
			rightDrawerGesturePhase = "idle";
			if (!uiState.mobileRightDrawerOpen) {
				rightDrawerDragOffsetPx = 0;
			}
		}
	}, 220);

	return () => window.clearTimeout(timer);
});

// Lock body scroll when right drawer is open
$effect(() => {
	if (uiState.mobileRightDrawerOpen || rightDrawerIsDragging) {
		document.body.classList.add("drawer-open");
	} else {
		document.body.classList.remove("drawer-open");
	}
});

// Close mobile right drawer on Escape
$effect(() => {
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && uiState.mobileRightDrawerOpen) {
			uiState.mobileRightDrawerOpen = false;
		}
	}
	window.addEventListener("keydown", handleKeydown);
	return () => window.removeEventListener("keydown", handleKeydown);
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

// Scroll position tracking — detect when user has scrolled away from bottom.
// In column-reverse, scrollTop=0 is the visual bottom, so any positive
// scrollTop means the user has scrolled "up" to see older messages.
$effect(() => {
	const el = listEl;
	if (!el) return;

	function handleScroll() {
		updateScrollState();
	}

	el.addEventListener("scroll", handleScroll, { passive: true });
	return () => el.removeEventListener("scroll", handleScroll);
});

// On session data ready: snap to bottom on first visit.
// With column-reverse + scroll anchoring, scrollTop=0 pins to the bottom
// automatically. No manual positioning needed beyond that.
let prevSessionForScroll = $state<string | null>(null);

$effect(() => {
	const sessionId = activeSessionId;
	if (!sessionId || !listEl) return;

	const state = sessionStateById[sessionId];
	if (!state?.loaded) return;

	// Only snap to bottom on first visit to this session (not on re-renders)
	if (prevSessionForScroll !== sessionId) {
		prevSessionForScroll = sessionId;
		requestAnimationFrame(() => {
			if (listEl) {
				listEl.scrollTop = 0;
				hasScrolledUp = false;
				updateScrollState();
			}
		});
	}
});

$effect(() => {
	if (showSettings && !runtimeStore.hasLoadedChannels(runtimeId) && !loadingChannels) {
		loadingChannels = true;
		void runtimeStore.ensureRuntimeChannels(runtimeId).then((channels) => {
			runtimeChannels = channels;
		}).finally(() => {
			loadingChannels = false;
		});
	}
	if (showSettings && authStore.isAuthenticated && !runtimePermissionsLoaded && !loadingPermissions) {
		loadingPermissions = true;
		void loadPermissions().finally(() => {
			loadingPermissions = false;
		});
	}
	// Load collaborators for owner (to manage them) and for non-owners
	// (so canWrite derivation knows if they have write access).
	if (authStore.isAuthenticated && !collaboratorsLoaded && !loadingCollaborators) {
		loadingCollaborators = true;
		void loadCollaborators().finally(() => {
			loadingCollaborators = false;
		});
	}
});

$effect(() => {
	if (runtimePollingTimer) {
		clearTimeout(runtimePollingTimer);
		runtimePollingTimer = null;
	}
	if (!shouldPollRuntime(runtime)) return;
	const timer = setTimeout(async () => {
		// Don't use force:true for polling — the store's shouldRefresh
		// checks are sufficient and prevent request storms when multiple
		// consumers (sidebar, page) poll simultaneously.
		await loadRuntime();
	}, getRuntimePollInterval(runtime));
	runtimePollingTimer = timer;
	return () => {
		clearTimeout(timer);
		if (runtimePollingTimer === timer) {
			runtimePollingTimer = null;
		}
	};
});
</script>

<!-- Runtime Header -->
<PageHeader>
  {#snippet left()}
    <div class="flex items-center gap-2 min-w-0">
      <Terminal class="w-3.5 h-3.5 text-text-tertiary shrink-0 hidden sm:block" />
      <span class="text-[13px] text-text-primary truncate">{runtime?.title || runtime?.id || runtimeId}</span>
      {#if runtime}
        <div class="hidden md:flex items-center gap-1.5 ml-1 px-1.5 py-0.5 rounded-sm bg-bg-hover border border-border-subtle shrink-0">
          <div class="w-[5px] h-[5px] rounded-full bg-current {getRuntimeStatusMeta(runtime.status).textColorClass}"></div>
          <span class="text-[10px] uppercase tracking-wider font-medium text-text-secondary">
            {runtime.status}
          </span>
        </div>
      {/if}
    </div>
  {/snippet}
  {#snippet right()}
    {#if canWrite}
    <button
      type="button"
      class="flex items-center gap-1.5 px-2 h-8 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100 disabled:opacity-50"
      onclick={() => handleCreateNewSession()}
      disabled={creatingSession || !runtime}
      title="New session"
    >
      {#if creatingSession}
        <div class="w-3.5 h-3.5 rounded-full border-2 border-border-subtle border-t-brand animate-spin shrink-0"></div>
      {:else}
        <Plus class="w-4 h-4 shrink-0" />
      {/if}
      <span class="hidden lg:inline text-[13px] font-medium">New session</span>
    </button>
    {/if}

    <!-- Session Share -->
    {#if activeSessionId && isOwner}
      {@const isPublic = hasSessionPermission(activeSessionId)}
      <button
        type="button"
        class="flex items-center gap-1.5 px-2 h-8 rounded-[5px] transition-colors duration-100 {isPublic ? 'text-success-soft hover:text-success hover:bg-success-bg' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
        onclick={() => { openShareModal(activeSessionId!); }}
        title={isPublic ? 'Session is public' : 'Share session'}
      >
        {#if isPublic}
          <Globe class="w-4 h-4 shrink-0" />
          <span class="hidden lg:inline text-[13px] font-medium">Shared</span>
        {:else}
          <Share2 class="w-4 h-4 shrink-0" />
          <span class="hidden lg:inline text-[13px] font-medium">Share</span>
        {/if}
      </button>
    {/if}

    <!-- More menu (owner only) -->
    {#if isOwner}
    <div class="relative" data-more-menu>
      <button
        type="button"
        class="flex items-center justify-center w-8 h-8 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
        onclick={() => showMoreMenu = !showMoreMenu}
        title="More"
      >
        <MoreVertical class="w-4 h-4" />
      </button>

      {#if showMoreMenu}
        <div
          class="absolute right-0 top-full mt-1 w-48 bg-bg-primary border border-border-subtle rounded-md shadow-lg overflow-hidden z-50"
        >
          {#if isOwner}
          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            onclick={() => { showSettings = true; showMoreMenu = false; }}
          >
            <Settings class="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>
          {/if}

          {#if isOwner && (getRuntimeStatusMeta(runtime?.status).canHibernate || getRuntimeStatusMeta(runtime?.status).canWake || getRuntimeStatusMeta(runtime?.status).canDelete)}
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
    {/if}

    <!-- Toggle right sidebar -->
    <div class="relative">
      <button
        type="button"
        class="flex items-center gap-1.5 px-2 h-8 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
        onclick={() => {
          if (!canWrite) {
            triggerNoWriteHint();
            return;
          }
          if (window.innerWidth < 1024) {
            uiState.mobileRightDrawerOpen = !uiState.mobileRightDrawerOpen;
          } else {
            uiState.toggleRightSidebarCollapsed();
          }
        }}
        title={uiState.rightSidebarCollapsed ? "Show files" : "Hide files"}
        aria-label={uiState.rightSidebarCollapsed ? "Show files" : "Hide files"}
      >
        {#if uiState.rightSidebarCollapsed}
          <PanelRightOpen class="w-4 h-4 shrink-0" />
          <span class="hidden 2xl:inline text-[13px] font-medium">Show files</span>
        {:else}
          <PanelRightClose class="w-4 h-4 shrink-0" />
          <span class="hidden 2xl:inline text-[13px] font-medium">Hide files</span>
        {/if}
      </button>

      <!-- No-write-permission hint -->
      {#if showNoWriteHint}
        <div class="hint-toast">
          <span>Read-only — you don't have write access to this runtime</span>
        </div>
      {/if}
    </div>
  {/snippet}
</PageHeader>

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
    {#if fileMode === 'file'}
      <!-- File Viewer -->
      {#if openFileLoading}
        <div class="flex-1 flex items-center justify-center text-[12px] text-text-tertiary">Loading file...</div>
      {:else if openFileError}
        <div class="m-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
          {openFileError}
        </div>
      {:else if openFileTooLarge}
        <!-- File too large: show info + download -->
        <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
            <div class="min-w-0 flex-1 truncate text-[11px] sm:text-[12px] text-text-secondary">
              {urlFilePath}
            </div>
            <a
              href={openFileDownloadUrl}
              download={openFileDownloadName}
              class="download-btn"
              title="Download file"
            >
              <Download class="w-3.5 h-3.5 shrink-0" />
              <span class="hidden sm:inline">Download</span>
            </a>
            <button type="button" class="icon-btn" onclick={closeFile} title="Close file">
              <X class="w-4 h-4" />
            </button>
          </div>
          <div class="flex-1 flex items-center justify-center">
            <div class="m-4 rounded-lg border border-warning-soft/30 bg-warning-bg p-6 text-center max-w-sm">
              <div class="text-[40px] mb-3">📦</div>
              <div class="text-[14px] font-semibold text-text-primary mb-1">File too large to preview</div>
              <div class="text-[12px] text-text-secondary mb-4">This file exceeds 10MB and cannot be opened in the web editor.</div>
              <a
                href={openFileDownloadUrl}
                download={openFileDownloadName}
                class="download-btn primary"
              >
                <Download class="w-3.5 h-3.5" />
                Download file
              </a>
            </div>
          </div>
        </div>
      {:else if openFile}
        {@const dataUrl = openFile.kind === 'binary' ? `data:${openFile.mimeType ?? 'application/octet-stream'};base64,${openFile.content}` : null}
        <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
          {#if openFileIsText}
            <!-- Text file: toolbar with edit/preview toggle + save/close -->
            <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
              <div class="min-w-0 flex-1 truncate text-[11px] sm:text-[12px] text-text-secondary">
                {openFile.path}
              </div>
              {#if openFileIsMarkdown}
                <button
                  type="button"
                  class="toggle-btn"
                  class:active={!fileEdit}
                  onclick={() => fileEdit = false}
                  title="Preview"
                >
                  <Eye class="w-3.5 h-3.5" />
                  <span class="hidden sm:inline">Preview</span>
                </button>
                <button
                  type="button"
                  class="toggle-btn"
                  class:active={fileEdit}
                  onclick={() => fileEdit = true}
                  title="Edit"
                >
                  <Pencil class="w-3.5 h-3.5" />
                  <span class="hidden sm:inline">Edit</span>
                </button>
              {/if}
              <a
                href={openFileDownloadUrl}
                download={openFileDownloadName}
                class="icon-btn"
                title="Download file"
              >
                <Download class="w-4 h-4" />
              </a>
              <button
                type="button"
                class="action-btn"
                onclick={saveOpenFile}
                disabled={openFileSaving || !fileDirty}
                title="Save (Ctrl+S)"
              >
                <Save class="w-3.5 h-3.5 shrink-0" />
                <span class="hidden sm:inline">Save</span>
              </button>
              <button type="button" class="icon-btn" onclick={closeFile} title="Close file">
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="flex-1 min-h-0">
              {#if fileEdit}
                <CodeEditor
                  value={openFileDraft}
                  language={openFileExt}
                  onInput={(v) => openFileDraft = v}
                />
              {:else if openFileIsMarkdown && fileMarkdownHtml}
                <article class="markdown-preview">{@html fileMarkdownHtml}</article>
              {:else}
                <CodeEditor
                  value={openFileDraft}
                  language={openFileExt}
                  readonly={true}
                />
              {/if}
            </div>
          {:else if openFileIsImage && dataUrl}
            <!-- Image: info toolbar + image preview -->
            <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
              <div class="min-w-0 flex-1 truncate text-[11px] sm:text-[12px] text-text-secondary">
                {openFile.path}
              </div>
              <div class="text-[11px] text-text-tertiary hidden sm:inline">{openFile.size} bytes</div>
              <a
                href={openFileDownloadUrl}
                download={openFileDownloadName}
                class="icon-btn"
                title="Download file"
              >
                <Download class="w-4 h-4" />
              </a>
              <button type="button" class="icon-btn" onclick={closeFile} title="Close file">
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="flex flex-1 items-center justify-center p-4">
              <img src={dataUrl} alt={openFile.name} class="max-h-full max-w-full rounded-md object-contain" />
            </div>
          {:else if openFileIsVideo && dataUrl}
            <!-- Video: info toolbar + video preview -->
            <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
              <div class="min-w-0 flex-1 truncate text-[11px] sm:text-[12px] text-text-secondary">
                {openFile.path}
              </div>
              <div class="text-[11px] text-text-tertiary hidden sm:inline">{openFile.size} bytes</div>
              <a
                href={openFileDownloadUrl}
                download={openFileDownloadName}
                class="icon-btn"
                title="Download file"
              >
                <Download class="w-4 h-4" />
              </a>
              <button type="button" class="icon-btn" onclick={closeFile} title="Close file">
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="flex flex-1 items-center justify-center p-4">
              <video src={dataUrl} controls class="max-h-full max-w-full rounded-md">
                <track kind="captions" />
              </video>
            </div>
          {:else}
            <!-- Binary/unknown: info toolbar + fallback -->
            <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
              <div class="min-w-0 flex-1 truncate text-[11px] sm:text-[12px] text-text-secondary">
                {openFile.path}
              </div>
              <div class="text-[11px] text-text-tertiary hidden sm:inline">{openFile.size} bytes</div>
              <a
                href={openFileDownloadUrl}
                download={openFileDownloadName}
                class="icon-btn"
                title="Download file"
              >
                <Download class="w-4 h-4" />
              </a>
              <button type="button" class="icon-btn" onclick={closeFile} title="Close file">
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="m-4 rounded-md border border-border-subtle bg-bg-primary p-4 text-[12px] text-text-secondary">
              <div><strong>Name:</strong> {openFile.name}</div>
              <div><strong>Type:</strong> {openFile.mimeType ?? 'application/octet-stream'}</div>
              <div><strong>Size:</strong> {openFile.size} bytes</div>
              <div class="mt-3 text-text-tertiary">This file type cannot be previewed in the browser.</div>
            </div>
          {/if}
        </div>
      {/if}
    {:else}
      <!-- Chat -->
      {#if bootstrapping && !activeSessionState}
        <div class="flex-1 flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-text-tertiary">
            <div class="w-7 h-7 rounded-full border-2 border-border-subtle border-t-brand animate-spin"></div>
            <div class="text-[12px]">Loading runtime…</div>
          </div>
        </div>
      {:else if !activeSessionState}
        <div class="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-4">
          <div class="text-[14px]">No session selected</div>
          {#if canWrite}
          <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-2 rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary transition-colors duration-100 disabled:opacity-50"
            onclick={() => handleCreateNewSession()}
            disabled={creatingSession || !runtime}
          >
            <Plus class="w-3.5 h-3.5" />
            Create a session
          </button>
          {/if}
        </div>
      {:else if activeSessionState.loading && !activeSessionState.loaded}
        <div class="flex-1 flex items-center justify-center">
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
            timeline={timeline}
            preloadThreshold={10}
            onFirstVisible={handleFirstVisible}
            loadingOlder={activeSessionState?.loadingOlder ?? false}
          />

          {#if showScrollToBottom && timeline.length > 0}
            <button
              type="button"
              class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-elevated/92 px-3 py-1.5 text-[12px] text-text-secondary shadow-lg backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-bg-hover-strong hover:text-text-primary animate-in fade-in slide-in-from-bottom-2 duration-200"
              onclick={() => scrollToBottom()}
            >
              <ArrowDown class="w-3.5 h-3.5" />
              <span>Scroll to bottom</span>
            </button>
          {/if}

          <SessionComposer
            bind:value={input}
            disabled={sending || !activeSessionState || !getRuntimeStatusMeta(runtime?.status).canSend}
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
    {/if}
  </div>

  {#if !uiState.rightSidebarCollapsed}
    <div class="hidden shrink-0 xl:block relative border-l border-border-subtle" style={`width: ${uiState.rightSidebarWidth}px`}>
      <RuntimeFileSidebar
        nodes={fileTree}
        selectedPath={urlFilePath ?? ""}
        loading={fileTreeLoading}
        error={fileTreeError}
        onToggle={handleFileToggle}
        onSelect={handleFileSelect}
        onRefresh={refreshFileTree}
        onCreateFile={handleCreateFile}
        onCreateDir={handleCreateDir}
        onRename={handleRenameNode}
        onDelete={handleDeleteNode}
        canWrite={canWrite}
      />
      <button
        type="button"
        class="right-sidebar-resize-handle"
        aria-label="Resize files sidebar"
        title="Resize files sidebar"
        onpointerdown={beginRightSidebarResize}
      ></button>
    </div>
  {/if}

  <!-- Settings Overlay (desktop: right drawer, mobile: bottom sheet) -->
  <SettingsOverlay open={showSettings} onClose={() => showSettings = false}>
    <div class="p-4 space-y-6">
      <!-- Sharing section -->
      <section class="space-y-3">
        <div class="text-[10px] font-bold text-text-tertiary uppercase tracking-widest flex items-center justify-between">
          <span>Sharing</span>
        </div>

        <!-- Runtime-level toggle -->
        <label class="flex items-start gap-3 cursor-pointer group p-2 rounded-[5px] hover:bg-bg-hover transition-colors">
          <div class="relative shrink-0 mt-0.5">
            <input
              type="checkbox"
              checked={runtimePublicRead}
              onchange={(event) => { void toggleRuntimePublicRead((event.currentTarget as HTMLInputElement).checked); }}
              disabled={savingRuntimePerm}
              class="sr-only peer"
            />
            <div class="w-8 h-[18px] rounded-full bg-bg-hover-strong peer-checked:bg-brand transition-colors duration-150"></div>
            <div class="absolute left-0.5 top-0.5 w-[13px] h-[13px] rounded-full bg-text-tertiary peer-checked:bg-white peer-checked:left-[15px] transition-all duration-150"></div>
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-[13px] text-text-secondary group-hover:text-text-primary transition-colors font-medium">Public read</span>
            <span class="text-[11px] text-text-placeholder">Anyone with the link can view all sessions</span>
          </div>
        </label>

        <div class="w-full h-px bg-border-subtle"></div>

        <!-- Session-level permissions -->
        <div class="space-y-1">
          <div class="text-[11px] text-text-placeholder px-2">Session access</div>
          {#each sharedSessionPermissions as perm (perm.id)}
            <div class="flex items-center gap-2 px-2 py-1.5 rounded-[4px] group">
              {#if perm.level === 'write'}
                <Share2 class="w-3.5 h-3.5 text-brand shrink-0" />
              {:else if perm.level === 'private'}
                <Lock class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
              {:else}
                <Globe class="w-3.5 h-3.5 text-text-secondary shrink-0" />
              {/if}
              <span class="text-[12.5px] text-text-secondary truncate flex-1">
                {sessionTitleById.get(perm.resourceId) || 'Session ' + perm.resourceId.slice(0, 8)}
              </span>
              <div class="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  class="p-1 rounded-sm text-text-tertiary hover:text-brand hover:bg-bg-hover transition-colors opacity-0 group-hover:opacity-100"
                  onclick={() => {
                    const url = `${window.location.origin}/runtimes/${runtimeId}?session=${perm.resourceId}`;
                    void navigator.clipboard.writeText(url);
                    shareCopied = true;
                    if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
                    shareCopiedTimer = setTimeout(() => { shareCopied = false; }, 2000);
                  }}
                  title="Copy link"
                >
                  <Copy class="w-3 h-3" />
                </button>
                <button
                  type="button"
                  class="p-1 rounded-sm text-text-tertiary hover:text-error-soft hover:bg-bg-hover transition-colors opacity-0 group-hover:opacity-100"
                  onclick={() => { void removeSessionPermission(perm.resourceId); }}
                  title="Remove access"
                >
                  <X class="w-3 h-3" />
                </button>
              </div>
            </div>
          {:else}
            <div class="px-2 py-1 text-[12px] text-text-tertiary italic">No shared sessions</div>
          {/each}
        </div>

        {#if sessionPermError}
          <div class="px-2 py-1 text-[12px] text-error-soft break-all">{sessionPermError}</div>
        {/if}

        <div class="w-full h-px bg-border-subtle"></div>

      </section>

      <!-- Collaborators section (owner only) -->
      {#if isOwner}
      <section class="space-y-3">
        <div class="text-[10px] font-bold text-text-tertiary uppercase tracking-widest flex items-center justify-between">
          <span>Collaborators</span>
          <span class="px-1.5 py-0.5 rounded-sm bg-bg-hover-strong text-text-secondary">{runtimeCollaborators.length}</span>
        </div>

        <!-- Add collaborator form -->
        <div class="space-y-2">
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={addingCollaboratorUuid}
              placeholder="Paste user UUID"
              class="flex-1 px-2.5 py-[5px] rounded-[5px] bg-bg-input border border-border-subtle text-[12px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono"
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddCollaborator(); } }}
            />
            <select
              bind:value={addingCollaboratorLevel}
              class="px-2 py-[5px] rounded-[5px] bg-bg-input border border-border-subtle text-[12px] text-text-secondary focus:border-brand/40 focus:outline-none"
            >
              <option value="write">Write</option>
              <option value="read">Read</option>
            </select>
            <button
              type="button"
              onclick={() => { void handleAddCollaborator(); }}
              disabled={savingCollaborator || !addingCollaboratorUuid.trim()}
              class="px-2.5 py-[5px] rounded-[5px] bg-[#FF3E00] hover:bg-brand-hover text-[12px] text-white font-medium transition-colors disabled:opacity-50 cursor-pointer"
            >
              {savingCollaborator ? '...' : 'Add'}
            </button>
          </div>
          {#if addingCollaboratorError}
            <div class="text-[11px] text-error-soft break-all">{addingCollaboratorError}</div>
          {/if}
        </div>

        <!-- Collaborators list -->
        {#if loadingCollaborators}
          <div class="flex items-center justify-center py-4 text-[12px] text-text-tertiary">
            <div class="w-3.5 h-3.5 rounded-full border-2 border-border-subtle border-t-brand animate-spin mr-2"></div>
            Loading...
          </div>
        {:else if runtimeCollaborators.length === 0}
          <div class="px-2 py-1 text-[12px] text-text-tertiary italic">No collaborators</div>
        {:else}
          <div class="space-y-1">
            {#each runtimeCollaborators as collab (collab.granteeUuid)}
              <div class="flex items-center gap-2 px-2 py-1.5 rounded-[4px] group hover:bg-bg-hover transition-colors">
                {#if collab.level === 'write'}
                  <Pencil class="w-3.5 h-3.5 text-brand shrink-0" />
                {:else}
                  <Eye class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                {/if}
                <code class="flex-1 text-[11px] font-mono text-text-secondary truncate select-all">{collab.granteeUuid}</code>
                <select
                  value={collab.level}
                  onchange={(event) => { void handleUpdateCollaboratorLevel(collab.granteeUuid!, (event.currentTarget as HTMLSelectElement).value as "read" | "write"); }}
                  class="px-1.5 py-0.5 rounded-sm bg-bg-input border border-border-subtle text-[11px] text-text-secondary focus:border-brand/40 focus:outline-none"
                >
                  <option value="write">Write</option>
                  <option value="read">Read</option>
                </select>
                <button
                  type="button"
                  class="p-1 rounded-sm text-text-tertiary hover:text-error-soft hover:bg-bg-hover transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                  onclick={() => { void handleRemoveCollaborator(collab.granteeUuid!); }}
                  title="Remove collaborator"
                >
                  <X class="w-3 h-3" />
                </button>
              </div>
            {/each}
          </div>
        {/if}

        <div class="w-full h-px bg-border-subtle"></div>
      </section>
      {/if}

      <!-- Channels section -->
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

  <!-- Share Modal -->
  {#if showShareModal && shareModalSessionId}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        class="absolute inset-0 bg-black/40"
        aria-label="Close share dialog"
        onclick={() => { showShareModal = false; }}
      ></button>
      <div class="relative w-full max-w-[380px] rounded-xl border border-border-subtle bg-bg-primary shadow-2xl overflow-hidden">
        <div class="h-9 flex items-center justify-between px-3 border-b border-border-subtle text-[10px] font-medium uppercase tracking-wider text-text-tertiary select-none">
          <span>{hasSessionPermission(shareModalSessionId!) ? 'Session is public' : 'Share session'}</span>
          <button type="button" class="flex items-center justify-center w-6 h-6 rounded-[4px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors" onclick={() => { showShareModal = false; }}>
            <X class="w-3.5 h-3.5" />
          </button>
        </div>
        <div class="p-4 space-y-4">
          <!-- Already public: show manage options -->
          {#if hasSessionPermission(shareModalSessionId!)}
            <p class="text-[13px] text-text-secondary leading-relaxed">Anyone with the link can view this session. Choose how to manage access:</p>
            <div class="space-y-2">
              <button
                type="button"
                class="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-[6px] border border-border-subtle bg-bg-surface hover:bg-bg-hover transition-colors disabled:opacity-50"
                onclick={() => { void removeSessionPermission(shareModalSessionId!).then((ok) => { if (ok) showShareModal = false; }); }}
                disabled={shareModalSaving}
              >
                <Globe class="w-4 h-4 text-text-tertiary shrink-0 mt-0.5" />
                <div class="min-w-0">
                  <div class="text-[13px] text-text-primary font-medium">Remove permission</div>
                  <div class="text-[11px] text-text-placeholder mt-0.5 leading-relaxed">Delete this session's access rule. It will inherit the runtime-level setting instead.</div>
                </div>
              </button>
              <button
                type="button"
                class="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-[6px] border border-border-subtle bg-bg-surface hover:bg-bg-hover transition-colors disabled:opacity-50"
                onclick={() => { void makeSessionPrivate(); }}
                disabled={shareModalSaving}
              >
                <Lock class="w-4 h-4 text-text-tertiary shrink-0 mt-0.5" />
                <div class="min-w-0">
                  <div class="text-[13px] text-text-primary font-medium">Make private</div>
                  <div class="text-[11px] text-text-placeholder mt-0.5 leading-relaxed">Block all external access regardless of the runtime's visibility setting.</div>
                </div>
              </button>
            </div>
            <!-- Copy link shortcut -->
            <button
              type="button"
              class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-[5px] text-[13px] text-text-secondary hover:text-text-primary border border-border-subtle hover:bg-bg-hover transition-colors disabled:opacity-50"
              onclick={() => {
                const url = `${window.location.origin}/runtimes/${runtimeId}?session=${shareModalSessionId}`;
                void navigator.clipboard.writeText(url);
                shareCopied = true;
                if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
                shareCopiedTimer = setTimeout(() => { shareCopied = false; }, 2000);
              }}
              disabled={shareModalSaving}
            >
              {#if shareCopied}
                <Check class="w-3.5 h-3.5 text-status-success" />
                Copied
              {:else}
                <Copy class="w-3.5 h-3.5" />
                Copy link
              {/if}
            </button>
          {:else}
            <!-- Currently private: confirm before sharing -->
            <p class="text-[13px] text-text-secondary leading-relaxed">This session will become publicly accessible. Anyone with the link can view the conversation.</p>
            <button
              type="button"
              class="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-[5px] bg-bg-primary hover:bg-bg-hover-strong border border-border-subtle text-[13px] text-text-primary font-medium transition-colors disabled:opacity-50"
              onclick={() => { void shareAndCopyLink(); }}
              disabled={shareModalSaving}
            >
              {#if shareModalSaving}
                <Loader2 class="w-3.5 h-3.5 animate-spin" />
                Sharing…
              {:else}
                <Share2 class="w-3.5 h-3.5" />
                Share &amp; copy link
              {/if}
            </button>
          {/if}

          {#if shareModalError}
            <div class="text-[12px] text-error-soft break-all">{shareModalError}</div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Model Selector Dialog -->
  <ModelSelector
    open={showModelSelector}
    onClose={() => { showModelSelector = false; }}
    onSelect={handleModelSelect}
    models={modelsCatalog ?? []}
    currentModel={activeSessionModel}
  />

  <!-- Mobile right drawer for file sidebar -->
  <MobileRightDrawer
    dragOffsetPx={rightDrawerDragOffsetPx}
    isDragging={rightDrawerIsDragging}
    isDrawerVisible={rightDrawerIsVisible}
  >
    <RuntimeFileSidebar
      nodes={fileTree}
      selectedPath={urlFilePath ?? ""}
      loading={fileTreeLoading}
      error={fileTreeError}
      onToggle={handleFileToggle}
      onSelect={handleFileSelect}
      onRefresh={refreshFileTree}
      onCreateFile={handleCreateFile}
      onCreateDir={handleCreateDir}
      onRename={handleRenameNode}
      onDelete={handleDeleteNode}
      canWrite={canWrite}
    />
  </MobileRightDrawer>
</div>

<style>
  .right-sidebar-resize-handle {
    position: absolute;
    top: 0;
    left: -4px;
    bottom: 0;
    width: 8px;
    border: none;
    padding: 0;
    cursor: col-resize;
    background: transparent;
    touch-action: none;
    z-index: 10;
  }

  :global(body.sidebar-resizing) {
    cursor: col-resize;
    user-select: none;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
    text-decoration: none;
  }
  .icon-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }
  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: 12px;
  }
  .action-btn:disabled { opacity: 0.5; }
  .toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-height: 28px;
    padding: 0 8px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .toggle-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }
  .toggle-btn.active {
    border-color: var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .download-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: 12px;
    text-decoration: none;
  }
  .download-btn:hover { background: var(--bg-hover-strong); color: var(--text-primary); }
  .download-btn.primary {
    background: var(--brand, #58a6ff);
    border-color: var(--brand, #58a6ff);
    color: #fff;
  }
  .download-btn.primary:hover { opacity: 0.9; }
  .markdown-preview {
    height: 100%;
    overflow: auto;
    padding: 20px 24px;
    max-width: 860px;
    margin: 0 auto;
    line-height: 1.7;
    font-size: 14px;
  }
  .markdown-preview :global(h1) {
    font-size: 1.8em;
    font-weight: 700;
    margin-top: 0;
    margin-bottom: 0.5em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--border-subtle);
  }
  .markdown-preview :global(h2) {
    font-size: 1.4em;
    font-weight: 600;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
  }
  .markdown-preview :global(h3) {
    font-size: 1.15em;
    font-weight: 600;
    margin-top: 1.2em;
    margin-bottom: 0.4em;
  }
  .markdown-preview :global(p) { margin-bottom: 1em; }
  .markdown-preview :global(code) {
    background: var(--bg-hover);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 0.15em 0.4em;
    font-size: 0.9em;
    font-family: var(--font-mono, monospace);
  }
  .markdown-preview :global(pre) {
    background: var(--bg-primary);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
    overflow: auto;
    margin-bottom: 1em;
  }
  .markdown-preview :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 13px;
    line-height: 1.5;
  }
  .markdown-preview :global(ul),
  .markdown-preview :global(ol) {
    padding-left: 1.5em;
    margin-bottom: 1em;
  }
  .markdown-preview :global(li) { margin-bottom: 0.3em; }
  .markdown-preview :global(blockquote) {
    border-left: 3px solid var(--border-subtle);
    padding-left: 1em;
    color: var(--text-tertiary);
    margin-bottom: 1em;
  }
  .markdown-preview :global(img) {
    max-width: 100%;
    border-radius: 6px;
    margin: 0.5em 0;
  }
  .markdown-preview :global(a) { color: var(--brand, #58a6ff); }
  .markdown-preview :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 1em;
  }
  .markdown-preview :global(th),
  .markdown-preview :global(td) {
    border: 1px solid var(--border-subtle);
    padding: 8px 12px;
    text-align: left;
  }
  .markdown-preview :global(th) {
    background: var(--bg-hover);
    font-weight: 600;
  }

  /* No-write-permission hint toast */
  .hint-toast {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 50;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--bg-primary, #1a1a2e);
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.1));
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    font-size: 12px;
    color: var(--text-secondary, #b0b0c0);
    white-space: nowrap;
    animation: hint-fade-in 0.2s ease-out;
    pointer-events: none;
  }

  @keyframes hint-fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
