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
} from "$lib/api";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import CodeEditor from "$lib/components/CodeEditor.svelte";
import MobileRightDrawer from "$lib/components/MobileRightDrawer.svelte";
import Dialog from "$lib/components/Dialog.svelte";
import ModelSelector from "$lib/components/ModelSelector.svelte";
import PageHeader from "$lib/components/PageHeader.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import SettingsOverlay from "$lib/components/SettingsOverlay.svelte";
import SpaceFileSidebar from "$lib/components/SpaceFileSidebar.svelte";
import { renderMarkdown } from "$lib/markdown";
import {
	buildRenderableChatMessages,
	buildTimelineItems,
} from "$lib/session-render";
import type { ChatMessage, TimelineItem } from "$lib/session-tree";
import type { SpaceFsNode } from "$lib/space-fs";
import { messageCache } from "$lib/stores/message-cache";
import { sessionPendingStore } from "$lib/stores/session-pending.svelte";
import { unreadTracker } from "$lib/stores/session-state.svelte";

import { getRealtimeClient } from "$lib/realtime";
import type { RealtimeEventPayload } from "$lib/realtime";
import { createSessionPermission, deleteSessionPermission, listSpacePermissions, createSpacePermission, deleteSpacePermission, addSpaceCollaborator, updateSpaceCollaborator, removeSpaceCollaborator, listSpaceCollaborators, type ResourcePermission } from "$lib/api";
import {
	RIGHT_SIDEBAR_MAX,
	RIGHT_SIDEBAR_MIN,
	uiState,
} from "$lib/stores/ui.svelte";
import type { ContentBlock, MessageRecord } from "@cohub/protocol";
import {
	AlertCircle,
	ArrowDown,
	Check,
	Copy,
	Download,
	Eye,
	FolderKanban,
	Globe,
	Hash,
	Loader2,
	Lock,
	PanelRightClose,
	PanelRightOpen,
	Pencil,
	Plus,
	RefreshCw,
	Save,
	Settings,
	Share2,
	Terminal,
	X,
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
const fileMode = $derived<"chat" | "file">(urlFilePath ? "file" : "chat");
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
let streamingDraftAnchorUserMessageIdBySessionId = $state<Record<string, string | null>>({});
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

const fileDirty = $derived(Boolean(openFile && openFile.kind === 'text' && openFileDraft !== openFile.content));
const openFileIsMarkdown = $derived(Boolean(openFile?.kind === "text" && /\.md$/i.test(openFile.path)));
const openFileExt = $derived.by(() => {
	if (!openFile || openFile.kind !== "text") return "plaintext";
	return openFile.name.split(".").pop()?.toLowerCase() ?? "plaintext";
});
const openFileIsImage = $derived(Boolean(openFile?.mimeType?.startsWith("image/")));
const openFileIsVideo = $derived(Boolean(openFile?.mimeType?.startsWith("video/")));
const openFileIsText = $derived(Boolean(openFile?.kind === "text"));
const openFileDataUrl = $derived.by(() => {
	if (!openFile || openFile.kind !== "binary") return null;
	const mime = openFile.mimeType ?? "application/octet-stream";
	return `data:${mime};base64,${openFile.content}`;
});
const openFileDownloadUrl = $derived.by(() => {
	if (!urlFilePath) return "";
	return `/api/spaces/${spaceId}/fs/download?path=${encodeURIComponent(urlFilePath)}`;
});
const openFileDownloadName = $derived.by(() => {
	if (!urlFilePath) return "";
	return urlFilePath.split("/").pop() ?? "download";
});

let fileMarkdownHtml = $state("");
let fileEdit = $state(true);

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

$effect(() => {
	if (openFile) fileEdit = true;
});

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

// ─── Settings & Share ───
let showSettings = $state(false);
let showShareModal = $state(false);
let shareModalSessionId = $state<string | null>(null);
let shareCopied = $state(false);
let shareCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let shareModalError = $state("");
let shareModalSaving = $state(false);

// Space-level permissions
let spacePerms = $state<ResourcePermission[]>([]);
let spacePublicRead = $state(false);
let savingSpacePerm = $state(false);

// Session-level permissions
let sessionPerms = $state<ResourcePermission[]>([]);

// Session title cache for settings panel
let sessionTitleById = $state<Map<string, string>>(new Map());

// Collaborators
let spaceCollaborators = $state<ResourcePermission[]>([]);
let loadingCollaborators = $state(false);
let addingCollaboratorUuid = $state("");
let addingCollaboratorLevel = $state<"read" | "write">("write");
let savingCollaborator = $state(false);
let addingCollaboratorError = $state("");

function getSessionTitle(session: SessionRecord): string {
  const candidates = [session.title, session.latestMessageText];
  for (const candidate of candidates) {
    const normalized = candidate?.replace(/\s+/g, " ").replace(/^[:\-\s]+/, "").trim();
    if (normalized) return normalized.slice(0, 36);
  }
  return "New session";
}

function hasSessionPermission(sessionId: string): boolean {
  return sessionPerms.some((p) => p.resourceId === sessionId && p.level === "read");
}

async function loadSpacePermissions() {
  try {
    const perms = await listSpacePermissions(spaceId);
    spacePerms = perms;
    spacePublicRead = perms.some(
      (p) => p.resourceType === "space" && p.level === "read" && p.granteeUuid === null,
    );
    sessionPerms = perms.filter(
      (p) => p.resourceType === "session" && p.granteeUuid === null,
    );
    // Cache session titles from existing session data
    const titleMap = new Map<string, string>();
    for (const perm of sessionPerms) {
      const sess = spaceSessions.find((s) => s.id === perm.resourceId);
      if (sess) titleMap.set(perm.resourceId, getSessionTitle(sess));
    }
    sessionTitleById = titleMap;
  } catch {
    // Non-blocking
  }
}

async function toggleSpacePublicRead(checked: boolean) {
  savingSpacePerm = true;
  try {
    if (checked) {
      await createSpacePermission(spaceId, "read");
    } else {
      await deleteSpacePermission(spaceId);
    }
    await loadSpacePermissions();
  } catch {
    // Silently fail
  } finally {
    savingSpacePerm = false;
  }
}

async function removeSessionPermission(sessionId: string) {
  try {
    await deleteSessionPermission(sessionId);
    await loadSpacePermissions();
  } catch {
    // Silently fail
  }
}

// Collaborator management
async function loadCollaborators() {
  loadingCollaborators = true;
  try {
    spaceCollaborators = await listSpaceCollaborators(spaceId);
  } catch {
    // Non-blocking
  } finally {
    loadingCollaborators = false;
  }
}

async function handleAddCollaborator() {
  if (!addingCollaboratorUuid.trim()) return;
  savingCollaborator = true;
  addingCollaboratorError = "";
  try {
    await addSpaceCollaborator(spaceId, addingCollaboratorUuid.trim(), addingCollaboratorLevel);
    addingCollaboratorUuid = "";
    await loadCollaborators();
  } catch (error) {
    addingCollaboratorError = error instanceof Error ? error.message : "Failed to add collaborator";
  } finally {
    savingCollaborator = false;
  }
}

async function handleUpdateCollaboratorLevel(granteeUuid: string, level: "read" | "write") {
  try {
    await updateSpaceCollaborator(spaceId, granteeUuid, level);
    await loadCollaborators();
  } catch {
    // Silently fail
  }
}

async function handleRemoveCollaborator(granteeUuid: string) {
  try {
    await removeSpaceCollaborator(spaceId, granteeUuid);
    await loadCollaborators();
  } catch {
    // Silently fail
  }
}

function openShareModal(sessionId: string) {
  shareModalSessionId = sessionId;
  showShareModal = true;
  shareCopied = false;
  shareModalError = "";
}

async function shareAndCopyLink() {
  if (!shareModalSessionId) return;
  shareModalError = "";
  shareModalSaving = true;
  try {
    await createSessionPermission(shareModalSessionId, "read");
    const url = `${window.location.origin}/spaces/${spaceId}?session=${shareModalSessionId}`;
    await navigator.clipboard.writeText(url);
    shareCopied = true;
    if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
    shareCopiedTimer = setTimeout(() => { shareCopied = false; }, 2000);
    await loadSpacePermissions();
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
    await deleteSessionPermission(shareModalSessionId);
    await loadSpacePermissions();
    showShareModal = false;
  } catch (error) {
    shareModalError = error instanceof Error ? error.message : "Failed to make session private";
  } finally {
    shareModalSaving = false;
  }
}

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
const activePendingMessages = $derived.by(() =>
	activeSessionId ? sessionPendingStore.pendingBySessionId[activeSessionId] ?? [] : [],
);
const activeRenderableMessages = $derived.by(() => {
	const state = activeSessionState;
	if (!state) return [] as ChatMessage[];
	return buildRenderableChatMessages(state.messages, activePendingMessages);
});
const timeline = $derived.by<TimelineItem[]>(() => {
	const state = activeSessionState;
	if (!state) return [];
	return buildTimelineItems({
		messages: activeRenderableMessages,
		streaming:
			streamStatus === "streaming" || streamingContentBlocks.length > 0
				? {
					sessionId: activeSessionId ?? "active",
					anchorUserMessageId:
						activeSessionId
							? (streamingDraftAnchorUserMessageIdBySessionId[activeSessionId] ?? null)
							: null,
					contentBlocks: streamingContentBlocks,
					truncatedStart:
						activeSessionId
							? (streamingDraftTruncatedStartBySessionId[activeSessionId] ?? false)
							: false,
				}
				: null,
	});
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

function getPendingMessages(sessionId: string | null) {
	if (!sessionId) return [];
	return sessionPendingStore.list(sessionId);
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

	tasks.push(
		(async () => {
			try {
				await loadSpacePermissions();
			} catch {
				// Non-blocking
			}
		})(),
	);

	tasks.push(
		(async () => {
			try {
				await loadCollaborators();
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

		const state = sessionStateById[currentActiveSessionId];
		if (!state) return;

		if (payload.type === "session.turn.progress") {
			const content = Array.isArray(payload.payload.content)
				? (payload.payload.content as ContentBlock[])
				: [];
			if (content.length === 0) return;
			const streamingAnchorUserMessageId =
				typeof payload.payload.anchorUserMessageId === "string"
					? payload.payload.anchorUserMessageId
					: null;
			const hasExistingStreamingState =
				streamingContentBlocks.length > 0 ||
				Boolean(streamingDraftAnchorUserMessageIdBySessionId[currentActiveSessionId]);
			const mergedContent = mergeDeltaBlocks(streamingContentBlocks, content);
			const { thinking, answer } = extractSessionRenderState(mergedContent);
			streamingThinking = thinking;
			streamingAssistantText = answer;
			streamingContentBlocks = mergedContent;
			if (streamingAnchorUserMessageId) {
				streamingDraftAnchorUserMessageIdBySessionId = {
					...streamingDraftAnchorUserMessageIdBySessionId,
					[currentActiveSessionId]: streamingAnchorUserMessageId,
				};
			}
			if (
				!hasExistingStreamingState &&
				streamStatus === "streaming" &&
				streamingSessionId === currentActiveSessionId
			) {
				streamingDraftTruncatedStartBySessionId = {
					...streamingDraftTruncatedStartBySessionId,
					[currentActiveSessionId]: true,
				};
			}
			if (streamingSessionId !== currentActiveSessionId) {
				streamingSessionId = currentActiveSessionId;
				notifyStreamingStatus(currentActiveSessionId, true);
			}
			streamStatus = "streaming";
			await tick();
			if (!userScrolledUp) scrollToBottomNow();
			return;
		}

		if (payload.type === "session.turn.error") {
			clearStreamingState(currentActiveSessionId);
			streamStatus = "error";
			if (streamingSessionId) notifyStreamingStatus(streamingSessionId, false);
			streamingSessionId = null;
			return;
		}

		if (payload.type === "session.turn.final") {
			clearStreamingState(currentActiveSessionId);
			streamStatus = "done";
			streamingDraftTruncatedStartBySessionId = {
				...streamingDraftTruncatedStartBySessionId,
				[currentActiveSessionId]: false,
			};
			if (streamingSessionId) notifyStreamingStatus(streamingSessionId, false);
			streamingSessionId = null;
			void reconcileSessionTail(currentActiveSessionId);
			if (!userScrolledUp) scrollToBottomNow();
			return;
		}

		if (payload.type !== "session.message.persisted") return;
		const message = payload.payload.message as MessageRecord | undefined;
		if (!message) return;
		if (state.messages.some((m) => m.id === message.id)) return;

		const clientMessageId =
			typeof message.meta?.clientMessageId === "string"
				? (message.meta.clientMessageId as string)
				: null;
		if (message.role === "user" && clientMessageId) {
			sessionPendingStore.remove(currentActiveSessionId, clientMessageId);
			sessionPendingStore.reconcilePersisted(currentActiveSessionId, [message]);
		}

		const merged = mergeMessagesById(state.messages, [message], {
			preferIncoming: true,
		});
		sessionStateById = {
			...sessionStateById,
			[currentActiveSessionId]: {
				...state,
				messages: merged,
			},
		};

		const updatedSession = state.session;
		if (updatedSession) {
			const refreshedSession: SessionRecord = {
				...updatedSession,
				lastMessageId: message.id ?? null,
				updatedAt: new Date().toISOString(),
			};
			spaceSessions = spaceSessions.map((s): SessionRecord =>
				s.id === updatedSession.id ? refreshedSession : s,
			);
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

function clearStreamingState(sessionId: string | null = activeSessionId) {
	streamingAssistantText = "";
	streamingThinking = "";
	streamingContentBlocks = [];
	if (sessionId) {
		streamingDraftTruncatedStartBySessionId = {
			...streamingDraftTruncatedStartBySessionId,
			[sessionId]: false,
		};
		streamingDraftAnchorUserMessageIdBySessionId = {
			...streamingDraftAnchorUserMessageIdBySessionId,
			[sessionId]: null,
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
			sequenceHint: (activeSessionState?.messages.at(-1)?.sequence ?? 0) + 1,
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
					model: model?.id,
					provider: model?.provider,
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
	fileEdit = true;
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

async function handleFileKeyboardSave(event: KeyboardEvent) {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && fileMode === "file") {
		event.preventDefault();
		await saveOpenFile();
	}
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

	// Preload models catalog so model selector is ready immediately
	void loadModelsCatalog();

	// Listen for checkpoint updates from sidebar
	function handleCheckpointsUpdated(e: Event) {
		const custom = e as CustomEvent;
		if (custom.detail?.spaceId === spaceId) {
			void loadSpace({ force: true });
		}
	}
	window.addEventListener("cohub:checkpoints-updated", handleCheckpointsUpdated as EventListener);

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
	window.addEventListener("keydown", handleFileKeyboardSave);

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
		window.removeEventListener("cohub:checkpoints-updated", handleCheckpointsUpdated as EventListener);
		window.removeEventListener("keydown", handleFileKeyboardSave);
		rightSidebarResizeCleanup?.();
	};
});

$effect(() => {
	if (urlSessionId && urlSessionId !== activeSessionId) {
		clearStreamingState(activeSessionId);
		activeSessionId = urlSessionId;
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
		fileMarkdownHtml = "";
		fileEdit = true;
		return;
	}
	void openFileFromUrl(urlFilePath);
});

$effect(() => {
	if (!listEl || !activeSessionId) return;
	requestAnimationFrame(() => updateAutoFollow());
});

// ResizeObserver: when the scroll container's content grows and the user
// is already near the bottom (shouldAutoFollow), keep them pinned. This
// replaces fragile tick()/setTimeout-based scroll logic and naturally
// catches async markdown rendering, image loading, etc.
$effect(() => {
	const el = listEl;
	if (!el) return;

	let prevHeight = el.scrollHeight;

	const ro = new ResizeObserver(() => {
		if (!listEl) return;
		const currentHeight = listEl.scrollHeight;
		if (currentHeight > prevHeight && shouldAutoFollow && !autoScrollGuard) {
			scrollToBottomNow();
		}
		prevHeight = currentHeight;
		updateAutoFollow();
	});
	ro.observe(el);

	return () => ro.disconnect();
});
</script>

<PageHeader>
  {#snippet left()}
    <div class="flex items-center gap-1.5 min-w-0">
      {#if activeSessionState?.session}
        <span
          class="text-[13px] text-text-primary truncate max-w-[35%] cursor-default select-none"
          onclick={handleTitleClick}
          title="Space details"
        >{space?.name || space?.title || spaceId}</span>
        <span class="text-text-tertiary shrink-0 text-[13px] select-none">/</span>
        <span class="text-[13px] text-text-secondary truncate">{getSessionTitle(activeSessionState.session)}</span>
      {:else}
        <span
          class="text-[13px] text-text-primary truncate cursor-default select-none"
          onclick={handleTitleClick}
        >{space?.name || space?.title || spaceId}</span>
      {/if}
    </div>
  {/snippet}
  {#snippet right()}
    <!-- Session Share -->
    {#if activeSessionId}
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

    <!-- Settings -->
    <button
      type="button"
      class="flex items-center justify-center w-8 h-8 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
      onclick={() => { showSettings = true; }}
      title="Settings"
    >
      <Settings class="w-4 h-4 shrink-0" />
    </button>

    <!-- Toggle right sidebar -->
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
    {#if fileMode === 'file'}
      <!-- File Viewer -->
      {#if openFileLoading}
        <div class="flex-1 flex items-center justify-center text-[12px] text-text-tertiary">Loading file…</div>
      {:else if openFileError}
        <div class="m-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
          {openFileError}
        </div>
      {:else if openFileTooLarge}
        <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
            <div class="min-w-0 flex-1 truncate text-[11px] sm:text-[12px] text-text-secondary">
              {urlFilePath}
            </div>
            <a
              href={openFileDownloadUrl}
              download={openFileDownloadName}
              class="action-btn"
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
                class="action-btn primary"
              >
                <Download class="w-3.5 h-3.5" />
                Download file
              </a>
            </div>
          </div>
        </div>
      {:else if openFile}
        <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
          {#if openFileIsText}
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
          {:else if openFileIsImage && openFileDataUrl}
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
              <img src={openFileDataUrl} alt={openFile.name} class="max-h-full max-w-full rounded-md object-contain" />
            </div>
          {:else if openFileIsVideo && openFileDataUrl}
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
              <video src={openFileDataUrl} controls class="max-h-full max-w-full rounded-md">
                <track kind="captions" />
              </video>
            </div>
          {:else}
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
      {:else}
        <div class="flex-1 flex items-center justify-center text-[12px] text-text-tertiary">No file selected</div>
      {/if}
    {:else}
      <!-- Chat -->
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
  {/if}
  </div>

  <!-- Desktop right sidebar — file tree only -->
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

  <!-- Settings Overlay (desktop: right drawer, mobile: bottom sheet) -->
  <SettingsOverlay open={showSettings} onClose={() => { showSettings = false; }}>
    <div class="p-4 space-y-6">
      <!-- Sharing section -->
      <section class="space-y-3">
        <div class="text-[10px] font-bold text-text-tertiary uppercase tracking-widest flex items-center justify-between">
          <span>Sharing</span>
        </div>

        <!-- Space-level toggle -->
        <label class="flex items-start gap-3 cursor-pointer group p-2 rounded-[5px] hover:bg-bg-hover transition-colors">
          <div class="relative shrink-0 mt-0.5">
            <input
              type="checkbox"
              checked={spacePublicRead}
              onchange={(event) => { void toggleSpacePublicRead((event.currentTarget as HTMLInputElement).checked); }}
              disabled={savingSpacePerm}
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
          {#each sessionPerms as perm (perm.id)}
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
                    const url = `${window.location.origin}/spaces/${spaceId}?session=${perm.resourceId}`;
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

        <div class="w-full h-px bg-border-subtle"></div>
      </section>

      <!-- Collaborators section -->
      <section class="space-y-3">
        <div class="text-[10px] font-bold text-text-tertiary uppercase tracking-widest flex items-center justify-between">
          <span>Collaborators</span>
          <span class="px-1.5 py-0.5 rounded-sm bg-bg-hover-strong text-text-secondary">{spaceCollaborators.length}</span>
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
        {:else if spaceCollaborators.length === 0}
          <div class="px-2 py-1 text-[12px] text-text-tertiary italic">No collaborators</div>
        {:else}
          <div class="space-y-1">
            {#each spaceCollaborators as collab (collab.granteeUuid)}
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

      <!-- Channels section -->
      <section class="space-y-3">
        <div class="text-[10px] font-bold text-text-tertiary uppercase tracking-widest flex items-center justify-between">
          <span>Channels</span>
          <span class="px-1.5 py-0.5 rounded-sm bg-bg-hover-strong text-text-secondary">{space?.channels?.length ?? 0}</span>
        </div>

        {#if !space?.channels || space.channels.length === 0}
          <div class="rounded-md border border-border-subtle bg-bg-hover p-3 text-[13px] text-text-tertiary">No channels bound.</div>
        {:else}
          <div class="space-y-3">
            {#each space.channels as channel (channel.id)}
              <div class="border border-border-subtle rounded-[5px] bg-bg-surface overflow-hidden">
                <div class="px-3 py-2 border-b border-border-subtle bg-bg-header-alt flex items-center gap-2">
                  <Hash class="w-3 h-3 text-text-tertiary" />
                  <span class="text-[12px] font-medium text-text-primary truncate">{channel.name || channel.provider}</span>
                </div>
                <div class="p-3">
                  {#if channel.provider === "discord"}
                    <div class="space-y-2 text-[12px] text-text-tertiary">
                      <div class="flex items-center gap-2">
                        <span class="text-text-secondary">Status:</span>
                        <span class="capitalize">{channel.status}</span>
                      </div>
                    </div>
                  {:else}
                    <div class="text-[13px] text-text-tertiary">No configuration available.</div>
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
  <Dialog open={showShareModal && !!shareModalSessionId} onClose={() => { showShareModal = false; }} title={hasSessionPermission(shareModalSessionId!) ? 'Session is public' : 'Share session'} maxWidth="380px">
    <div class="p-4 space-y-4">
      {#if hasSessionPermission(shareModalSessionId!)}
        <p class="text-[13px] text-text-secondary leading-relaxed">Anyone with the link can view this session. Choose how to manage access:</p>
        <div class="space-y-2">
          <button
            type="button"
            class="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-[6px] border border-border-subtle bg-bg-surface hover:bg-bg-hover transition-colors disabled:opacity-50"
            onclick={() => { void removeSessionPermission(shareModalSessionId!); showShareModal = false; }}
            disabled={shareModalSaving}
          >
            <Globe class="w-4 h-4 text-text-tertiary shrink-0 mt-0.5" />
            <div class="min-w-0">
              <div class="text-[13px] text-text-primary font-medium">Remove permission</div>
              <div class="text-[11px] text-text-placeholder mt-0.5 leading-relaxed">Delete this session's access rule.</div>
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
              <div class="text-[11px] text-text-placeholder mt-0.5 leading-relaxed">Block all external access.</div>
            </div>
          </button>
        </div>
        <button
          type="button"
          class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-[5px] text-[13px] text-text-secondary hover:text-text-primary border border-border-subtle hover:bg-bg-hover transition-colors disabled:opacity-50"
          onclick={() => {
            const url = `${window.location.origin}/spaces/${spaceId}?session=${shareModalSessionId}`;
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
  </Dialog>

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

  /* File viewer */
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
    cursor: pointer;
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
    cursor: pointer;
    text-decoration: none;
  }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .action-btn.primary {
    background: var(--brand, #FF3E00);
    border-color: var(--brand, #FF3E00);
    color: #fff;
  }
  .action-btn.primary:hover { opacity: 0.9; }

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
    cursor: pointer;
  }
  .toggle-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }
  .toggle-btn.active {
    border-color: var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

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
  .markdown-preview :global(a) { color: var(--brand, #FF3E00); }
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
</style>
