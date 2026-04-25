<script lang="ts">
import {
	type CheckpointRecord,
	type CronJobRecord,
	HttpError,
	type SessionRecord,
	type SpaceAccessPolicy,
	type SpaceFsEntry,
	type SpaceFsFileResponse,
	type SpaceMember,
	type SpaceRecord,
	type SpaceRole,
	type TaskRunRecord,
} from "@neta-art/cohub";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { MessageRecord } from "@neta-art/cohub-protocol/model";
import type { ChannelEnvelope } from "@neta-art/cohub-protocol/realtime";
import {
	AlertCircle,
	ArrowDown,
	Check,
	Clock,
	Clock3,
	Code,
	Copy,
	Download,
	Eye,
	FolderKanban,
	GitCommitHorizontal,
	Globe,
	Hash,
	Loader2,
	Lock,
	Network,
	PanelLeftClose,
	PanelRightClose,
	PanelRightOpen,
	Pencil,
	Plus,
	Power,
	PowerOff,
	RefreshCw,
	Save,
	Settings,
	Share2,
	Terminal,
	Trash2,
	X,
} from "lucide-svelte";
import { onMount, tick } from "svelte";
import { goto } from "$app/navigation";
import { pollCheckpointJob } from "$lib/checkpoints";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import CodeEditor from "$lib/components/CodeEditor.svelte";
import Dialog from "$lib/components/Dialog.svelte";
import MobileRightDrawer from "$lib/components/MobileRightDrawer.svelte";
import ModelSelector from "$lib/components/ModelSelector.svelte";
import PageHeader from "$lib/components/PageHeader.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import SettingsOverlay from "$lib/components/SettingsOverlay.svelte";
import SpaceFileSidebar from "$lib/components/SpaceFileSidebar.svelte";
import { renderMarkdown } from "$lib/markdown";
import { sdk } from "$lib/sdk";
import {
	buildRenderableChatMessages,
	buildTimelineItems,
} from "$lib/session-render";
import type { ChatMessage, TimelineItem } from "$lib/session-tree";
import type { SpaceFsNode } from "$lib/space-fs";
import {
	buildSpaceCheckpointRoute,
	buildSpaceCronjobNewRoute,
	buildSpaceCronjobRoute,
	buildSpaceDetailRoute,
	buildSpaceFileRoute,
	buildSpaceSessionRoute,
	buildSpaceTaskRoute,
} from "$lib/space-routes";
import { messageCache } from "$lib/stores/message-cache";
import {
	fetchSessionListWithCache,
	getCachedSessionList,
	onSessionListCacheUpdated,
	patchCachedSessionList,
	setCachedSessionList,
} from "$lib/stores/session-list-cache";
import { sessionPendingStore } from "$lib/stores/session-pending.svelte";
import { unreadTracker } from "$lib/stores/session-state.svelte";
import {
	clearCachedSpaceFsSubtree,
	fetchSpaceFsDirWithCache,
	getCachedSpaceFsDir,
	getCachedSpaceFsDirMeta,
	patchCachedSpaceFsDir,
} from "$lib/stores/space-fs-cache";
import {
	RIGHT_SIDEBAR_MAX,
	RIGHT_SIDEBAR_MIN,
	uiState,
} from "$lib/stores/ui.svelte";

type Props = {
	data: {
		spaceId: string;
		view:
			| "space"
			| "session"
			| "file"
			| "checkpoint"
			| "checkpoint-new"
			| "cronjob"
			| "cronjob-new"
			| "task";
		sessionId?: string | null;
		filePath?: string | null;
		checkpointId?: string | null;
		cronjobId?: string | null;
		taskId?: string | null;
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
	session: SessionRecord | undefined;
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
const routeView = $derived(data.view);
const routeSessionId = $derived(data.sessionId ?? null);
const routeFilePath = $derived(data.filePath ?? null);
const routeCheckpointId = $derived(data.checkpointId ?? null);
const routeCronjobId = $derived(data.cronjobId ?? null);
const routeTaskId = $derived(data.taskId ?? null);
const fileMode = $derived<"chat" | "file">(
	routeView === "file" ? "file" : "chat",
);
const isRightDrawerVisible = $derived(
	uiState.rightIsDragging || uiState.mobileRightDrawerOpen,
);

let space = $state<SpaceRecord | null>(null);
// True when the backend returned only minimal info (session-level access only)
const spaceHasMinimalAccess = $derived(space?.accessLevel === "minimal");
let spaceSessions = $state<SessionRecord[]>([]);
let sessionStateById = $state<Record<string, SessionViewState>>({});
let activeSessionId = $state<string | null>(null);
let input = $state("");
let imageAttachments = $state<ComposerImageAttachment[]>([]);
let sending = $state(false);
let spaceLoadError = $state("");
let renamingSpace = $state(false);
let renameInput = $state("");
let renameSaving = $state(false);
let renameError = $state("");
let streamStatus = $state<"idle" | "streaming" | "done" | "error">("idle");
let streamError = $state("");
let streamingContentBlocks = $state<ContentBlock[]>([]);
let streamingDraftTruncatedStartBySessionId = $state<Record<string, boolean>>(
	{},
);
let streamingDraftAnchorUserMessageIdBySessionId = $state<
	Record<string, string | null>
>({});
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
let fileTreeRequestToken = $state(0);
let directoryLoadTokenByPath = $state<Record<string, number>>({});
let openFile = $state<SpaceFsFileResponse | null>(null);
let openFileDraft = $state("");
let openFileLoading = $state(false);
let openFileSaving = $state(false);
let openFileError = $state<string | null>(null);
let openFileTooLarge = $state(false);

// Inline file panel state (opened from sidebar, not via route)
let inlineFile = $state<{
	response: SpaceFsFileResponse | null;
	draft: string;
	path: string;
	loading: boolean;
	saving: boolean;
	error: string | null;
	tooLarge: boolean;
} | null>(null);
const inlineFileDirty = $derived(
	Boolean(
		inlineFile &&
			inlineFile.response?.kind === "text" &&
			inlineFile.draft !== inlineFile.response.content,
	),
);
const inlineFileIsMarkdown = $derived(
	Boolean(
		inlineFile?.response?.kind === "text" &&
			/\.md$/i.test(inlineFile.response.path),
	),
);
const inlineFileExt = $derived.by(() => {
	if (!inlineFile || inlineFile.response?.kind !== "text") return "plaintext";
	return (
		inlineFile.response.name.split(".").pop()?.toLowerCase() ?? "plaintext"
	);
});
const inlineFileIsImage = $derived(
	Boolean(inlineFile?.response?.mimeType?.startsWith("image/")),
);
const inlineFileIsVideo = $derived(
	Boolean(inlineFile?.response?.mimeType?.startsWith("video/")),
);
const inlineFileIsText = $derived(
	Boolean(inlineFile?.response?.kind === "text"),
);
const inlineFileDataUrl = $derived.by(() => {
	if (!inlineFile || inlineFile.response?.kind !== "binary") return null;
	const mime = inlineFile.response.mimeType ?? "application/octet-stream";
	return `data:${mime};base64,${inlineFile.response.content}`;
});
const inlineFileDownloadUrl = $derived.by(() => {
	if (!inlineFile) return "";
	return `/api/spaces/${spaceId}/fs/download?path=${encodeURIComponent(inlineFile.path)}`;
});
const inlineFileDownloadName = $derived.by(() => {
	if (!inlineFile) return "";
	return inlineFile.path.split("/").pop() ?? "download";
});
let inlineFileMarkdownHtml = $state("");
let inlineFileEdit = $state(true);

// Image zoom state (for both route-based and inline file viewers)
let openFileZoom = $state(1);
let openFilePanX = $state(0);
let openFilePanY = $state(0);
let openFileDragging = $state(false);
let inlineFileZoom = $state(1);
let inlineFilePanX = $state(0);
let inlineFilePanY = $state(0);
let inlineFileDragging = $state(false);
let inlineFileCopied = $state(false);
let inlineFileCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let openFileCopied = $state(false);
let openFileCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let inlineFilePanelWidth = $state(480);
let inlineFilePanelResizeCleanup: (() => void) | null = null;

const openFilePanHandlers = makeImagePanHandlers(
	() => openFileZoom,
	() => openFilePanX,
	() => openFilePanY,
	(v) => (openFilePanX = v),
	(v) => (openFilePanY = v),
	(v) => (openFileDragging = v),
);
const inlineFilePanHandlers = makeImagePanHandlers(
	() => inlineFileZoom,
	() => inlineFilePanX,
	() => inlineFilePanY,
	(v) => (inlineFilePanX = v),
	(v) => (inlineFilePanY = v),
	(v) => (inlineFileDragging = v),
);

const fileDirty = $derived(
	Boolean(
		openFile && openFile.kind === "text" && openFileDraft !== openFile.content,
	),
);
const openFileIsMarkdown = $derived(
	Boolean(openFile?.kind === "text" && /\.md$/i.test(openFile.path)),
);
const openFileExt = $derived.by(() => {
	if (!openFile || openFile.kind !== "text") return "plaintext";
	return openFile.name.split(".").pop()?.toLowerCase() ?? "plaintext";
});
const openFileIsImage = $derived(
	Boolean(openFile?.mimeType?.startsWith("image/")),
);
const openFileIsVideo = $derived(
	Boolean(openFile?.mimeType?.startsWith("video/")),
);
const openFileIsText = $derived(Boolean(openFile?.kind === "text"));
const openFileDataUrl = $derived.by(() => {
	if (!openFile || openFile.kind !== "binary") return null;
	const mime = openFile.mimeType ?? "application/octet-stream";
	return `data:${mime};base64,${openFile.content}`;
});
const openFileDownloadUrl = $derived.by(() => {
	if (!routeFilePath) return "";
	return `/api/spaces/${spaceId}/fs/download?path=${encodeURIComponent(routeFilePath)}`;
});
const openFileDownloadName = $derived.by(() => {
	if (!routeFilePath) return "";
	return routeFilePath.split("/").pop() ?? "download";
});

let fileMarkdownHtml = $state("");
let fileEdit = $state(true);

$effect(() => {
	const current = openFile;
	if (!current || current.kind !== "text" || !/\.md$/i.test(current.path)) {
		fileMarkdownHtml = "";
		return;
	}
	void renderMarkdown(current.content)
		.then((html) => {
			if (openFile?.path === current.path) fileMarkdownHtml = html;
		})
		.catch(() => {
			fileMarkdownHtml = "";
		});
});

$effect(() => {
	if (openFile) fileEdit = true;
});

$effect(() => {
	const current = inlineFile?.response;
	if (!current || current.kind !== "text" || !/\.md$/i.test(current.path)) {
		inlineFileMarkdownHtml = "";
		return;
	}
	void renderMarkdown(current.content)
		.then((html) => {
			if (inlineFile?.response?.path === current.path)
				inlineFileMarkdownHtml = html;
		})
		.catch(() => {
			inlineFileMarkdownHtml = "";
		});
});

$effect(() => {
	if (inlineFile) inlineFileEdit = true;
});

let pageMounted = false;
let pageVisible = true;
let pageOnline = true;
let wsConnected = $state(true);
let wsStatus = $state<"connected" | "reconnecting" | "reconnected">(
	"connected",
);
let wsRecoveredNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let statusRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let statusRefreshInFlight = false;
let creatingSession = $state(false);
let createSessionError = $state("");
let loadingSessionIds = $state<Record<string, boolean>>({});
let bootstrapping = $state(true);
let spaceStatusNotice = $state("");
let spaceStatusNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let shouldAutoFollow = $state(true);
let hasUnread = $derived.by(() => {
	if (
		!activeSessionState?.session ||
		!activeSessionState?.loaded ||
		!activeSessionState.messages.length
	)
		return false;
	return unreadTracker.isUnread(activeSessionState.session);
});
let autoScrollGuard = $state(false);
let restoringBottomSessionId = $state<string | null>(null);
let rightSidebarResizeCleanup: (() => void) | null = null;
let listEl = $state<HTMLDivElement | null>(null);
let chatTimelineRef = $state<{
	preparePrepend: () => void;
	finalizePrepend: () => void;
} | null>(null);
let streamingSessionId: string | null = null;
let preloadingSessionIds = new Set<string>();
type SessionScrollAnchor = {
	sequence: number;
	offset: number;
	updatedAt: number;
};
const SESSION_SCROLL_ANCHOR_STORAGE_KEY = "cohub:session_scroll_anchor";
let scrollAnchorBySession = $state.raw(new Map<string, SessionScrollAnchor>());
let suppressScrollSaveSessionIds = $state.raw(new Set<string>());
let pendingRestoreSessionId = $state<string | null>(null);
let persistScrollAnchorsTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Settings & Share ───
let showSettings = $state(false);
let showShareModal = $state(false);
let shareModalSessionId = $state<string | null>(null);
let shareCopied = $state(false);
let shareCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let shareModalError = $state("");
let shareModalSaving = $state(false);
let checkpointDetail = $state<CheckpointRecord | null>(null);
let checkpointDetailLoading = $state(false);
let checkpointDetailError = $state("");
let checkpointCopied = $state(false);
let checkpointCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let checkpointCreateDescription = $state("");
let checkpointCreateSubmitting = $state(false);
let checkpointCreateError = $state("");

// ─── Cronjobs ───
let cronjobDetail = $state<CronJobRecord | null>(null);
let cronjobDetailLoading = $state(false);
let cronjobDetailError = $state("");
let cronjobRuns = $state<TaskRunRecord[]>([]);
let cronjobRunsLoading = $state(false);
let cronjobActionInProgress = $state(false);
let cronjobToggleError = $state("");

// ─── Cronjob New Form ───
let cronjobNewTitle = $state("");
let cronjobNewExpression = $state("");
let cronjobNewPrompt = $state("");
let cronjobNewSubmitting = $state(false);
let cronjobNewError = $state("");

// ─── Tasks ───
let taskRunDetail = $state<TaskRunRecord | null>(null);
let taskRunDetailLoading = $state(false);
let taskRunDetailError = $state("");

// ─── Space access & members ───
let spaceAccess = $state<SpaceAccessPolicy | null>(null);
let savingAccess = $state(false);

// Session-level access cache
let sessionAccessById = $state<Record<string, SpaceAccessPolicy | null>>({});

// Members
let spaceMembers = $state<SpaceMember[]>([]);
let loadingMembers = $state(false);
let addingMemberUuid = $state("");
let addingMemberRole = $state<SpaceRole>("guest");
let savingMember = $state(false);
let addingMemberError = $state("");

function getSessionTitle(session: SessionRecord): string {
	const candidates = [session.title, session.latestMessageText];
	for (const candidate of candidates) {
		const normalized = candidate
			?.replace(/\s+/g, " ")
			.replace(/^[:\-\s]+/, "")
			.trim();
		if (normalized) return normalized.slice(0, 36);
	}
	return "New chat";
}

function hasSessionPermission(sessionId: string): boolean {
	const access = sessionAccessById[sessionId];
	return (
		!!access &&
		(access.anonymous_user === "guest" ||
			access.anonymous_user === "maker" ||
			access.signed_in_user === "guest" ||
			access.signed_in_user === "maker")
	);
}

async function loadPermissions() {
	try {
		const access = await sdk.space(spaceId).access.get();
		spaceAccess = access;
	} catch {
		// Non-blocking
	}
}

async function setSpaceAccess(body: {
	signed_in_user?: SpaceRole | null;
	anonymous_user?: SpaceRole | null;
}) {
	savingAccess = true;
	try {
		spaceAccess = await sdk.space(spaceId).access.set(body);
	} catch {
		// Silently fail
	} finally {
		savingAccess = false;
	}
}

async function removeSessionAccess(sessionId: string) {
	try {
		await sdk.sessionAccess.remove(sessionId);
		sessionAccessById = { ...sessionAccessById, [sessionId]: null };
	} catch {
		// Silently fail
	}
}

// Member management
async function loadMembers() {
	loadingMembers = true;
	try {
		const result = await sdk.space(spaceId).members.list();
		spaceMembers = result.items;
	} catch {
		// Non-blocking
	} finally {
		loadingMembers = false;
	}
}

async function handleAddMember() {
	if (!addingMemberUuid.trim()) return;
	savingMember = true;
	addingMemberError = "";
	try {
		await sdk
			.space(spaceId)
			.members.update(addingMemberUuid.trim(), addingMemberRole);
		addingMemberUuid = "";
		await loadMembers();
	} catch (error) {
		addingMemberError =
			error instanceof Error ? error.message : "Failed to add member";
	} finally {
		savingMember = false;
	}
}

async function handleUpdateMemberRole(userId: string, role: SpaceRole) {
	try {
		await sdk.space(spaceId).members.update(userId, role);
		await loadMembers();
	} catch {
		// Silently fail
	}
}

async function handleRemoveMember(userId: string) {
	try {
		await sdk.space(spaceId).members.remove(userId);
		await loadMembers();
	} catch {
		// Silently fail
	}
}

async function loadCheckpointDetail(checkpointId: string) {
	checkpointDetailLoading = true;
	checkpointDetailError = "";
	try {
		const result = await sdk.space(spaceId).checkpoints.get(checkpointId);
		checkpointDetail = result.checkpoint;
	} catch (error) {
		checkpointDetail = null;
		checkpointDetailError =
			error instanceof Error ? error.message : "Failed to load save";
	} finally {
		checkpointDetailLoading = false;
	}
}

async function handleCopyCheckpointCommitHash() {
	if (!checkpointDetail) return;
	await navigator.clipboard.writeText(checkpointDetail.commitHash);
	checkpointCopied = true;
	if (checkpointCopiedTimer) clearTimeout(checkpointCopiedTimer);
	checkpointCopiedTimer = setTimeout(() => {
		checkpointCopied = false;
	}, 1800);
}

async function handleCreateCheckpointSubmit(event: SubmitEvent) {
	event.preventDefault();
	if (checkpointCreateSubmitting) return;
	checkpointCreateError = "";
	checkpointCreateSubmitting = true;
	try {
		const { taskRunId } = await sdk
			.space(spaceId)
			.checkpoints.create(checkpointCreateDescription.trim() || null);
		const run = await pollCheckpointJob(taskRunId);
		const checkpointId =
			typeof run.result === "object" &&
			run.result !== null &&
			"checkpointId" in run.result &&
			typeof run.result.checkpointId === "string"
				? run.result.checkpointId
				: null;
		window.dispatchEvent(
			new CustomEvent("cohub:checkpoints-updated", { detail: { spaceId } }),
		);
		if (checkpointId) {
			await goto(buildSpaceCheckpointRoute(spaceId, checkpointId));
			return;
		}
		await goto(buildSpaceDetailRoute(spaceId));
	} catch (error) {
		checkpointCreateError =
			error instanceof Error ? error.message : "Failed to save checkpoint";
	} finally {
		checkpointCreateSubmitting = false;
	}
}

// ─── Cronjob detail & actions ───

async function loadCronjobDetail(cronjobId: string) {
	cronjobDetailLoading = true;
	cronjobDetailError = "";
	cronjobToggleError = "";
	try {
		const { jobs } = await sdk.cronJobs.list(spaceId);
		const job = jobs.find((j) => j.id === cronjobId) ?? null;
		if (!job) {
			cronjobDetail = null;
			cronjobDetailError = "Scheduled job not found";
			return;
		}
		cronjobDetail = job;
		const { runs } = await sdk.cronJobs.runs(cronjobId);
		cronjobRuns = runs;
	} catch (error) {
		cronjobDetail = null;
		cronjobDetailError =
			error instanceof Error ? error.message : "Failed to load scheduled job";
	} finally {
		cronjobDetailLoading = false;
	}
}

async function handleToggleCronjob(enabled: boolean) {
	if (!cronjobDetail || cronjobActionInProgress) return;
	cronjobActionInProgress = true;
	try {
		await sdk.cronJobs.toggle(cronjobDetail.id, enabled);
		cronjobDetail = { ...cronjobDetail, enabled };
	} catch (error) {
		cronjobToggleError =
			error instanceof Error ? error.message : "Failed to toggle";
		void loadCronjobDetail(cronjobDetail.id);
	} finally {
		cronjobActionInProgress = false;
	}
}

async function handleDeleteCronjob() {
	if (
		!cronjobDetail ||
		!confirm("Are you sure you want to delete this cronjob?")
	)
		return;
	cronjobActionInProgress = true;
	try {
		await sdk.cronJobs.delete(cronjobDetail.id);
		await goto(buildSpaceDetailRoute(spaceId));
	} catch (error) {
		cronjobDetailError =
			error instanceof Error ? error.message : "Failed to delete";
		cronjobActionInProgress = false;
	}
}

async function handleCreateCronjobSubmit(event: SubmitEvent) {
	event.preventDefault();
	if (cronjobNewSubmitting) return;
	if (!cronjobNewTitle.trim()) {
		cronjobNewError = "Title is required";
		return;
	}
	if (!cronjobNewExpression.trim()) {
		cronjobNewError = "Cron expression is required";
		return;
	}
	if (!cronjobNewPrompt.trim()) {
		cronjobNewError = "Prompt message is required";
		return;
	}
	const cronParts = cronjobNewExpression.trim().split(/\s+/);
	if (cronParts.length < 5 || cronParts.length > 6) {
		cronjobNewError =
			"Invalid cron expression format. Expected 5 or 6 space-separated fields.";
		return;
	}
	cronjobNewError = "";
	cronjobNewSubmitting = true;
	try {
		await sdk.cronJobs.create({
			title: cronjobNewTitle.trim(),
			taskType: "send_message",
			payload: {
				content: [{ type: "text", text: cronjobNewPrompt.trim() }],
			},
			cronExpression: cronjobNewExpression.trim(),
			spaceId,
		});
		await goto(buildSpaceDetailRoute(spaceId));
	} catch (error) {
		cronjobNewError =
			error instanceof Error ? error.message : "Failed to create cronjob";
	} finally {
		cronjobNewSubmitting = false;
	}
}

// ─── Task detail ───

async function loadTaskDetail(taskId: string) {
	taskRunDetailLoading = true;
	taskRunDetailError = "";
	try {
		const { run } = await sdk.tasks.get(taskId);
		taskRunDetail = run;
	} catch (error) {
		taskRunDetail = null;
		taskRunDetailError =
			error instanceof Error ? error.message : "Failed to load task run";
	} finally {
		taskRunDetailLoading = false;
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
		await sdk.sessionAccess.set(shareModalSessionId, {
			anonymous_user: "guest",
		});
		const url = `${window.location.origin}${buildSpaceSessionRoute(spaceId, shareModalSessionId)}`;
		await navigator.clipboard.writeText(url);
		shareCopied = true;
		if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
		shareCopiedTimer = setTimeout(() => {
			shareCopied = false;
		}, 2000);
		sessionAccessById = {
			...sessionAccessById,
			[shareModalSessionId]: { signed_in_user: null, anonymous_user: "guest" },
		};
	} catch (error) {
		shareModalError =
			error instanceof Error ? error.message : "Failed to share session";
	} finally {
		shareModalSaving = false;
	}
}

async function makeSessionPrivate() {
	if (!shareModalSessionId) return;
	shareModalError = "";
	shareModalSaving = true;
	try {
		await sdk.sessionAccess.remove(shareModalSessionId);
		sessionAccessById = { ...sessionAccessById, [shareModalSessionId]: null };
		showShareModal = false;
	} catch (error) {
		shareModalError =
			error instanceof Error ? error.message : "Failed to make session private";
	} finally {
		shareModalSaving = false;
	}
}

const activeSessionState = $derived(
	activeSessionId ? (sessionStateById[activeSessionId] ?? null) : null,
);
const bootstrapMeta = $derived.by(() => {
	const raw = space?.meta;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const bootstrap = (raw as Record<string, unknown>).bootstrap;
	if (!bootstrap || typeof bootstrap !== "object" || Array.isArray(bootstrap))
		return null;
	return bootstrap as Record<string, unknown>;
});
const bootstrapStatus = $derived.by<
	"pending" | "running" | "ready" | "failed" | null
>(() => {
	const value = bootstrapMeta?.status;
	return value === "pending" ||
		value === "running" ||
		value === "ready" ||
		value === "failed"
		? value
		: null;
});
const bootstrapStage = $derived.by<string | null>(() => {
	const value = bootstrapMeta?.stage;
	return typeof value === "string" && value.trim().length > 0 ? value : null;
});
const bootstrapErrorMessage = $derived.by<string | null>(() => {
	const value = bootstrapMeta?.errorMessage;
	return typeof value === "string" && value.trim().length > 0 ? value : null;
});
const bootstrapSourceLabel = $derived.by(() => {
	const source = bootstrapMeta?.source;
	if (!source || typeof source !== "object" || Array.isArray(source))
		return "Blank";
	const type = (source as Record<string, unknown>).type;
	if (type === "git_repo") return "Git Repo";
	if (type === "checkpoint") return "Checkpoint";
	return "Blank";
});
const bootstrapStatusTone = $derived.by(() => {
	if (bootstrapStatus === "failed")
		return "text-error-soft border-error-soft/20 bg-error-soft/8";
	if (bootstrapStatus === "ready")
		return "text-success-soft border-success-soft/20 bg-success-soft/8";
	return "text-text-secondary border-border-subtle bg-bg-surface";
});
const canCreateSession = $derived(Boolean(space && !creatingSession));
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
	activeSessionId
		? (sessionPendingStore.pendingBySessionId[activeSessionId] ?? [])
		: [],
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
						anchorUserMessageId: activeSessionId
							? (streamingDraftAnchorUserMessageIdBySessionId[
									activeSessionId
								] ?? null)
							: null,
						contentBlocks: streamingContentBlocks,
						truncatedStart: activeSessionId
							? (streamingDraftTruncatedStartBySessionId[activeSessionId] ??
								false)
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
		const catalog = await sdk.models.list();
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

function navigateToSession(
	sessionId: string,
	options?: { replaceState?: boolean },
) {
	void goto(buildSpaceSessionRoute(spaceId, sessionId), {
		replaceState: options?.replaceState ?? true,
		keepFocus: true,
		noScroll: true,
	});
}

function updateUrlSession(sessionId: string | null) {
	if (sessionId) {
		navigateToSession(sessionId, { replaceState: true });
		return;
	}
	void goto(buildSpaceDetailRoute(spaceId), {
		replaceState: true,
		keepFocus: true,
		noScroll: true,
	});
}

function loadSessionScrollAnchors() {
	try {
		const raw = localStorage.getItem(SESSION_SCROLL_ANCHOR_STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Record<string, SessionScrollAnchor>;
		scrollAnchorBySession = new Map(
			Object.entries(parsed).filter(([, anchor]) =>
				Boolean(
					anchor &&
						typeof anchor.sequence === "number" &&
						typeof anchor.offset === "number",
				),
			),
		);
	} catch {
		// ignore
	}
}

function persistSessionScrollAnchorsNow() {
	try {
		const data = Object.fromEntries(scrollAnchorBySession.entries());
		localStorage.setItem(
			SESSION_SCROLL_ANCHOR_STORAGE_KEY,
			JSON.stringify(data),
		);
	} catch {
		// ignore
	}
}

function schedulePersistSessionScrollAnchors() {
	if (persistScrollAnchorsTimer) clearTimeout(persistScrollAnchorsTimer);
	persistScrollAnchorsTimer = setTimeout(() => {
		persistScrollAnchorsTimer = null;
		persistSessionScrollAnchorsNow();
	}, 120);
}

function setSessionScrollAnchor(
	sessionId: string,
	anchor: SessionScrollAnchor,
) {
	scrollAnchorBySession.set(sessionId, anchor);
	schedulePersistSessionScrollAnchors();
}

function clearSessionScrollAnchor(sessionId: string) {
	if (!scrollAnchorBySession.delete(sessionId)) return;
	schedulePersistSessionScrollAnchors();
}

function getMessageElementAbsoluteTop(node: HTMLElement) {
	if (!listEl) return 0;
	const containerRect = listEl.getBoundingClientRect();
	const nodeRect = node.getBoundingClientRect();
	return listEl.scrollTop + (nodeRect.top - containerRect.top);
}

function captureCurrentScrollAnchor(sessionId: string) {
	if (!listEl) return;
	const nodes = Array.from(
		listEl.querySelectorAll<HTMLElement>("[data-sequence]"),
	);
	if (nodes.length === 0) return;
	const containerRect = listEl.getBoundingClientRect();
	const firstVisible =
		nodes.find(
			(node) => node.getBoundingClientRect().bottom > containerRect.top + 8,
		) ?? nodes[0];
	if (!firstVisible) return;
	const sequence = Number(firstVisible.dataset.sequence);
	if (!Number.isFinite(sequence)) return;
	const absoluteTop = getMessageElementAbsoluteTop(firstVisible);
	setSessionScrollAnchor(sessionId, {
		sequence,
		offset: listEl.scrollTop - absoluteTop,
		updatedAt: Date.now(),
	});
}

function writeBottomScrollAnchor(sessionId: string) {
	if (!listEl) return;
	const nodes = Array.from(
		listEl.querySelectorAll<HTMLElement>("[data-sequence]"),
	);
	const lastNode = nodes.at(-1);
	if (!lastNode) {
		clearSessionScrollAnchor(sessionId);
		return;
	}
	const sequence = Number(lastNode.dataset.sequence);
	if (!Number.isFinite(sequence)) {
		clearSessionScrollAnchor(sessionId);
		return;
	}
	const absoluteTop = getMessageElementAbsoluteTop(lastNode);
	setSessionScrollAnchor(sessionId, {
		sequence,
		offset: listEl.scrollTop - absoluteTop,
		updatedAt: Date.now(),
	});
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

function _getPendingMessages(sessionId: string | null) {
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

function buildFsEntry(path: string, type: SpaceFsEntry["type"]): SpaceFsEntry {
	const normalizedPath = path.trim().replace(/^\/+|\/+$/g, "");
	const name = normalizedPath.split("/").pop() ?? normalizedPath;
	return {
		name,
		path: normalizedPath,
		type,
		size: 0,
		mimeType: null,
		mtimeMs: Date.now(),
	};
}

function getParentDirPath(path: string): string {
	const normalizedPath = path.trim().replace(/^\/+|\/+$/g, "");
	if (!normalizedPath.includes("/")) return "";
	return normalizedPath.slice(0, normalizedPath.lastIndexOf("/"));
}

function updateRootFsEntries(entries: SpaceFsEntry[]) {
	fileTree = makeFsNodes(entries);
}

function patchFsDirectory(
	dirPath: string,
	updater: (entries: SpaceFsEntry[]) => SpaceFsEntry[],
) {
	const nextEntries = patchCachedSpaceFsDir(spaceId, dirPath, updater);
	if (dirPath === "") {
		updateRootFsEntries(nextEntries);
		return nextEntries;
	}
	fileTree = replaceNodeChildren(fileTree, dirPath, makeFsNodes(nextEntries));
	return nextEntries;
}

function makeFsNodes(entries: SpaceFsEntry[]): SpaceFsNode[] {
	return entries.map(makeFsNode);
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

function applySessionsSnapshot(sessions: SessionRecord[]) {
	const sorted = setCachedSessionList(spaceId, sessions);
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

function seedSessions(sessions: SessionRecord[]) {
	applySessionsSnapshot(sessions);
}

async function refreshSessionsList(force = true) {
	try {
		const sessions = await fetchSessionListWithCache(
			spaceId,
			async () => {
				const result = await sdk.space(spaceId).sessions.list();
				return result.sessions ?? [];
			},
			{ force },
		);
		applySessionsSnapshot(sessions);
	} catch {
		// Non-blocking
	}
}

async function loadSpace(_options?: { force?: boolean }) {
	spaceLoadError = "";
	const force = _options?.force ?? false;

	if (!force) {
		const cachedSessions = getCachedSessionList(spaceId);
		if (cachedSessions && cachedSessions.length > 0) {
			seedSessions(cachedSessions);
		}
	}

	const tasks: Array<Promise<void>> = [];
	tasks.push(
		(async () => {
			try {
				space = await sdk.space(spaceId).get();
			} catch (error) {
				spaceLoadError =
					error instanceof Error ? error.message : "Failed to load space";
			}
		})(),
	);

	tasks.push(
		(async () => {
			try {
				const sessions = await fetchSessionListWithCache(
					spaceId,
					async () => {
						const result = await sdk.space(spaceId).sessions.list();
						return result.sessions ?? [];
					},
					{ force },
				);
				seedSessions(sessions);
			} catch {
				// Sessions list not available — if viewing a session, fetch it directly
				if (routeView === "session" && routeSessionId) {
					void (async () => {
						try {
							const { session } = await sdk
								.space(spaceId)
								.session(routeSessionId)
								.get();
							seedSessions([session]);
						} catch {
							// Silently fail
						}
					})();
				}
			}
		})(),
	);

	tasks.push(
		(async () => {
			try {
				await loadPermissions();
			} catch {
				// Non-blocking
			}
		})(),
	);

	tasks.push(
		(async () => {
			try {
				await loadMembers();
			} catch {
				// Non-blocking
			}
		})(),
	);

	await Promise.all(tasks);
}

function showSpaceStatusNotice(message: string) {
	spaceStatusNotice = message;
	if (spaceStatusNoticeTimer) clearTimeout(spaceStatusNoticeTimer);
	spaceStatusNoticeTimer = setTimeout(() => {
		spaceStatusNotice = "";
		spaceStatusNoticeTimer = null;
	}, 2800);
}

function getStatusRefreshIntervalMs() {
	if (!pageVisible || !pageOnline) return null;
	if (bootstrapStatus === "pending" || bootstrapStatus === "running") {
		return 4000;
	}
	if (bootstrapStatus === "failed") {
		return 15000;
	}
	return null;
}

async function refreshSpaceStatus() {
	if (statusRefreshInFlight) return;
	statusRefreshInFlight = true;
	try {
		const nextSpace = await sdk.space(spaceId).get();
		const previousBootstrapStatus = bootstrapStatus;
		space = nextSpace;
		const nextBootstrap = (() => {
			const raw = nextSpace.meta;
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
			const bootstrap = (raw as Record<string, unknown>).bootstrap;
			if (
				!bootstrap ||
				typeof bootstrap !== "object" ||
				Array.isArray(bootstrap)
			)
				return null;
			const status = (bootstrap as Record<string, unknown>).status;
			return typeof status === "string" ? status : null;
		})();
		if (previousBootstrapStatus !== "ready" && nextBootstrap === "ready") {
			showSpaceStatusNotice("Workspace prepared");
		}
	} finally {
		statusRefreshInFlight = false;
	}
}

function formatDateTime(dateStr: string | null | undefined): string {
	if (!dateStr) return "—";
	const d = new Date(dateStr);
	return d.toLocaleString("en-US", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatShortDateTime(dateStr: string | null | undefined): string {
	if (!dateStr) return "—";
	const d = new Date(dateStr);
	return d.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** i;
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

// Image pan handlers
function makeImagePanHandlers(
	zoom: () => number,
	panX: () => number,
	panY: () => number,
	setPanX: (v: number) => void,
	setPanY: (v: number) => void,
	setDragging: (v: boolean) => void,
) {
	let dragStartX = 0;
	let dragStartY = 0;
	let startPanX = 0;
	let startPanY = 0;

	return {
		start: (e: MouseEvent) => {
			if (zoom() <= 1) return;
			e.preventDefault();
			dragStartX = e.clientX;
			dragStartY = e.clientY;
			startPanX = panX();
			startPanY = panY();
			setDragging(true);
			document.addEventListener("mousemove", handleMove);
			document.addEventListener("mouseup", handleEnd);
		},
	};

	function handleMove(e: MouseEvent) {
		const dx = e.clientX - dragStartX;
		const dy = e.clientY - dragStartY;
		setPanX(startPanX + dx);
		setPanY(startPanY + dy);
	}

	function handleEnd() {
		setDragging(false);
		document.removeEventListener("mousemove", handleMove);
		document.removeEventListener("mouseup", handleEnd);
	}
}

function taskRunStatusBadge(run: TaskRunRecord) {
	switch (run.status) {
		case "completed":
			return {
				label: "Completed",
				color: "text-status-running",
				dot: "bg-status-running",
			};
		case "failed":
			return {
				label: "Failed",
				color: "text-status-error",
				dot: "bg-status-error",
			};
		case "running":
			return { label: "Running", color: "text-info", dot: "bg-info" };
		case "pending":
			return { label: "Pending", color: "text-warning", dot: "bg-warning" };
		default:
			return {
				label: run.status,
				color: "text-text-placeholder",
				dot: "bg-text-placeholder",
			};
	}
}

function taskRunDuration(run: TaskRunRecord): string {
	if (!run.startedAt || !run.finishedAt) return "—";
	const ms = Math.max(
		0,
		new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime(),
	);
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatBootstrapStage(stage: string | null) {
	if (!stage) return "Waiting";
	if (stage === "prepare") return "Preparing workspace";
	if (stage === "import") return "Importing repository";
	if (stage === "checkpoint_restore") return "Restoring save";
	if (stage === "push") return "Pushing initial state";
	if (stage === "finalize") return "Finalizing";
	return stage.replace(/_/g, " ");
}

function formatBootstrapStatus(status: string | null) {
	if (!status) return "Pending";
	if (status === "running") return "Running";
	if (status === "ready") return "Ready";
	if (status === "failed") return "Failed";
	return "Pending";
}

async function handleRenameSpace(newName: string) {
	renameSaving = true;
	renameError = "";
	try {
		const result = await sdk.space(spaceId).rename(newName);
		space = result.space;
		renamingSpace = false;
	} catch (error) {
		renameError =
			error instanceof Error ? error.message : "Failed to rename space";
	} finally {
		renameSaving = false;
	}
}

async function loadSessionState(sessionId: string, force = false) {
	const existing = sessionStateById[sessionId];
	if (loadingSessionIds[sessionId] && !force) return;
	if (existing?.loaded && !force) return;

	const cached = await messageCache.get(sessionId);
	const anchor = scrollAnchorBySession.get(sessionId);
	const canBootstrapFromCache = Boolean(
		!force &&
			cached &&
			cached.messages.length > 0 &&
			anchor &&
			cached.messages.some((message) => message.sequence === anchor.sequence),
	);
	if (cached && canBootstrapFromCache) {
		sessionPendingStore.reconcilePersisted(sessionId, cached.messages);
		sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				session:
					existing?.session ?? spaceSessions.find((s) => s.id === sessionId),
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
		return;
	}

	const sessionObj =
		existing?.session ?? spaceSessions.find((s) => s.id === sessionId);
	// New session with no messages — skip the unnecessary listPaginated call
	if (sessionObj && !sessionObj.lastMessageId) {
		sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				session: sessionObj,
				messages: [],
				loading: false,
				loaded: true,
				error: "",
				hasMore: false,
				loadingOlder: false,
				oldestCursor: undefined,
			},
		};
		return;
	}

	loadingSessionIds = { ...loadingSessionIds, [sessionId]: true };
	sessionStateById = {
		...sessionStateById,
		[sessionId]: {
			session: sessionObj,
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
		const response = await sdk
			.space(spaceId)
			.session(sessionId)
			.messages.listPaginated({
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
	} catch (error) {
		sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				session:
					existing?.session ?? spaceSessions.find((s) => s.id === sessionId),
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
		const response = await sdk
			.space(spaceId)
			.session(sessionId)
			.messages.listPaginated({
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
	if (!state?.hasMore || state.loadingOlder) return;
	chatTimelineRef?.preparePrepend();
	sessionStateById = {
		...sessionStateById,
		[sessionId]: {
			...state,
			loadingOlder: true,
		},
	};
	try {
		const response = await sdk
			.space(spaceId)
			.session(sessionId)
			.messages.listPaginated({
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
	if (!state?.hasMore || state.loadingOlder) return;
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
				? block.content.flatMap((item: unknown): ContentBlock[] =>
						typeof item === "object" && item !== null && "type" in item
							? [cloneContentBlock(item as ContentBlock)]
							: [],
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
		const response = await sdk
			.space(spaceId)
			.session(sessionId)
			.messages.listPaginated({
				limit: 30,
			});
		sessionPendingStore.reconcilePersisted(sessionId, response.messages);
		await messageCache.replaceAuthoritativeSnapshot({
			sessionId,
			messages: response.messages,
			hasMore: response.hasMore,
		});
		const existingOlder = state.messages.filter((message) =>
			response.messages.every(
				(incoming: MessageRecord) => incoming.id !== message.id,
			),
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
		console.warn(
			"[reconcileSessionTail] Failed to reconcile session tail:",
			error,
		);
	}
}

async function reconnectSync() {
	if (activeSessionId && sessionStateById[activeSessionId]?.loaded) {
		await reconcileSessionTail(activeSessionId);
		const latestMessageId =
			sessionStateById[activeSessionId]?.session?.lastMessageId;
		if (latestMessageId && shouldAutoFollow) {
			unreadTracker.markViewed(activeSessionId, latestMessageId);
		}
	}
	await refreshSessionsList(true);
	wsConnected = true;
	if (wsRecoveredNoticeTimer) clearTimeout(wsRecoveredNoticeTimer);
	wsStatus = "reconnected";
	wsRecoveredNoticeTimer = setTimeout(() => {
		wsStatus = "connected";
		wsRecoveredNoticeTimer = null;
	}, 1800);
}

async function handleWsEvent(payload: ChannelEnvelope) {
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
			const hadPreviousStreamingPreview = streamingContentBlocks.length > 0;
			const streamingAnchorUserMessageId =
				typeof payload.payload.anchorUserMessageId === "string"
					? payload.payload.anchorUserMessageId
					: null;
			const hasExistingStreamingState =
				streamingContentBlocks.length > 0 ||
				Boolean(
					streamingDraftAnchorUserMessageIdBySessionId[currentActiveSessionId],
				);
			const shouldStartFreshPreview =
				hadPreviousStreamingPreview &&
				streamStatus !== "streaming" &&
				streamingSessionId === currentActiveSessionId;
			const previewBase = shouldStartFreshPreview ? [] : streamingContentBlocks;
			const mergedContent = mergeDeltaBlocks(previewBase, content);
			streamingContentBlocks = mergedContent;
			if (streamingAnchorUserMessageId) {
				streamingDraftAnchorUserMessageIdBySessionId = {
					...streamingDraftAnchorUserMessageIdBySessionId,
					[currentActiveSessionId]: streamingAnchorUserMessageId,
				};
			}
			if (shouldStartFreshPreview) {
				streamingDraftTruncatedStartBySessionId = {
					...streamingDraftTruncatedStartBySessionId,
					[currentActiveSessionId]: false,
				};
				if (!streamingAnchorUserMessageId) {
					streamingDraftAnchorUserMessageIdBySessionId = {
						...streamingDraftAnchorUserMessageIdBySessionId,
						[currentActiveSessionId]: null,
					};
				}
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
			if (shouldAutoFollow) {
				await tick();
				scrollToBottomNow();
			}
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
			void refreshSessionsList(true);
			if (shouldAutoFollow) scrollToBottomNow();
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

		if (message.role === "assistant") {
			streamStatus = "done";
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
		if (shouldAutoFollow) {
			unreadTracker.markViewed(currentActiveSessionId, message.id ?? null);
		}

		const updatedSession = state.session;
		if (updatedSession) {
			const refreshedSession: SessionRecord = {
				...updatedSession,
				lastMessageId: message.id ?? null,
				updatedAt: new Date().toISOString(),
			};
			spaceSessions = patchCachedSessionList(spaceId, (sessions) => [
				refreshedSession,
				...sessions.filter((s) => s.id !== updatedSession.id),
			]);
			sessionStateById = {
				...sessionStateById,
				[currentActiveSessionId]: {
					...sessionStateById[currentActiveSessionId],
					session: refreshedSession,
				},
			};
			if (message.role === "user") {
				void refreshSessionsList(true);
			}
		}
	} catch (error) {
		console.error("[WS] handleWsEvent error:", error);
	}
}

function clearStreamingState(sessionId: string | null = activeSessionId) {
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
		!activeSessionState?.session ||
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

	// Clear input immediately so it disappears from the composer at the same
	// time the pending message appears in the list — avoids the awkward "stuck"
	// feeling where the message shows in the list but lingers in the input.
	const pendingInput = input;
	const pendingAttachments = imageAttachments;
	input = "";
	imageAttachments = [];

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

		await sdk.space(spaceId).session(sessionId).messages.send({
			content,
			model: model?.id,
			provider: model?.provider,
			clientMessageId,
		});

		sessionPendingStore.markStatus(
			sessionId,
			clientMessageId,
			"sent_unconfirmed",
		);
		clearStreamingState();
	} catch (error) {
		// Restore input and attachments on failure so user doesn't lose their message
		input = pendingInput;
		imageAttachments = pendingAttachments;
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
	if (activeSessionId) {
		writeBottomScrollAnchor(activeSessionId);
	}
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
	const threshold = 60;
	const distanceFromBottom =
		listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
	shouldAutoFollow = distanceFromBottom <= threshold;
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

function beginInlineFilePanelResize(event: PointerEvent) {
	event.preventDefault();
	if (window.innerWidth < 1024) return;
	inlineFilePanelResizeCleanup?.();
	const startX = event.clientX;
	const startWidth = inlineFilePanelWidth;
	const minMainWidth = 400;

	const onPointerMove = (moveEvent: PointerEvent) => {
		const delta = startX - moveEvent.clientX;
		const maxAllowed = window.innerWidth - minMainWidth - RIGHT_SIDEBAR_MIN;
		const nextWidth = Math.min(Math.max(280, startWidth + delta), maxAllowed);
		inlineFilePanelWidth = nextWidth;
	};

	const stop = () => {
		document.body.classList.remove("sidebar-resizing");
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", stop);
		window.removeEventListener("pointercancel", stop);
		if (inlineFilePanelResizeCleanup === stop)
			inlineFilePanelResizeCleanup = null;
	};

	inlineFilePanelResizeCleanup = stop;
	document.body.classList.add("sidebar-resizing");
	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", stop);
	window.addEventListener("pointercancel", stop);
}

async function loadFileTree(force = false) {
	const requestToken = fileTreeRequestToken + 1;
	fileTreeRequestToken = requestToken;

	if (!force) {
		const cached = getCachedSpaceFsDir(spaceId, "");
		if (cached && cached.length > 0) {
			fileTree = makeFsNodes(cached);
		}
	}

	if (fileTreeLoading && !force) return;

	const shouldShowLoading = fileTree.length === 0;
	if (shouldShowLoading) {
		fileTreeLoading = true;
	}
	fileTreeError = null;

	const cacheMeta = getCachedSpaceFsDirMeta(spaceId, "");
	const shouldFetch = force || !cacheMeta || cacheMeta.isStale;
	if (!shouldFetch) {
		fileTreeLoading = false;
		return;
	}

	try {
		const entries = await fetchSpaceFsDirWithCache(
			spaceId,
			"",
			async () => {
				const tree = await sdk.space(spaceId).files.list("");
				return tree.entries;
			},
			{ force },
		);
		if (requestToken !== fileTreeRequestToken) return;
		fileTree = makeFsNodes(entries);
	} catch (error) {
		if (requestToken !== fileTreeRequestToken) return;
		fileTreeError =
			error instanceof Error ? error.message : "Failed to load files";
	} finally {
		if (requestToken === fileTreeRequestToken) {
			fileTreeLoading = false;
		}
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

	const requestToken = (directoryLoadTokenByPath[node.path] ?? 0) + 1;
	directoryLoadTokenByPath = {
		...directoryLoadTokenByPath,
		[node.path]: requestToken,
	};

	const cached = getCachedSpaceFsDir(spaceId, node.path);
	if (cached) {
		fileTree = replaceNodeChildren(fileTree, node.path, makeFsNodes(cached));
	}
	if (!cached) {
		fileTree = updateNodeState(fileTree, node.path, (item) => ({
			...item,
			isLoading: true,
			isOpen: true,
		}));
	}

	const cacheMeta = getCachedSpaceFsDirMeta(spaceId, node.path);
	const shouldFetch = !cacheMeta || cacheMeta.isStale;
	if (!shouldFetch) {
		fileTree = updateNodeState(fileTree, node.path, (item) => ({
			...item,
			isLoading: false,
			isOpen: true,
			isLoaded: true,
		}));
		return;
	}

	try {
		const entries = await fetchSpaceFsDirWithCache(
			spaceId,
			node.path,
			async () => {
				const tree = await sdk.space(spaceId).files.list(node.path);
				return tree.entries;
			},
		);
		if (directoryLoadTokenByPath[node.path] !== requestToken) return;
		fileTree = replaceNodeChildren(fileTree, node.path, makeFsNodes(entries));
	} catch (error) {
		if (directoryLoadTokenByPath[node.path] !== requestToken) return;
		fileTree = updateNodeState(fileTree, node.path, (item) => ({
			...item,
			isLoading: false,
		}));
		fileTreeError =
			error instanceof Error ? error.message : "Failed to load directory";
	}
}

async function openSpaceFile(path: string) {
	void goto(buildSpaceFileRoute(spaceId, path), {
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
		const file = await sdk.space(spaceId).files.read(path);
		openFile = file;
		openFileDraft = file.kind === "text" ? file.content : "";
	} catch (error) {
		if (error instanceof HttpError && error.status === 413) {
			openFileTooLarge = true;
			openFile = null;
			openFileDraft = "";
			openFileError = null;
		} else {
			openFileError =
				error instanceof Error ? error.message : "Failed to open file";
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
		await sdk.space(spaceId).files.write({
			path: openFile.path,
			content: openFileDraft,
			encoding: "utf-8",
		});
		openFile = {
			...openFile,
			content: openFileDraft,
			size: new Blob([openFileDraft]).size,
		};
		const updatedPath = openFile.path;
		patchFsDirectory(getParentDirPath(updatedPath), (entries) =>
			entries.map((entry) =>
				entry.path === updatedPath
					? {
							...entry,
							size: new Blob([openFileDraft]).size,
							mtimeMs: Date.now(),
						}
					: entry,
			),
		);
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
		await sdk
			.space(spaceId)
			.files.write({ path, content: "", encoding: "utf-8" });
		patchFsDirectory(parentPath, (entries) => [
			...entries,
			buildFsEntry(path, "file"),
		]);
		await openInlineFile(path);
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
		await sdk.space(spaceId).files.createDir(path);
		patchFsDirectory(parentPath, (entries) => [
			...entries,
			buildFsEntry(path, "dir"),
		]);
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
	const isDirectoryRename = node.type === "dir";
	try {
		await sdk.space(spaceId).files.move({ fromPath: node.path, toPath });
		if (parent === getParentDirPath(toPath)) {
			patchFsDirectory(parent, (entries) =>
				entries.map((entry) =>
					entry.path === node.path
						? {
								...entry,
								name: nextName.trim(),
								path: toPath,
								mtimeMs: Date.now(),
							}
						: entry,
				),
			);
		} else {
			patchFsDirectory(parent, (entries) =>
				entries.filter((entry) => entry.path !== node.path),
			);
			patchFsDirectory(getParentDirPath(toPath), (entries) => [
				...entries,
				{
					...buildFsEntry(toPath, node.type),
					size: node.size,
					mimeType: node.mimeType,
					mtimeMs: Date.now(),
				},
			]);
		}
		if (isDirectoryRename) {
			clearCachedSpaceFsSubtree(spaceId, node.path);
		}
		if (openFile?.path === node.path) {
			closeFile();
		}
		if (inlineFile?.path === node.path) {
			await openInlineFile(toPath);
		}
	} catch (error) {
		fileTreeError = error instanceof Error ? error.message : "Failed to rename";
	}
}

async function handleDeleteNode(node: SpaceFsNode) {
	if (!confirm(`Delete ${node.name}?`)) return;
	try {
		await sdk.space(spaceId).files.delete(node.path, node.type === "dir");
		patchFsDirectory(getParentDirPath(node.path), (entries) =>
			entries.filter((entry) => entry.path !== node.path),
		);
		if (node.type === "dir") {
			clearCachedSpaceFsSubtree(spaceId, node.path);
		}
		if (openFile?.path === node.path) closeFile();
		if (inlineFile?.path === node.path) closeInlineFile();
	} catch (error) {
		fileTreeError = error instanceof Error ? error.message : "Failed to delete";
	}
}

function closeFile() {
	void goto(buildSpaceDetailRoute(spaceId), {
		replaceState: true,
		noScroll: true,
		keepFocus: true,
	});
}

async function openInlineFile(path: string) {
	inlineFile = {
		response: null,
		draft: "",
		path,
		loading: true,
		saving: false,
		error: null,
		tooLarge: false,
	};
	inlineFileEdit = true;
	try {
		const file = await sdk.space(spaceId).files.read(path);
		inlineFile = {
			response: file,
			draft: file.kind === "text" ? file.content : "",
			path,
			loading: false,
			saving: false,
			error: null,
			tooLarge: false,
		};
	} catch (error) {
		if (error instanceof HttpError && error.status === 413) {
			inlineFile = {
				response: null,
				draft: "",
				path,
				loading: false,
				saving: false,
				error: null,
				tooLarge: true,
			};
		} else {
			inlineFile = {
				response: null,
				draft: "",
				path,
				loading: false,
				saving: false,
				error: error instanceof Error ? error.message : "Failed to open file",
				tooLarge: false,
			};
		}
	}
}

function closeInlineFile() {
	inlineFile = null;
}

async function saveInlineFile() {
	if (!inlineFile || inlineFile.response?.kind !== "text") return;
	inlineFile.saving = true;
	inlineFile.error = null;
	try {
		await sdk.space(spaceId).files.write({
			path: inlineFile.path,
			content: inlineFile.draft,
			encoding: "utf-8",
		});
		inlineFile = {
			...inlineFile,
			response: {
				...inlineFile.response,
				content: inlineFile.draft,
				size: new Blob([inlineFile.draft]).size,
			} as SpaceFsFileResponse,
		};
		await loadFileTree(true);
	} catch (error) {
		inlineFile.error =
			error instanceof Error ? error.message : "Failed to save file";
	} finally {
		inlineFile.saving = false;
	}
}

async function handleFileKeyboardSave(event: KeyboardEvent) {
	if (
		(event.metaKey || event.ctrlKey) &&
		event.key.toLowerCase() === "s" &&
		(fileMode === "file" || inlineFile)
	) {
		event.preventDefault();
		if (inlineFile) {
			await saveInlineFile();
		} else {
			await saveOpenFile();
		}
	}
	if (event.key === "Escape" && inlineFile) {
		event.preventDefault();
		closeInlineFile();
	}
}

async function copyFileContent() {
	if (!openFile || openFile.kind !== "text") return;
	await navigator.clipboard.writeText(openFileDraft);
	openFileCopied = true;
	if (openFileCopiedTimer) clearTimeout(openFileCopiedTimer);
	openFileCopiedTimer = setTimeout(() => {
		openFileCopied = false;
	}, 1500);
}

async function copyInlineFileContent() {
	if (!inlineFile || inlineFile.response?.kind !== "text") return;
	await navigator.clipboard.writeText(inlineFile.draft);
	inlineFileCopied = true;
	if (inlineFileCopiedTimer) clearTimeout(inlineFileCopiedTimer);
	inlineFileCopiedTimer = setTimeout(() => {
		inlineFileCopied = false;
	}, 1500);
}

function getCheckpointTitle(checkpoint: CheckpointRecord): string {
	return checkpoint.description || checkpoint.commitHash.slice(0, 12);
}

function formatCheckpointTimestamp(dateStr: string | null | undefined): string {
	if (!dateStr) return "—";
	const d = new Date(dateStr);
	return d.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function handleCreateNewSession() {
	if (!canCreateSession || !space) return;
	creatingSession = true;
	createSessionError = "";
	const createSpaceId = space.id;
	void sdk
		.space(createSpaceId)
		.sessions.create({ source: "web" })
		.then(async (result) => {
			const newSession = result.session;
			const nextSessions = patchCachedSessionList(createSpaceId, (current) => [
				newSession,
				...current.filter((session) => session.id !== newSession.id),
			]);
			seedSessions(nextSessions);
			void loadSpace({ force: true });
			activeSessionId = newSession.id;
			ensureSessionModelLoaded(newSession.id);
			updateUrlSession(newSession.id);
			// New session has no messages — skip the unnecessary listPaginated call
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

function scheduleStatusRefresh() {
	if (statusRefreshTimer) {
		clearTimeout(statusRefreshTimer);
		statusRefreshTimer = null;
	}
	const intervalMs = getStatusRefreshIntervalMs();
	if (!intervalMs || !pageMounted) return;
	statusRefreshTimer = setTimeout(async () => {
		await refreshSpaceStatus().catch(() => undefined);
		scheduleStatusRefresh();
	}, intervalMs);
}

onMount(() => {
	pageMounted = true;
	pageVisible = !document.hidden;
	pageOnline = navigator.onLine;
	loadSessionScrollAnchors();
	const offSessionListCacheUpdated = onSessionListCacheUpdated(
		({ spaceId: updatedSpaceId, sessions }) => {
			if (updatedSpaceId !== spaceId) return;
			// Avoid re-caching data that's already in cache (prevents infinite loop:
			// applySessionsSnapshot → setCachedSessionList → emitUpdated → this handler → applySessionsSnapshot)
			const existing = getCachedSessionList(spaceId);
			if (
				existing &&
				sessions.length === existing.length &&
				sessions.every((s, i) => s.id === existing[i].id)
			) {
				spaceSessions = sessions;
				for (const session of sessions) {
					if (!sessionStateById[session.id]) {
						sessionStateById = {
							...sessionStateById,
							[session.id]: {
								session,
								messages: [],
								loading: false,
								loaded: false,
								error: "",
								hasMore: true,
								loadingOlder: false,
								oldestCursor: undefined,
							},
						};
					}
				}
				return;
			}
			applySessionsSnapshot(sessions);
		},
	);

	// Preload models catalog so model selector is ready immediately
	void loadModelsCatalog();

	const wsEventCleanup = sdk.space(spaceId).subscribe((event) => {
		void handleWsEvent(event as ChannelEnvelope);
	});
	const wsConnectionCleanup = sdk.onConnection((state) => {
		if (state.state === "open") {
			void reconnectSync();
			return;
		}
		if (state.state === "closed" || state.state === "error") {
			wsConnected = false;
			if (wsRecoveredNoticeTimer) {
				clearTimeout(wsRecoveredNoticeTimer);
				wsRecoveredNoticeTimer = null;
			}
			wsStatus = "reconnecting";
		}
	});

	const handleVisibility = () => {
		pageVisible = !document.hidden;
		scheduleStatusRefresh();
		if (pageVisible) {
			void refreshSessionsList(true);
			if (activeSessionId && sessionStateById[activeSessionId]?.loaded) {
				void reconcileSessionTail(activeSessionId);
			}
		}
	};
	const handleOnline = () => {
		pageOnline = true;
		scheduleStatusRefresh();
		if (wsConnected) {
			void refreshSessionsList(true);
		}
	};
	const handleOffline = () => {
		pageOnline = false;
		scheduleStatusRefresh();
	};

	window.addEventListener("visibilitychange", handleVisibility);
	window.addEventListener("online", handleOnline);
	window.addEventListener("offline", handleOffline);
	window.addEventListener("keydown", handleFileKeyboardSave);
	scheduleStatusRefresh();

	void loadSpace()
		.then(async () => {
			void loadFileTree(true);

			const initialSessionId = routeView === "session" ? routeSessionId : null;
			if (initialSessionId) {
				activeSessionId = initialSessionId;
				pendingRestoreSessionId = initialSessionId;
				suppressScrollSaveSessionIds.add(initialSessionId);
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
		offSessionListCacheUpdated();
		if (checkpointCopiedTimer) clearTimeout(checkpointCopiedTimer);
		if (spaceStatusNoticeTimer) clearTimeout(spaceStatusNoticeTimer);
		if (statusRefreshTimer) clearTimeout(statusRefreshTimer);
		if (wsRecoveredNoticeTimer) clearTimeout(wsRecoveredNoticeTimer);
		if (persistScrollAnchorsTimer) clearTimeout(persistScrollAnchorsTimer);
		persistSessionScrollAnchorsNow();
		pageMounted = false;
		wsEventCleanup();
		wsConnectionCleanup();
		window.removeEventListener("visibilitychange", handleVisibility);
		window.removeEventListener("online", handleOnline);
		window.removeEventListener("offline", handleOffline);
		window.removeEventListener("keydown", handleFileKeyboardSave);
		rightSidebarResizeCleanup?.();
		inlineFilePanelResizeCleanup?.();
	};
});

$effect(() => {
	if (
		routeView === "session" &&
		routeSessionId &&
		routeSessionId !== activeSessionId
	) {
		clearStreamingState(activeSessionId);
		activeSessionId = routeSessionId;
		pendingRestoreSessionId = routeSessionId;
		suppressScrollSaveSessionIds.add(routeSessionId);
		ensureSessionModelLoaded(routeSessionId);
		shouldAutoFollow = true;
		const state = sessionStateById[routeSessionId];
		if (state?.session?.lastMessageId)
			unreadTracker.markViewed(routeSessionId, state.session.lastMessageId);
		return;
	}
	if (routeView !== "session" && activeSessionId) {
		clearStreamingState(activeSessionId);
		activeSessionId = null;
	}
});

$effect(() => {
	const el = listEl;
	if (!el) return;
	const container = el as HTMLDivElement;
	function handleScrollTrack() {
		if (activeSessionId && !suppressScrollSaveSessionIds.has(activeSessionId)) {
			captureCurrentScrollAnchor(activeSessionId);
		}
		updateAutoFollow();
	}
	container.addEventListener("scroll", handleScrollTrack, { passive: true });
	return () => container.removeEventListener("scroll", handleScrollTrack);
});

$effect(() => {
	if (!listEl) return;
	const targetId = pendingRestoreSessionId;
	if (!targetId || targetId !== activeSessionId) return;
	const state = sessionStateById[targetId];
	if (!state?.loaded) return;

	const anchor = scrollAnchorBySession.get(targetId);
	const hasCachedAnchor =
		anchor &&
		state.messages.some((message) => message.sequence === anchor.sequence);

	const finishRestore = () => {
		suppressScrollSaveSessionIds.delete(targetId);
		pendingRestoreSessionId = null;
		if (restoringBottomSessionId === targetId) {
			restoringBottomSessionId = null;
		}
		updateAutoFollow();
	};

	const restoreToBottom = () => {
		restoringBottomSessionId = targetId;
		shouldAutoFollow = true;
		const stabilizeBottom = (
			remainingFrames = 8,
			lastHeight = -1,
			sameHeightFrames = 0,
		) => {
			requestAnimationFrame(() => {
				if (!listEl || activeSessionId !== targetId) {
					finishRestore();
					return;
				}
				scrollToBottomNow();
				const currentHeight = listEl.scrollHeight;
				const nextSameHeightFrames =
					currentHeight === lastHeight ? sameHeightFrames + 1 : 0;
				if (remainingFrames > 0 && nextSameHeightFrames < 2) {
					stabilizeBottom(
						remainingFrames - 1,
						currentHeight,
						nextSameHeightFrames,
					);
					return;
				}
				writeBottomScrollAnchor(targetId);
				finishRestore();
			});
		};
		stabilizeBottom();
	};

	if (!anchor || !hasCachedAnchor) {
		clearSessionScrollAnchor(targetId);
		void tick().then(restoreToBottom);
		return;
	}

	const restoreByAnchor = (retries = 2) => {
		requestAnimationFrame(() => {
			if (!listEl) {
				finishRestore();
				return;
			}
			const node = listEl.querySelector<HTMLElement>(
				`[data-sequence="${anchor.sequence}"]`,
			);
			if (!node) {
				if (retries > 0) {
					restoreByAnchor(retries - 1);
					return;
				}
				clearSessionScrollAnchor(targetId);
				restoreToBottom();
				return;
			}
			listEl.scrollTop = getMessageElementAbsoluteTop(node) + anchor.offset;
			shouldAutoFollow = false;
			captureCurrentScrollAnchor(targetId);
			finishRestore();
		});
	};

	void tick().then(() => restoreByAnchor());
});

$effect(() => {
	if (!activeSessionId) return;
	const state = sessionStateById[activeSessionId];
	if (!state?.loaded && !state?.loading) {
		void loadSessionState(activeSessionId);
	}
});

$effect(() => {
	if (routeView !== "file" || !routeFilePath) {
		openFile = null;
		openFileDraft = "";
		openFileError = null;
		openFileTooLarge = false;
		fileMarkdownHtml = "";
		fileEdit = true;
		return;
	}
	void openFileFromUrl(routeFilePath);
});

$effect(() => {
	if (routeView === "checkpoint" && routeCheckpointId) {
		void loadCheckpointDetail(routeCheckpointId);
		return;
	}
	checkpointDetail = null;
	checkpointDetailError = "";
});

$effect(() => {
	if (routeView === "checkpoint-new") {
		checkpointCreateError = "";
	}
});

$effect(() => {
	if (
		(routeView === "cronjob" || routeView === "cronjob-new") &&
		routeCronjobId
	) {
		void loadCronjobDetail(routeCronjobId);
		return;
	}
	if (routeView === "cronjob-new") {
		cronjobNewTitle = "";
		cronjobNewExpression = "";
		cronjobNewPrompt = "";
		cronjobNewError = "";
		cronjobDetail = null;
		cronjobDetailError = "";
		cronjobRuns = [];
		cronjobToggleError = "";
		return;
	}
	cronjobDetail = null;
	cronjobDetailError = "";
	cronjobRuns = [];
	cronjobToggleError = "";
});

$effect(() => {
	if (routeView === "task" && routeTaskId) {
		void loadTaskDetail(routeTaskId);
		return;
	}
	taskRunDetail = null;
	taskRunDetailError = "";
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
		if (
			currentHeight > prevHeight &&
			(shouldAutoFollow || restoringBottomSessionId === activeSessionId) &&
			!autoScrollGuard
		) {
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
      {#if routeView === "session" && activeSessionState?.session}
        <button
          type="button"
          class="text-[13px] text-text-primary truncate max-w-[35%] select-none text-left hover:text-text-secondary transition-colors"
          title="Space details"
        >{space?.name || space?.title || spaceId}</button>
        <span class="text-text-tertiary shrink-0 text-[13px] select-none">/</span>
        <div class="min-w-0 flex items-center gap-2">
          <span class="min-w-0 truncate text-[13px] text-text-secondary">{getSessionTitle(activeSessionState.session)}</span>
          {#if wsStatus === 'reconnecting'}
            <span class="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-warning">
              <span class="h-1.5 w-1.5 rounded-full bg-warning animate-pulse"></span>
              Reconnecting…
            </span>
          {:else if wsStatus === 'reconnected'}
            <span class="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-success-soft">
              <span class="h-1.5 w-1.5 rounded-full bg-success-soft"></span>
              Reconnected
            </span>
          {/if}
        </div>
      {:else if routeView === "checkpoint" && checkpointDetail}
        <button
          type="button"
          class="text-[13px] text-text-primary truncate max-w-[35%] select-none text-left hover:text-text-secondary transition-colors"
          title="Space details"
        >{space?.name || space?.title || spaceId}</button>
        <span class="text-text-tertiary shrink-0 text-[13px] select-none">/</span>
        <span class="text-[13px] text-text-secondary truncate">{getCheckpointTitle(checkpointDetail)}</span>
      {:else if routeView === "checkpoint-new"}
        <button
          type="button"
          class="text-[13px] text-text-primary truncate max-w-[35%] select-none text-left hover:text-text-secondary transition-colors"
          title="Space details"
        >{space?.name || space?.title || spaceId}</button>
        <span class="text-text-tertiary shrink-0 text-[13px] select-none">/</span>
        <span class="text-[13px] text-text-secondary truncate">New save</span>
      {:else if routeView === "cronjob" && cronjobDetail}
        <button
          type="button"
          class="text-[13px] text-text-primary truncate max-w-[35%] select-none text-left hover:text-text-secondary transition-colors"
          title="Space details"
        >{space?.name || space?.title || spaceId}</button>
        <span class="text-text-tertiary shrink-0 text-[13px] select-none">/</span>
        <span class="text-[13px] text-text-secondary truncate">{cronjobDetail.title}</span>
      {:else if routeView === "cronjob-new"}
        <button
          type="button"
          class="text-[13px] text-text-primary truncate max-w-[35%] select-none text-left hover:text-text-secondary transition-colors"
          title="Space details"
        >{space?.name || space?.title || spaceId}</button>
        <span class="text-text-tertiary shrink-0 text-[13px] select-none">/</span>
        <span class="text-[13px] text-text-secondary truncate">New cronjob</span>
      {:else if routeView === "task" && taskRunDetail}
        <button
          type="button"
          class="text-[13px] text-text-primary truncate max-w-[35%] select-none text-left hover:text-text-secondary transition-colors"
          title="Space details"
        >{space?.name || space?.title || spaceId}</button>
        <span class="text-text-tertiary shrink-0 text-[13px] select-none">/</span>
        <span class="text-[13px] text-text-secondary truncate">Task run</span>
      {:else}
        <button
          type="button"
          class="text-[13px] text-text-primary truncate select-none text-left hover:text-text-secondary transition-colors"
        >{space?.name || space?.title || spaceId}</button>
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
    {#if !spaceHasMinimalAccess}
      <button
        type="button"
        class="flex items-center justify-center w-8 h-8 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
        onclick={() => { showSettings = true; }}
        title="Settings"
      >
        <Settings class="w-4 h-4 shrink-0" />
      </button>
    {/if}

    <!-- Toggle right sidebar -->
    {#if !spaceHasMinimalAccess}
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
    {/if}
  {/snippet}
</PageHeader>

<div class="relative flex-1 min-h-0 flex bg-bg-content">
  <div class="flex-1 flex flex-col min-w-0 bg-bg-content">
    {#if routeView === 'checkpoint-new'}
      <div class="flex-1 p-4 overflow-y-auto max-w-2xl">
        {#if spaceLoadError && !spaceHasMinimalAccess}
          <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{spaceLoadError}</div>
        {:else}
          <form onsubmit={handleCreateCheckpointSubmit} class="space-y-3">
            <div class="border border-border-subtle rounded-md bg-bg-surface p-4 space-y-3">
              <div>
                <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Save</div>
                <p class="text-[13px] text-text-tertiary mt-1">Save the current workspace state of <span class="text-text-primary font-medium">{space?.name ?? space?.title ?? spaceId}</span> as a reusable checkpoint.</p>
              </div>

              <div>
                <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="checkpoint-description">Description</label>
                <textarea
                  id="checkpoint-description"
                  bind:value={checkpointCreateDescription}
                  rows="4"
                  placeholder="What changed? What is this save for?"
                  class="w-full px-3 py-[8px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors resize-y"
                ></textarea>
              </div>

              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/50 p-3 text-[12px] text-text-secondary">
                If left empty, the checkpoint will still be saved and shown using its commit hash.
              </div>
            </div>

            {#if checkpointCreateError}
              <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{checkpointCreateError}</div>
            {/if}

            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                class="px-3 py-2 rounded-[5px] border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                onclick={() => goto(buildSpaceDetailRoute(spaceId))}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="inline-flex items-center gap-2 px-3 py-2 rounded-[5px] bg-brand text-white text-[12px] font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                disabled={checkpointCreateSubmitting}
              >
                {#if checkpointCreateSubmitting}
                  <Loader2 class="w-3.5 h-3.5 animate-spin" />
                {:else}
                  <Save class="w-3.5 h-3.5" />
                {/if}
                <span>Save Checkpoint</span>
              </button>
            </div>
          </form>
        {/if}
      </div>
    {:else if routeView === 'checkpoint'}
      <div class="flex-1 min-h-0 overflow-y-auto p-4 max-w-3xl space-y-4">
        {#if checkpointDetailLoading}
          <div class="rounded-md border border-border-subtle bg-bg-surface p-4 text-[12px] text-text-tertiary">
            Loading save...
          </div>
        {:else if checkpointDetailError}
          <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{checkpointDetailError}</div>
        {:else if checkpointDetail}
          <div class="border border-border-subtle rounded-md bg-bg-surface p-5 space-y-4">
            <div class="space-y-1">
              <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Save</div>
              <h1 class="text-[22px] font-semibold text-text-primary tracking-tight break-words">{getCheckpointTitle(checkpointDetail)}</h1>
              <p class="text-[13px] text-text-tertiary">Saved from <span class="text-text-primary">{space?.name ?? space?.title ?? spaceId}</span>.</p>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
                  <GitCommitHorizontal class="w-3.5 h-3.5" />
                  Commit Hash
                </div>
                <div class="mt-2 flex items-center justify-between gap-3">
                  <div class="font-mono text-[13px] text-text-primary break-all">{checkpointDetail.commitHash}</div>
                  <button
                    type="button"
                    class="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-[5px] border border-border-subtle text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                    onclick={handleCopyCheckpointCommitHash}
                  >
                    <Copy class="w-3 h-3" />
                    <span>{checkpointCopied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
                  <Clock3 class="w-3.5 h-3.5" />
                  Created At
                </div>
                <div class="mt-2 text-[13px] text-text-primary">{formatCheckpointTimestamp(checkpointDetail.createdAt)}</div>
              </div>

              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
                  <Network class="w-3.5 h-3.5" />
                  Parent Checkpoint
                </div>
                <div class="mt-2 font-mono text-[13px] text-text-primary break-all">{checkpointDetail.parentCheckpointId ?? 'None'}</div>
              </div>

              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="text-[11px] uppercase tracking-wider text-text-placeholder font-medium">Fork Count</div>
                <div class="mt-2 text-[13px] text-text-primary">{checkpointDetail.forkCount}</div>
              </div>
            </div>

            <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/20 p-4">
              <div class="text-[11px] uppercase tracking-wider text-text-placeholder font-medium">Description</div>
              <div class="mt-2 text-[14px] leading-6 text-text-primary whitespace-pre-wrap">{checkpointDetail.description?.trim() || 'No description provided.'}</div>
            </div>
          </div>
        {:else}
          <div class="rounded-md border border-border-subtle bg-bg-surface p-4 text-[12px] text-text-tertiary">Save not found.</div>
        {/if}
      </div>

    {:else if routeView === 'cronjob-new'}
      <div class="flex-1 p-4 overflow-y-auto max-w-2xl">
        {#if spaceLoadError && !spaceHasMinimalAccess}
          <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{spaceLoadError}</div>
        {:else}
          <form onsubmit={handleCreateCronjobSubmit} class="space-y-3">
            <div class="border border-border-subtle rounded-md bg-bg-surface p-4 space-y-3">
              <div>
                <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Scheduled</div>
                <p class="text-[13px] text-text-tertiary mt-1">Create a repeating task that sends a message to <span class="text-text-primary font-medium">{space?.name ?? space?.title ?? spaceId}</span> on a schedule.</p>
              </div>

              <div>
                <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="cronjob-title">Title</label>
                <input
                  id="cronjob-title"
                  type="text"
                  bind:value={cronjobNewTitle}
                  placeholder="e.g. Daily report"
                  class="w-full px-3 py-[8px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="cronjob-expression">Cron Expression</label>
                <input
                  id="cronjob-expression"
                  type="text"
                  bind:value={cronjobNewExpression}
                  placeholder="e.g. 0 10 * * * (daily at 10 AM)"
                  class="w-full px-3 py-[8px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] font-mono text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors"
                />
                <p class="mt-1 text-[11px] text-text-placeholder">Format: min hour day month weekday · Example: */30 * * * * (every 30 min)</p>
              </div>

              <div>
                <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="cronjob-prompt">Prompt Message</label>
                <textarea
                  id="cronjob-prompt"
                  bind:value={cronjobNewPrompt}
                  rows="4"
                  placeholder="Message content to send to the space..."
                  class="w-full px-3 py-[8px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors resize-y"
                ></textarea>
              </div>

              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/50 p-3 text-[12px] text-text-secondary">
                The cronjob will send this message to the space on every scheduled run.
              </div>
            </div>

            {#if cronjobNewError}
              <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{cronjobNewError}</div>
            {/if}

            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                class="px-3 py-2 rounded-[5px] border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                onclick={() => goto(buildSpaceDetailRoute(spaceId))}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="inline-flex items-center gap-2 px-3 py-2 rounded-[5px] bg-brand text-white text-[12px] font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                disabled={cronjobNewSubmitting}
              >
                {#if cronjobNewSubmitting}
                  <Loader2 class="w-3.5 h-3.5 animate-spin" />
                {:else}
                  <Plus class="w-3.5 h-3.5" />
                {/if}
                <span>Create Cronjob</span>
              </button>
            </div>
          </form>
        {/if}
      </div>

    {:else if routeView === 'cronjob'}
      <div class="flex-1 min-h-0 overflow-y-auto p-4 max-w-3xl space-y-4">
        {#if cronjobDetailLoading}
          <div class="rounded-md border border-border-subtle bg-bg-surface p-4 text-[12px] text-text-tertiary">
            Loading scheduled job...
          </div>
        {:else if cronjobDetailError}
          <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{cronjobDetailError}</div>
        {:else if cronjobDetail}
          <div class="border border-border-subtle rounded-md bg-bg-surface p-5 space-y-4">
            <div class="space-y-1">
              <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Scheduled</div>
              <div class="flex items-center gap-3">
                <h1 class="text-[22px] font-semibold text-text-primary tracking-tight break-words">{cronjobDetail.title}</h1>
                <span class="w-2.5 h-2.5 rounded-full shrink-0 {cronjobDetail.enabled ? 'bg-status-running' : 'bg-text-placeholder'}"></span>
              </div>
              <p class="text-[13px] text-text-tertiary">Running in <span class="text-text-primary">{space?.name ?? space?.title ?? spaceId}</span>.</p>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
                  <Clock class="w-3.5 h-3.5" />
                  Schedule
                </div>
                <div class="mt-2 font-mono text-[14px] text-text-primary">{cronjobDetail.cronExpression}</div>
              </div>

              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
                  <Clock3 class="w-3.5 h-3.5" />
                  Timezone
                </div>
                <div class="mt-2 text-[13px] text-text-primary">{cronjobDetail.timezone}</div>
              </div>

              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
                  <Terminal class="w-3.5 h-3.5" />
                  Task Type
                </div>
                <div class="mt-2 text-[13px] text-text-primary">{cronjobDetail.taskType}</div>
              </div>

              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
                  <Clock3 class="w-3.5 h-3.5" />
                  Created At
                </div>
                <div class="mt-2 text-[13px] text-text-primary">{formatDateTime(cronjobDetail.createdAt)}</div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 px-3 py-2 rounded-[5px] border border-border-subtle text-[12px] font-medium transition-colors {cronjobDetail!.enabled ? 'text-status-running hover:bg-bg-hover' : 'text-text-tertiary hover:bg-bg-hover'}"
                onclick={() => handleToggleCronjob(!cronjobDetail!.enabled)}
                disabled={cronjobActionInProgress}
              >
                {#if cronjobActionInProgress}
                  <Loader2 class="w-3.5 h-3.5 animate-spin" />
                {:else if cronjobDetail.enabled}
                  <Power class="w-3.5 h-3.5" />
                {:else}
                  <PowerOff class="w-3.5 h-3.5" />
                {/if}
                <span>{cronjobDetail.enabled ? 'Disable' : 'Enable'}</span>
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 px-3 py-2 rounded-[5px] border border-border-subtle text-[12px] font-medium text-text-tertiary hover:text-error-soft hover:bg-bg-hover transition-colors disabled:opacity-50"
                onclick={handleDeleteCronjob}
                disabled={cronjobActionInProgress}
              >
                <Trash2 class="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>

            {#if cronjobToggleError}
              <div class="rounded-[6px] border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft">{cronjobToggleError}</div>
            {/if}

            {#if cronjobRuns.length > 0}
              <div class="border-t border-border-subtle pt-4">
                <div class="text-[11px] uppercase tracking-wider text-text-placeholder font-medium mb-3">Recent Runs</div>
                <div class="space-y-2">
                  {#each cronjobRuns.slice(0, 20) as run (run.id)}
                    {@const badge = taskRunStatusBadge(run)}
                    <a
                      href={buildSpaceTaskRoute(spaceId, run.id)}
                      class="flex items-center gap-3 px-3 py-2 rounded-[6px] hover:bg-bg-hover transition-colors"
                      onclick={(e) => { e.preventDefault(); goto(buildSpaceTaskRoute(spaceId, run.id)); }}
                    >
                      <span class="flex items-center gap-2 min-w-[100px]">
                        <span class="w-[6px] h-[6px] rounded-full shrink-0 {badge.dot}"></span>
                        <span class="text-[12px] {badge.color}">{badge.label}</span>
                      </span>
                      <span class="text-[12px] text-text-placeholder font-mono">{formatShortDateTime(run.scheduledAt)}</span>
                      <span class="text-[12px] text-text-placeholder font-mono">{taskRunDuration(run)}</span>
                      {#if run.errorMessage}
                        <span class="text-[11px] text-status-error truncate flex-1" title={run.errorMessage}>{run.errorMessage}</span>
                      {/if}
                    </a>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {:else}
          <div class="rounded-md border border-border-subtle bg-bg-surface p-4 text-[12px] text-text-tertiary">Scheduled job not found.</div>
        {/if}
      </div>

    {:else if routeView === 'task'}
      <div class="flex-1 min-h-0 overflow-y-auto p-4 max-w-3xl space-y-4">
        {#if taskRunDetailLoading}
          <div class="rounded-md border border-border-subtle bg-bg-surface p-4 text-[12px] text-text-tertiary">
            Loading task run...
          </div>
        {:else if taskRunDetailError}
          <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{taskRunDetailError}</div>
        {:else if taskRunDetail}
          {@const badge = taskRunStatusBadge(taskRunDetail)}
          <div class="border border-border-subtle rounded-md bg-bg-surface p-5 space-y-4">
            <div class="space-y-1">
              <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Task Run</div>
              <div class="flex items-center gap-3">
                <span class="flex items-center gap-2">
                  <span class="w-3 h-3 rounded-full {badge.dot}"></span>
                  <span class="text-[16px] font-semibold text-text-primary {badge.color}">{badge.label}</span>
                </span>
              </div>
              <p class="text-[13px] text-text-tertiary">
                {#if taskRunDetail.cronJobId}
                  From cronjob
                  <a
                    href={buildSpaceCronjobRoute(spaceId, taskRunDetail!.cronJobId!)}
                    class="text-text-primary hover:text-brand transition-colors"
                    onclick={(e) => { e.preventDefault(); goto(buildSpaceCronjobRoute(spaceId, taskRunDetail!.cronJobId!)); }}
                  >view</a>
                {:else}
                  One-time task
                {/if}
              </p>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="text-[11px] uppercase tracking-wider text-text-placeholder font-medium">Task Type</div>
                <div class="mt-2 text-[13px] text-text-primary">{taskRunDetail.taskType}</div>
              </div>

              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="text-[11px] uppercase tracking-wider text-text-placeholder font-medium">Attempts</div>
                <div class="mt-2 text-[13px] text-text-primary">{taskRunDetail.attemptCount}</div>
              </div>

              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
                  <Clock class="w-3.5 h-3.5" />
                  Scheduled
                </div>
                <div class="mt-2 text-[13px] text-text-primary">{formatDateTime(taskRunDetail.scheduledAt)}</div>
              </div>

              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
                  <Clock3 class="w-3.5 h-3.5" />
                  Duration
                </div>
                <div class="mt-2 text-[13px] text-text-primary">{taskRunDuration(taskRunDetail)}</div>
              </div>
            </div>

            {#if taskRunDetail.startedAt || taskRunDetail.finishedAt}
              <div class="grid gap-3 md:grid-cols-2">
                <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                  <div class="text-[11px] uppercase tracking-wider text-text-placeholder font-medium">Started At</div>
                  <div class="mt-2 text-[13px] text-text-primary">{formatDateTime(taskRunDetail.startedAt)}</div>
                </div>
                <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
                  <div class="text-[11px] uppercase tracking-wider text-text-placeholder font-medium">Finished At</div>
                  <div class="mt-2 text-[13px] text-text-primary">{formatDateTime(taskRunDetail.finishedAt)}</div>
                </div>
              </div>
            {/if}

            <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/20 p-4">
              <div class="text-[11px] uppercase tracking-wider text-text-placeholder font-medium">Payload</div>
              <pre class="mt-2 text-[12px] font-mono text-text-secondary whitespace-pre-wrap break-all">{JSON.stringify(taskRunDetail.payload, null, 2)}</pre>
            </div>

            {#if taskRunDetail.result}
              <div class="rounded-[6px] border border-border-subtle bg-bg-elevated/20 p-4">
                <div class="text-[11px] uppercase tracking-wider text-text-placeholder font-medium">Result</div>
                <pre class="mt-2 text-[12px] font-mono text-text-secondary whitespace-pre-wrap break-all">{JSON.stringify(taskRunDetail.result, null, 2)}</pre>
              </div>
            {/if}

            {#if taskRunDetail.errorMessage}
              <div class="rounded-[6px] border border-error-soft/30 bg-error-bg p-4">
                <div class="text-[11px] uppercase tracking-wider text-error-soft font-medium">Error</div>
                <div class="mt-2 text-[13px] text-error-soft whitespace-pre-wrap break-all">{taskRunDetail.errorMessage}</div>
              </div>
            {/if}
          </div>
        {:else}
          <div class="rounded-md border border-border-subtle bg-bg-surface p-4 text-[12px] text-text-tertiary">Task run not found.</div>
        {/if}
      </div>

    {:else if fileMode === 'file'}
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
              {routeFilePath}
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
                <div class="flex items-center gap-0 rounded-md border border-border-subtle bg-bg-input p-[2px]">
                  <button
                    type="button"
                    class="segmented-btn"
                    class:active={fileEdit}
                    onclick={() => fileEdit = true}
                    title="Edit source"
                  >
                    Source
                  </button>
                  <button
                    type="button"
                    class="segmented-btn"
                    class:active={!fileEdit}
                    onclick={() => fileEdit = false}
                    title="Preview markdown"
                  >
                    Preview
                  </button>
                </div>
              {/if}
              <a
                href={openFileDownloadUrl}
                download={openFileDownloadName}
                class="icon-btn"
                title="Download file"
              >
                <Download class="w-4 h-4" />
              </a>
              <button type="button" class="icon-btn" onclick={() => void copyFileContent()} title="Copy content">
                {#if openFileCopied}
                  <Check class="w-4 h-4 text-success-soft" />
                {:else}
                  <Copy class="w-4 h-4" />
                {/if}
              </button>
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
              <div class="text-[11px] text-text-tertiary hidden sm:inline">{formatFileSize(openFile.size)}</div>
              <button type="button" class="zoom-btn" onclick={() => { openFileZoom = Math.max(0.25, openFileZoom - 0.25); openFilePanX = 0; openFilePanY = 0; }} title="Zoom out">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="7" y1="11" x2="15" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>
              <span class="text-[11px] text-text-tertiary tabular-nums w-10 text-center">{Math.round(openFileZoom * 100)}%</span>
              <button type="button" class="zoom-btn" onclick={() => { openFileZoom = Math.min(4, openFileZoom + 0.25); openFilePanX = 0; openFilePanY = 0; }} title="Zoom in">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="11" y1="7" x2="11" y2="15"/><line x1="7" y1="11" x2="15" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>
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
            <div class="flex flex-1 items-center justify-center overflow-hidden p-4" tabindex="-1" role="group" aria-label="Image preview — scroll to zoom, drag to pan, double-click to reset" onwheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                openFileZoom = Math.max(0.25, Math.min(4, openFileZoom + (e.deltaY < 0 ? 0.1 : -0.1)));
                openFilePanX = 0;
                openFilePanY = 0;
              }
            }} ondblclick={() => { openFileZoom = 1; openFilePanX = 0; openFilePanY = 0; }} onmousedown={openFilePanHandlers.start} style={openFileDragging ? 'cursor: grabbing;' : (openFileZoom > 1 ? 'cursor: grab;' : '')}>
              <img src={openFileDataUrl} alt={openFile.name} style={`transform: translate(${openFilePanX}px, ${openFilePanY}px) scale(${openFileZoom}); ${openFileDragging ? '' : 'transition: transform 150ms ease;'}`} class="max-h-full max-w-full rounded-md select-none" />
            </div>
          {:else if openFileIsVideo && openFileDataUrl}
            <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
              <div class="min-w-0 flex-1 truncate text-[11px] sm:text-[12px] text-text-secondary">
                {openFile.path}
              </div>
              <div class="text-[11px] text-text-tertiary hidden sm:inline">{formatFileSize(openFile.size)}</div>
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
              <div class="text-[11px] text-text-tertiary hidden sm:inline">{formatFileSize(openFile.size)}</div>
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
    {#if spaceLoadError && !spaceHasMinimalAccess}
      <div class="m-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{spaceLoadError}</div>
    {/if}

    {#if createSessionError}
      <div class="m-4 mt-0 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{createSessionError}</div>
    {/if}

    {#if bootstrapping && !activeSessionState}
      <div class="flex-1 flex items-center justify-center">
        <div class="flex flex-col items-center gap-3 text-text-tertiary">
          <div class="w-6 h-6 rounded-full border-2 border-border-subtle border-t-brand animate-spin"></div>
          <div class="text-[12px]">Loading space…</div>
        </div>
      </div>
    {:else if !activeSessionState && routeView === "space"}
      <div class="flex-1 overflow-y-auto px-4 py-6">
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {#if spaceStatusNotice}
            <div class="inline-flex items-center gap-2 self-start rounded-full border border-success-soft/20 bg-success-soft/8 px-3 py-1.5 text-[12px] text-success-soft">
              <Check class="w-3.5 h-3.5" />
              <span>{spaceStatusNotice}</span>
            </div>
          {/if}
          <div class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 sm:p-5">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0 space-y-2">
                <div class="text-[11px] uppercase tracking-[0.18em] text-text-placeholder">Space</div>
                <div>
                  <div class="flex items-center gap-1.5 group">
                    {#if renamingSpace}
                      <input
                        type="text"
                        bind:value={renameInput}
                        disabled={renameSaving}
                        class="text-[20px] font-medium text-text-primary bg-bg-input border border-border-subtle rounded-[6px] px-2 py-1 focus:border-brand/40 focus:outline-none transition-colors w-full max-w-xs disabled:opacity-60"
                        onkeydown={(e) => {
                          if (e.key === "Enter" && !renameSaving) {
                            e.preventDefault();
                            const trimmed = renameInput.trim();
                            if (trimmed && trimmed !== space?.name) {
                              void handleRenameSpace(trimmed);
                            } else {
                              renamingSpace = false;
                              renameError = "";
                            }
                          }
                          if (e.key === "Escape" && !renameSaving) {
                            renamingSpace = false;
                            renameError = "";
                          }
                        }}
                      />
                      <button
                        type="button"
                        class="shrink-0 p-1 rounded text-success-soft hover:text-success hover:bg-bg-hover transition-colors disabled:opacity-50"
                        title="Save"
                        disabled={renameSaving}
                        onclick={() => {
                          const trimmed = renameInput.trim();
                          if (trimmed && trimmed !== space?.name) {
                            void handleRenameSpace(trimmed);
                          } else {
                            renamingSpace = false;
                            renameError = "";
                          }
                        }}
                      >
                        {#if renameSaving}
                          <Loader2 class="w-4 h-4 animate-spin" />
                        {:else}
                          <Check class="w-4 h-4" />
                        {/if}
                      </button>
                      <button
                        type="button"
                        class="shrink-0 p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-50"
                        title="Cancel"
                        disabled={renameSaving}
                        onclick={() => { renamingSpace = false; renameError = ""; }}
                      >
                        <X class="w-4 h-4" />
                      </button>
                      {#if renameError}
                        <span class="text-[11px] text-status-error ml-1">{renameError}</span>
                      {/if}
                    {:else}
                      <h1 class="truncate text-[20px] font-medium text-text-primary">{space?.name || space?.title || spaceId}</h1>
                      <button
                        type="button"
                        class="shrink-0 p-1 rounded text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-secondary hover:bg-bg-hover transition-all"
                        title="Rename space"
                        onclick={() => { renameInput = space?.name ?? ""; renamingSpace = true; renameError = ""; }}
                      >
                        <Pencil class="w-3.5 h-3.5" />
                      </button>
                    {/if}
                  </div>
                  {#if space?.description}
                    <p class="mt-1 text-[13px] leading-6 text-text-secondary">{space.description}</p>
                  {/if}
                </div>
              </div>

              {#if !spaceHasMinimalAccess}
                <button
                  type="button"
                  class="inline-flex items-center justify-center gap-1.5 rounded-[7px] border px-3 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 {canCreateSession ? 'border-[#FF3E00]/20 bg-[#FF3E00]/10 text-brand hover:bg-[#FF3E00]/15' : 'border-border-subtle bg-bg-input text-text-tertiary'}"
                  onclick={() => handleCreateNewSession()}
                  disabled={!canCreateSession}
                >
                  {#if creatingSession}
                    <Loader2 class="w-3.5 h-3.5 animate-spin" />
                    Creating…
                  {:else}
                    <Plus class="w-3.5 h-3.5" />
                    New chat
                  {/if}
                </button>
              {/if}
            </div>
          </div>

          <div class="grid gap-4">
            <section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 sm:p-5">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Workspace</div>
                  <div class="mt-1 text-[15px] font-medium text-text-primary">Initialization status</div>
                </div>
                <div class={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${bootstrapStatusTone}`}>
                  {formatBootstrapStatus(bootstrapStatus)}
                </div>
              </div>

              <div class="mt-4 space-y-2 text-[13px] text-text-secondary">
                <p>Source: <span class="text-text-primary">{bootstrapSourceLabel}</span></p>
                <p>Stage: <span class="text-text-primary">{formatBootstrapStage(bootstrapStage)}</span></p>
                {#if bootstrapStatus === "ready"}
                  <p>The initial workspace content has been prepared.</p>
                {:else if bootstrapStatus === "failed"}
                  <p>Workspace initialization failed.</p>
                {:else}
                  <p>Workspace initialization is still in progress.</p>
                  <div class="text-[12px] font-mono text-text-placeholder">
                    {#if bootstrapStatus === "pending" || bootstrapStatus === "running"}
                      refreshing every ~4s
                    {:else if bootstrapStatus === "failed"}
                      refreshing every ~15s
                    {:else}
                      refresh paused
                    {/if}
                  </div>
                {/if}
                {#if bootstrapErrorMessage}
                  <div class="rounded-[6px] border border-error-soft/20 bg-error-soft/8 p-3 text-[12px] font-mono text-error-soft break-all">
                    {bootstrapErrorMessage}
                  </div>
                {/if}
              </div>
            </section>
          </div>

          <section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 sm:p-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Chats</div>
                <div class="mt-1 text-[15px] font-medium text-text-primary">Start a new conversation</div>
              </div>
              <div class="text-[12px] text-text-tertiary">{spaceSessions.length} existing</div>
            </div>

            <div class="mt-4 text-[13px] text-text-secondary">
              {#if canCreateSession}
                <p>You can create a new chat immediately.</p>
              {:else}
                <p>You can create a new chat at any time.</p>
              {/if}
            </div>

            {#if spaceSessions.length > 0}
              <div class="mt-4 space-y-2 border-t border-border-subtle pt-4">
                <div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Recent chats</div>
                <div class="space-y-2">
                  {#each spaceSessions.slice(0, 5) as session (session.id)}
                    <button
                      type="button"
                      class="flex w-full items-center justify-between rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-left transition-colors hover:bg-bg-hover"
                      onclick={() => goto(buildSpaceSessionRoute(spaceId, session.id))}
                    >
                      <div class="min-w-0">
                        <div class="truncate text-[13px] text-text-primary">{getSessionTitle(session)}</div>
                        <div class="mt-0.5 text-[11px] text-text-placeholder">Updated {formatCheckpointTimestamp(session.updatedAt ?? session.createdAt)}</div>
                      </div>
                      <ArrowDown class="w-3.5 h-3.5 shrink-0 rotate-[-90deg] text-text-tertiary" />
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </section>
        </div>
      </div>
    {:else if !activeSessionState}
      <div class="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-4">
        <div class="text-[14px]">No chat selected</div>
        {#if !spaceHasMinimalAccess}
          <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-2 rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary transition-colors duration-100 disabled:opacity-50"
            onclick={() => handleCreateNewSession()}
            disabled={!canCreateSession}
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
          modelsCatalog={modelsCatalog ?? undefined}
        />

        {#if !shouldAutoFollow}
          <div class="absolute left-1/2 z-20 -translate-x-1/2"
            style:bottom={imageAttachments.length > 0 ? "calc(env(safe-area-inset-bottom) + 11.5rem)" : "calc(env(safe-area-inset-bottom) + 7rem)"}
            style="animation: cohub-scroll-to-bottom-in 180ms cubic-bezier(0.22, 1, 0.36, 1);">
            <button
              type="button"
              aria-label="Scroll to bottom"
              class="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white shadow-[0_2px_8px_rgba(0,0,0,0.15)] transition-all duration-150 hover:bg-brand-hover active:scale-95"
              onclick={() => {
                shouldAutoFollow = true;
                void forceScrollToBottom();
              }}
            >
              {#if hasUnread}
                <span class="text-[10px] font-medium leading-none">New</span>
              {:else}
                <ArrowDown class="w-4 h-4" />
              {/if}
            </button>
          </div>
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

  <!-- Inline file panel — desktop: side panel, mobile: full-screen overlay -->
  {#if inlineFile}
    <!-- Mobile full-screen overlay -->
    <div class="lg:hidden fixed inset-0 z-50 flex flex-col bg-bg-content">
      <div class="flex h-11 items-center gap-2 border-b border-border-subtle px-3 shrink-0 bg-bg-surface">
        <button type="button" class="icon-btn" onclick={closeInlineFile} title="Close file">
          <X class="w-5 h-5" />
        </button>
        <div class="min-w-0 flex-1 truncate text-sm text-text-secondary">
          {#if inlineFile.response}{inlineFile.response.path}{:else}{inlineFile.path}{/if}
        </div>
        {#if inlineFile.response && inlineFile.response.kind === "text"}
          <a href={inlineFileDownloadUrl} download={inlineFileDownloadName} class="icon-btn" title="Download file">
            <Download class="w-4 h-4" />
          </a>
        {/if}
      </div>

      {#if inlineFile.loading}
        <div class="flex flex-1 items-center justify-center text-sm text-text-tertiary">Loading…</div>
      {:else if inlineFile.error}
        <div class="m-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-sm text-error-soft">
          {inlineFile.error}
        </div>
      {:else if inlineFile.tooLarge}
        <div class="flex flex-1 items-center justify-center">
          <div class="m-4 rounded-lg border border-warning-soft/30 bg-warning-bg p-6 text-center max-w-sm">
            <div class="text-4xl mb-3">📦</div>
            <div class="text-sm font-semibold text-text-primary mb-1">File too large to preview</div>
            <div class="text-xs text-text-secondary mb-4">This file exceeds 10MB and cannot be opened in the web editor.</div>
            <a href={inlineFileDownloadUrl} download={inlineFileDownloadName} class="action-btn primary">
              <Download class="w-3.5 h-3.5" />
              Download file
            </a>
          </div>
        </div>
      {:else if inlineFile.response}
        {#if inlineFileIsText}
          <div class="flex h-11 items-center gap-2 border-b border-border-subtle px-3 shrink-0">
            {#if inlineFileIsMarkdown}
              <div class="flex items-center gap-0 rounded-md border border-border-subtle bg-bg-input p-[2px]">
                <button type="button" class="segmented-btn" class:active={inlineFileEdit} onclick={() => inlineFileEdit = true} title="Edit source">Source</button>
                <button type="button" class="segmented-btn" class:active={!inlineFileEdit} onclick={() => inlineFileEdit = false} title="Preview markdown">Preview</button>
              </div>
            {/if}
            <div class="flex-1"></div>
            <button type="button" class="icon-btn" onclick={() => void copyInlineFileContent()} title="Copy content">
              {#if inlineFileCopied}<Check class="w-4 h-4 text-success-soft" />{:else}<Copy class="w-4 h-4" />{/if}
            </button>
            <button type="button" class="action-btn" onclick={() => void saveInlineFile()} disabled={inlineFile.saving || !inlineFileDirty} title="Save">
              <Save class="w-4 h-4 shrink-0" />
            </button>
          </div>
          <div class="flex-1 min-h-0">
            {#if inlineFileEdit}
              <CodeEditor value={inlineFile.draft} language={inlineFileExt} onInput={(v) => { if (inlineFile) inlineFile.draft = v; }} />
            {:else if inlineFileIsMarkdown && inlineFileMarkdownHtml}
              <article class="markdown-preview">{@html inlineFileMarkdownHtml}</article>
            {:else}
              <CodeEditor value={inlineFile.draft} language={inlineFileExt} readonly={true} />
            {/if}
          </div>
        {:else if inlineFileIsImage && inlineFileDataUrl}
          <div class="flex flex-1 items-center justify-center overflow-hidden p-4">
            <img src={inlineFileDataUrl} alt={inlineFile.response.name} class="max-h-full max-w-full rounded-md" />
          </div>
        {:else if inlineFileIsVideo && inlineFileDataUrl}
          <div class="flex flex-1 items-center justify-center p-4">
            <video src={inlineFileDataUrl} controls class="max-h-full max-w-full rounded-md">
              <track kind="captions" />
            </video>
          </div>
        {:else}
          <div class="m-4 rounded-md border border-border-subtle bg-bg-primary p-4 text-sm text-text-secondary">
            <div><strong>Name:</strong> {inlineFile.response.name}</div>
            <div><strong>Type:</strong> {inlineFile.response.mimeType ?? 'application/octet-stream'}</div>
            <div><strong>Size:</strong> {formatFileSize(inlineFile.response.size)}</div>
            <div class="mt-3 text-text-tertiary">This file type cannot be previewed in the browser.</div>
            <div class="mt-3">
              <a href={inlineFileDownloadUrl} download={inlineFileDownloadName} class="action-btn primary">
                <Download class="w-3.5 h-3.5" />
                Download file
              </a>
            </div>
          </div>
        {/if}
      {:else}
        <div class="flex-1 flex items-center justify-center text-sm text-text-tertiary">No file selected</div>
      {/if}
    </div>

    <!-- Desktop side panel -->
    <div class="hidden lg:flex shrink-0 relative border-l border-border-subtle" style={`width: ${inlineFilePanelWidth}px`}>
      <div class="flex h-full min-w-0 flex-col bg-bg-content">
        {#if inlineFile.loading}
          <div class="flex h-10 items-center border-b border-border-subtle px-3 shrink-0">
            <span class="text-xs text-text-tertiary">Loading file…</span>
          </div>
          <div class="flex flex-1 items-center justify-center text-xs text-text-tertiary">Loading…</div>
        {:else if inlineFile.error}
          <div class="flex h-10 items-center border-b border-border-subtle px-3 shrink-0">
            <span class="flex-1 truncate text-xs text-text-secondary">{inlineFile.path}</span>
            <button type="button" class="icon-btn" onclick={closeInlineFile} title="Close file">
              <X class="w-4 h-4" />
            </button>
          </div>
          <div class="m-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-xs text-error-soft">
            {inlineFile.error}
          </div>
        {:else if inlineFile.tooLarge}
          <div class="flex h-10 items-center gap-2 border-b border-border-subtle px-3 shrink-0">
            <span class="flex-1 truncate text-xs text-text-secondary">{inlineFile.path}</span>
            <a href={inlineFileDownloadUrl} download={inlineFileDownloadName} class="action-btn" title="Download file">
              <Download class="w-3.5 h-3.5 shrink-0" />
              <span class="hidden sm:inline">Download</span>
            </a>
            <button type="button" class="icon-btn" onclick={closeInlineFile} title="Close file">
              <X class="w-4 h-4" />
            </button>
          </div>
          <div class="flex flex-1 items-center justify-center">
            <div class="m-4 rounded-lg border border-warning-soft/30 bg-warning-bg p-6 text-center max-w-sm">
              <div class="text-4xl mb-3">📦</div>
              <div class="text-sm font-semibold text-text-primary mb-1">File too large to preview</div>
              <div class="text-xs text-text-secondary mb-4">This file exceeds 10MB and cannot be opened in the web editor.</div>
              <a href={inlineFileDownloadUrl} download={inlineFileDownloadName} class="action-btn primary">
                <Download class="w-3.5 h-3.5" />
                Download file
              </a>
            </div>
          </div>
        {:else if inlineFile.response}
          {#if inlineFileIsText}
            <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
              <div class="min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
                {inlineFile.response.path}
              </div>
              {#if inlineFileIsMarkdown}
                <div class="flex items-center gap-0 rounded-md border border-border-subtle bg-bg-input p-[2px]">
                  <button
                    type="button"
                    class="segmented-btn"
                    class:active={inlineFileEdit}
                    onclick={() => inlineFileEdit = true}
                    title="Edit source"
                  >
                    Source
                  </button>
                  <button
                    type="button"
                    class="segmented-btn"
                    class:active={!inlineFileEdit}
                    onclick={() => inlineFileEdit = false}
                    title="Preview markdown"
                  >
                    Preview
                  </button>
                </div>
              {/if}
              <a
                href={inlineFileDownloadUrl}
                download={inlineFileDownloadName}
                class="icon-btn"
                title="Download file"
              >
                <Download class="w-4 h-4" />
              </a>
              <button type="button" class="icon-btn" onclick={() => void copyInlineFileContent()} title="Copy content">
                {#if inlineFileCopied}
                  <Check class="w-4 h-4 text-success-soft" />
                {:else}
                  <Copy class="w-4 h-4" />
                {/if}
              </button>
              <button
                type="button"
                class="action-btn"
                onclick={() => void saveInlineFile()}
                disabled={inlineFile.saving || !inlineFileDirty}
                title="Save (Ctrl+S)"
              >
                <Save class="w-3.5 h-3.5 shrink-0" />
                <span class="hidden sm:inline">Save</span>
              </button>
              <button type="button" class="icon-btn" onclick={closeInlineFile} title="Close file">
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="flex-1 min-h-0">
              {#if inlineFileEdit}
                <CodeEditor
                  value={inlineFile.draft}
                  language={inlineFileExt}
                  onInput={(v) => { if (inlineFile) inlineFile.draft = v; }}
                />
              {:else if inlineFileIsMarkdown && inlineFileMarkdownHtml}
                <article class="markdown-preview">{@html inlineFileMarkdownHtml}</article>
              {:else}
                <CodeEditor
                  value={inlineFile.draft}
                  language={inlineFileExt}
                  readonly={true}
                />
              {/if}
            </div>
          {:else if inlineFileIsImage && inlineFileDataUrl}
            <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
              <div class="min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
                {inlineFile.response.path}
              </div>
              <div class="text-xs text-text-tertiary hidden sm:inline">{formatFileSize(inlineFile.response.size)}</div>
              <button type="button" class="zoom-btn" onclick={() => { inlineFileZoom = Math.max(0.25, inlineFileZoom - 0.25); inlineFilePanX = 0; inlineFilePanY = 0; }} title="Zoom out">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="7" y1="11" x2="15" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>
              <span class="text-xs text-text-tertiary tabular-nums w-10 text-center">{Math.round(inlineFileZoom * 100)}%</span>
              <button type="button" class="zoom-btn" onclick={() => { inlineFileZoom = Math.min(4, inlineFileZoom + 0.25); inlineFilePanX = 0; inlineFilePanY = 0; }} title="Zoom in">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="11" y1="7" x2="11" y2="15"/><line x1="7" y1="11" x2="15" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>
              <a
                href={inlineFileDownloadUrl}
                download={inlineFileDownloadName}
                class="icon-btn"
                title="Download file"
              >
                <Download class="w-4 h-4" />
              </a>
              <button type="button" class="icon-btn" onclick={closeInlineFile} title="Close file">
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="flex flex-1 items-center justify-center overflow-hidden p-4" tabindex="-1" role="group" aria-label="Image preview — scroll to zoom, drag to pan, double-click to reset" onwheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                inlineFileZoom = Math.max(0.25, Math.min(4, inlineFileZoom + (e.deltaY < 0 ? 0.1 : -0.1)));
                inlineFilePanX = 0;
                inlineFilePanY = 0;
              }
            }} ondblclick={() => { inlineFileZoom = 1; inlineFilePanX = 0; inlineFilePanY = 0; }} onmousedown={inlineFilePanHandlers.start} style={inlineFileDragging ? 'cursor: grabbing;' : (inlineFileZoom > 1 ? 'cursor: grab;' : '')}>
              <img src={inlineFileDataUrl} alt={inlineFile.response.name} style={`transform: translate(${inlineFilePanX}px, ${inlineFilePanY}px) scale(${inlineFileZoom}); ${inlineFileDragging ? '' : 'transition: transform 150ms ease;'}`} class="max-h-full max-w-full rounded-md select-none" />
            </div>
          {:else if inlineFileIsVideo && inlineFileDataUrl}
            <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
              <div class="min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
                {inlineFile.response.path}
              </div>
              <div class="text-xs text-text-tertiary hidden sm:inline">{formatFileSize(inlineFile.response.size)}</div>
              <a
                href={inlineFileDownloadUrl}
                download={inlineFileDownloadName}
                class="icon-btn"
                title="Download file"
              >
                <Download class="w-4 h-4" />
              </a>
              <button type="button" class="icon-btn" onclick={closeInlineFile} title="Close file">
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="flex flex-1 items-center justify-center p-4">
              <video src={inlineFileDataUrl} controls class="max-h-full max-w-full rounded-md">
                <track kind="captions" />
              </video>
            </div>
          {:else}
            <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
              <div class="min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
                {inlineFile.response.path}
              </div>
              <div class="text-xs text-text-tertiary hidden sm:inline">{formatFileSize(inlineFile.response.size)}</div>
              <a
                href={inlineFileDownloadUrl}
                download={inlineFileDownloadName}
                class="icon-btn"
                title="Download file"
              >
                <Download class="w-4 h-4" />
              </a>
              <button type="button" class="icon-btn" onclick={closeInlineFile} title="Close file">
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="m-4 rounded-md border border-border-subtle bg-bg-primary p-4 text-xs text-text-secondary">
              <div><strong>Name:</strong> {inlineFile.response.name}</div>
              <div><strong>Type:</strong> {inlineFile.response.mimeType ?? 'application/octet-stream'}</div>
              <div><strong>Size:</strong> {inlineFile.response.size} bytes</div>
              <div class="mt-3 text-text-tertiary">This file type cannot be previewed in the browser.</div>
            </div>
          {/if}
        {:else}
          <div class="flex-1 flex items-center justify-center text-xs text-text-tertiary">No file selected</div>
        {/if}
      </div>
      <button
        type="button"
        class="inline-panel-resize-handle"
        aria-label="Resize file panel"
        title="Resize file panel"
        onpointerdown={beginInlineFilePanelResize}
      ></button>
    </div>
  {/if}

  <!-- Desktop right sidebar — file tree only -->
  {#if !uiState.rightSidebarCollapsed && !spaceHasMinimalAccess}
    <div class="hidden shrink-0 lg:flex border-l border-border-subtle" style={`width: ${uiState.rightSidebarWidth}px`}>
      <div class="w-full relative">
        <SpaceFileSidebar
          nodes={fileTree}
          selectedPath={routeFilePath ?? ""}
          loading={fileTreeLoading}
          error={fileTreeError}
          onToggle={expandDirectory}
          onSelect={(node) => { if (node.type === "file") void openInlineFile(node.path); }}
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
    {#if !spaceHasMinimalAccess}
      <SpaceFileSidebar
        nodes={fileTree}
        selectedPath={routeFilePath ?? ""}
        loading={fileTreeLoading}
        error={fileTreeError}
        onToggle={expandDirectory}
        onSelect={(node) => { if (node.type === "file") { void openInlineFile(node.path); uiState.mobileRightDrawerOpen = false; } }}
        onRefresh={refreshFileTree}
        onCreateFile={handleCreateFile}
        onCreateDir={handleCreateDir}
        onRename={handleRenameNode}
        onDelete={handleDeleteNode}
        canWrite={true}
      />
    {/if}
  </MobileRightDrawer>

  <!-- Settings Overlay (desktop: right drawer, mobile: bottom sheet) -->
  <SettingsOverlay open={showSettings} onClose={() => { showSettings = false; }}>
    <div class="p-4 space-y-6">
      <!-- Sharing section -->
      <section class="space-y-3">
        <div class="text-[10px] font-bold text-text-tertiary uppercase tracking-widest flex items-center justify-between">
          <span>Sharing</span>
        </div>

        <!-- Space-level access -->
        <div class="space-y-3">
          <div class="text-[11px] text-text-placeholder px-2">Space access</div>
          <div class="space-y-2 px-2">
            <div class="flex items-center justify-between">
              <span class="text-[12px] text-text-secondary">Signed-in users</span>
              <select
                value={spaceAccess?.signed_in_user ?? ''}
                onchange={(event) => {
                  const val = (event.currentTarget as HTMLSelectElement).value as SpaceRole | '';
                  void setSpaceAccess({ signed_in_user: val || null });
                }}
                disabled={savingAccess}
                class="px-2 py-1 rounded-sm bg-bg-input border border-border-subtle text-[11px] text-text-secondary focus:border-brand/40 focus:outline-none disabled:opacity-50"
              >
                <option value="">None</option>
                <option value="maker">Maker (edit)</option>
                <option value="guest">Guest (read)</option>
              </select>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[12px] text-text-secondary">Anonymous</span>
              <select
                value={spaceAccess?.anonymous_user ?? ''}
                onchange={(event) => {
                  const val = (event.currentTarget as HTMLSelectElement).value as SpaceRole | '';
                  void setSpaceAccess({ anonymous_user: val || null });
                }}
                disabled={savingAccess}
                class="px-2 py-1 rounded-sm bg-bg-input border border-border-subtle text-[11px] text-text-secondary focus:border-brand/40 focus:outline-none disabled:opacity-50"
              >
                <option value="">None</option>
                <option value="guest">Guest (read)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="w-full h-px bg-border-subtle"></div>

        <!-- Session-level permissions -->
        <div class="space-y-1">
          <div class="text-[11px] text-text-placeholder px-2">Shared sessions</div>
          {#each Object.entries(sessionAccessById).filter(([_, v]) => v) as [sid, acc] (sid)}
            <div class="flex items-center gap-2 px-2 py-1.5 rounded-[4px] group">
              <Globe class="w-3.5 h-3.5 text-text-secondary shrink-0" />
              <span class="text-[12.5px] text-text-secondary truncate flex-1">
                {'Session ' + sid.slice(0, 8)}
              </span>
              <div class="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  class="p-1 rounded-sm text-text-tertiary hover:text-brand hover:bg-bg-hover transition-colors opacity-0 group-hover:opacity-100"
                  onclick={() => {
                    const url = `${window.location.origin}${buildSpaceSessionRoute(spaceId, sid)}`;
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
                  onclick={() => { void removeSessionAccess(sid); }}
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

      <!-- Members section -->
      <section class="space-y-3">
        <div class="text-[10px] font-bold text-text-tertiary uppercase tracking-widest flex items-center justify-between">
          <span>Members</span>
          <span class="px-1.5 py-0.5 rounded-sm bg-bg-hover-strong text-text-secondary">{spaceMembers.length}</span>
        </div>

        <!-- Add member form -->
        <div class="space-y-2">
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={addingMemberUuid}
              placeholder="Paste user UUID"
              class="flex-1 px-2.5 py-[5px] rounded-[5px] bg-bg-input border border-border-subtle text-[12px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono"
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddMember(); } }}
            />
            <select
              bind:value={addingMemberRole}
              class="px-2 py-[5px] rounded-[5px] bg-bg-input border border-border-subtle text-[12px] text-text-secondary focus:border-brand/40 focus:outline-none"
            >
              <option value="guest">Guest</option>
              <option value="maker">Maker</option>
              <option value="host">Host</option>
            </select>
            <button
              type="button"
              onclick={() => { void handleAddMember(); }}
              disabled={savingMember || !addingMemberUuid.trim()}
              class="px-2.5 py-[5px] rounded-[5px] bg-[#FF3E00] hover:bg-brand-hover text-[12px] text-white font-medium transition-colors disabled:opacity-50 cursor-pointer"
            >
              {savingMember ? '...' : 'Add'}
            </button>
          </div>
          {#if addingMemberError}
            <div class="text-[11px] text-error-soft break-all">{addingMemberError}</div>
          {/if}
        </div>

        <!-- Members list -->
        {#if loadingMembers}
          <div class="flex items-center justify-center py-4 text-[12px] text-text-tertiary">
            <div class="w-3.5 h-3.5 rounded-full border-2 border-border-subtle border-t-brand animate-spin mr-2"></div>
            Loading...
          </div>
        {:else if spaceMembers.length === 0}
          <div class="px-2 py-1 text-[12px] text-text-tertiary italic">No members</div>
        {:else}
          <div class="space-y-1">
            {#each spaceMembers as member (member.userId)}
              <div class="flex items-center gap-2 px-2 py-1.5 rounded-[4px] group hover:bg-bg-hover transition-colors">
                {#if member.role === 'host'}
                  <span class="w-3.5 h-3.5 shrink-0 text-[10px] text-amber-400 font-bold">👑</span>
                {:else if member.role === 'maker'}
                  <Pencil class="w-3.5 h-3.5 text-brand shrink-0" />
                {:else}
                  <Eye class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                {/if}
                <code class="flex-1 text-[11px] font-mono text-text-secondary truncate select-all">{member.userId}</code>
                <span class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium w-10 text-right">{member.role}</span>
                <button
                  type="button"
                  class="p-1 rounded-sm text-text-tertiary hover:text-error-soft hover:bg-bg-hover transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                  onclick={() => { void handleRemoveMember(member.userId); }}
                  title="Remove member"
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
            onclick={() => { void removeSessionAccess(shareModalSessionId!); showShareModal = false; }}
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
            const url = `${window.location.origin}${buildSpaceSessionRoute(spaceId, shareModalSessionId!)}`;
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

  @keyframes cohub-scroll-to-bottom-in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(button[aria-label="Scroll to bottom"]) {
      animation: none !important;
    }
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

  .inline-panel-resize-handle {
    position: absolute;
    top: 0;
    left: -4px;
    bottom: 0;
    width: 8px;
    border: none;
    padding: 0;
    cursor: col-resize;
    background: transparent;
    z-index: 10;
  }

  .inline-panel-resize-handle::after {
    content: "";
    position: absolute;
    left: 3px;
    top: 0;
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background-color 120ms ease;
  }

  .inline-panel-resize-handle:hover::after {
    background: var(--border-subtle);
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

  .segmented-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 24px;
    padding: 0 10px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 120ms ease;
    white-space: nowrap;
  }
  .segmented-btn:hover { color: var(--text-secondary); }
  .segmented-btn.active {
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 1px rgba(0,0,0,0.04);
  }

  .markdown-preview {
    height: 100%;
    overflow: auto;
    padding: 24px 28px;
    max-width: 860px;
    margin: 0 auto;
    line-height: 1.75;
    font-size: 14px;
    color: var(--text-primary);
  }
  .markdown-preview :global(h1) {
    font-size: 1.75em;
    font-weight: 700;
    margin-top: 0;
    margin-bottom: 0.4em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-primary);
  }
  .markdown-preview :global(h2) {
    font-size: 1.4em;
    font-weight: 600;
    margin-top: 1.5em;
    margin-bottom: 0.4em;
    color: var(--text-primary);
  }
  .markdown-preview :global(h3) {
    font-size: 1.15em;
    font-weight: 600;
    margin-top: 1.2em;
    margin-bottom: 0.3em;
    color: var(--text-primary);
  }
  .markdown-preview :global(h4),
  .markdown-preview :global(h5),
  .markdown-preview :global(h6) {
    font-weight: 600;
    margin-top: 1.2em;
    margin-bottom: 0.3em;
    color: var(--text-primary);
  }
  .markdown-preview :global(p) { margin-bottom: 1em; }
  .markdown-preview :global(strong) { font-weight: 600; }
  .markdown-preview :global(em) { font-style: italic; }
  .markdown-preview :global(code) {
    background: var(--bg-hover);
    border: 1px solid var(--border-subtle);
    border-radius: 5px;
    padding: 0.15em 0.45em;
    font-size: 0.88em;
    font-family: var(--font-mono, monospace);
    color: var(--text-primary);
  }
  .markdown-preview :global(pre) {
    background: var(--bg-primary);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px 20px;
    overflow: auto;
    margin-bottom: 1em;
    line-height: 1.55;
  }
  .markdown-preview :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 13px;
    color: var(--text-primary);
  }
  .markdown-preview :global(ul),
  .markdown-preview :global(ol) {
    padding-left: 1.5em;
    margin-bottom: 1em;
  }
  .markdown-preview :global(li) { margin-bottom: 0.3em; }
  .markdown-preview :global(li) :global(ul),
  .markdown-preview :global(li) :global(ol) {
    margin-bottom: 0;
  }
  .markdown-preview :global(hr) {
    border: none;
    border-top: 1px solid var(--border-subtle);
    margin: 1.5em 0;
  }
  .markdown-preview :global(blockquote) {
    border-left: 3px solid var(--brand, #FF3E00);
    padding-left: 1em;
    color: var(--text-secondary);
    margin: 1em 0;
  }
  .markdown-preview :global(blockquote p) {
    color: var(--text-secondary);
  }
  .markdown-preview :global(img) {
    max-width: 100%;
    border-radius: 8px;
    margin: 0.5em 0;
    border: 1px solid var(--border-subtle);
  }
  .markdown-preview :global(a) {
    color: var(--brand, #FF3E00);
    text-decoration: none;
  }
  .markdown-preview :global(a:hover) { text-decoration: underline; }
  .markdown-preview :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 1em;
    font-size: 13px;
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
    color: var(--text-primary);
  }
  .markdown-preview :global(td) {
    color: var(--text-secondary);
  }
  .markdown-preview :global(tr:nth-child(even)) :global(td) {
    background: var(--bg-hover-soft, rgba(0,0,0,0.02));
  }

  .zoom-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
  }
  .zoom-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }
</style>
