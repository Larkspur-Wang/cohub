<script lang="ts">
import type { ContentBlock, MessageRecord } from "@cohub/protocol";
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
import {
	addSpaceCollaborator,
	type CheckpointRecord,
	type CronJobRecord,
	createCronJob,
	createSessionPermission,
	createSpaceCheckpoint,
	createSpaceFsDir,
	createSpacePermission,
	createSpaceSession,
	deleteCronJob,
	deleteSessionPermission,
	deleteSpaceFsNode,
	deleteSpacePermission,
	extractSessionRenderState,
	getCronJobRuns,
	getCronJobs,
	getModels,
	getSessionMessagesPaginated,
	getSpace,
	getSpaceCheckpoint,
	getSpaceFsFile,
	getSpaceFsTree,
	getSpaceSandbox,
	getSpaceSessions,
	getTaskRun,
	listSpaceCollaborators,
	listSpacePermissions,
	moveSpaceFsNode,
	postSessionMessage,
	putSpaceFsFile,
	type ResourcePermission,
	recreateSpaceSandbox,
	removeSpaceCollaborator,
	renameSpace,
	type SandboxRecord,
	type SessionRecord,
	type SpaceFsEntry,
	type SpaceFsFileResponse,
	type SpaceRecord,
	type TaskRunRecord,
	toggleCronJob,
	updateSpaceCollaborator,
} from "$lib/api";
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
import type { RealtimeEventPayload } from "$lib/realtime";
import { getRealtimeClient } from "$lib/realtime";
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
import { sessionPendingStore } from "$lib/stores/session-pending.svelte";
import { unreadTracker } from "$lib/stores/session-state.svelte";
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
let streamingAssistantText = $state("");
let streamingThinking = $state("");
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
let openFile = $state<SpaceFsFileResponse | null>(null);
let openFileDraft = $state("");
let openFileLoading = $state(false);
let openFileSaving = $state(false);
let openFileError = $state<string | null>(null);
let openFileTooLarge = $state(false);

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

let pageMounted = false;
let pageVisible = true;
let pageOnline = true;
let statusRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let statusRefreshInFlight = false;
let creatingSession = $state(false);
let createSessionError = $state("");
let loadingSessionIds = $state<Record<string, boolean>>({});
let bootstrapping = $state(true);
let sandbox = $state<SandboxRecord | null>(null);
let sandboxError = $state<string | null>(null);
let spaceStatusNotice = $state("");
let spaceStatusNoticeTimer: ReturnType<typeof setTimeout> | null = null;
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
let preloadingSessionIds = new Set<string>();
let visitedSessions = $state.raw(new Set<string>());
let scrollPosBySession = $state.raw(new Map<string, number>());
let suppressScrollSaveSessionIds = $state.raw(new Set<string>());
let scrollTargetSessionId = $state<string | null>(null);
let resetScrollTargetTimer: ReturnType<typeof setTimeout> | null = null;

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
		const normalized = candidate
			?.replace(/\s+/g, " ")
			.replace(/^[:\-\s]+/, "")
			.trim();
		if (normalized) return normalized.slice(0, 36);
	}
	return "New chat";
}

function hasSessionPermission(sessionId: string): boolean {
	return sessionPerms.some(
		(p) => p.resourceId === sessionId && p.level === "read",
	);
}

async function loadSpacePermissions() {
	try {
		const perms = await listSpacePermissions(spaceId);
		spacePerms = perms;
		spacePublicRead = perms.some(
			(p) =>
				p.resourceType === "space" &&
				p.level === "read" &&
				p.granteeUuid === null,
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
		await addSpaceCollaborator(
			spaceId,
			addingCollaboratorUuid.trim(),
			addingCollaboratorLevel,
		);
		addingCollaboratorUuid = "";
		await loadCollaborators();
	} catch (error) {
		addingCollaboratorError =
			error instanceof Error ? error.message : "Failed to add collaborator";
	} finally {
		savingCollaborator = false;
	}
}

async function handleUpdateCollaboratorLevel(
	granteeUuid: string,
	level: "read" | "write",
) {
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

async function loadCheckpointDetail(checkpointId: string) {
	checkpointDetailLoading = true;
	checkpointDetailError = "";
	try {
		const result = await getSpaceCheckpoint(spaceId, checkpointId);
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
		const { taskRunId } = await createSpaceCheckpoint(
			spaceId,
			checkpointCreateDescription.trim() || null,
		);
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
		const { jobs } = await getCronJobs(spaceId);
		const job = jobs.find((j) => j.id === cronjobId) ?? null;
		if (!job) {
			cronjobDetail = null;
			cronjobDetailError = "Scheduled job not found";
			return;
		}
		cronjobDetail = job;
		const { runs } = await getCronJobRuns(cronjobId);
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
		await toggleCronJob(cronjobDetail.id, enabled);
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
		await deleteCronJob(cronjobDetail.id);
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
		await createCronJob({
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
		const { run } = await getTaskRun(taskId);
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
		await createSessionPermission(shareModalSessionId, "read");
		const url = `${window.location.origin}${buildSpaceSessionRoute(spaceId, shareModalSessionId)}`;
		await navigator.clipboard.writeText(url);
		shareCopied = true;
		if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
		shareCopiedTimer = setTimeout(() => {
			shareCopied = false;
		}, 2000);
		await loadSpacePermissions();
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
		await deleteSessionPermission(shareModalSessionId);
		await loadSpacePermissions();
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
const sandboxStatusTone = $derived.by(() => {
	if (
		sandboxError ||
		space?.sandboxStatus === "error" ||
		sandbox?.status === "error"
	) {
		return "text-error-soft border-error-soft/20 bg-error-soft/8";
	}
	if (space?.sandboxStatus === "ready" || sandbox?.status === "ready") {
		return "text-success-soft border-success-soft/20 bg-success-soft/8";
	}
	return "text-text-secondary border-border-subtle bg-bg-surface";
});
const bootstrapStatusTone = $derived.by(() => {
	if (bootstrapStatus === "failed")
		return "text-error-soft border-error-soft/20 bg-error-soft/8";
	if (bootstrapStatus === "ready")
		return "text-success-soft border-success-soft/20 bg-success-soft/8";
	return "text-text-secondary border-border-subtle bg-bg-surface";
});
const canCreateSession = $derived(
	Boolean(
		space &&
			!creatingSession &&
			(space.sandboxStatus === "ready" || sandbox?.status === "ready"),
	),
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

async function loadSpace(_options?: { force?: boolean }) {
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

function showSpaceStatusNotice(message: string) {
	spaceStatusNotice = message;
	if (spaceStatusNoticeTimer) clearTimeout(spaceStatusNoticeTimer);
	spaceStatusNoticeTimer = setTimeout(() => {
		spaceStatusNotice = "";
		spaceStatusNoticeTimer = null;
	}, 2800);
}

function getStatusRefreshIntervalMs() {
	const sandboxState = sandbox?.status ?? space?.sandboxStatus ?? null;
	if (!pageVisible || !pageOnline) return null;
	if (sandboxState === "pending" || sandboxState === "provisioning") {
		return 1500;
	}
	if (bootstrapStatus === "pending" || bootstrapStatus === "running") {
		return 4000;
	}
	if (sandboxState === "error" || bootstrapStatus === "failed") {
		return 15000;
	}
	return null;
}

async function refreshSpaceStatus() {
	if (statusRefreshInFlight) return;
	statusRefreshInFlight = true;
	try {
		const [nextSpaceResult, nextSandboxResult] = await Promise.allSettled([
			getSpace(spaceId),
			getSpaceSandbox(spaceId),
		]);

		if (nextSpaceResult.status === "fulfilled") {
			const previousBootstrapStatus = bootstrapStatus;
			space = nextSpaceResult.value;
			const nextBootstrap = (() => {
				const raw = nextSpaceResult.value.meta;
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
		}
		if (nextSandboxResult.status === "fulfilled") {
			const previousSandboxStatus =
				sandbox?.status ?? space?.sandboxStatus ?? null;
			sandbox = nextSandboxResult.value.sandbox;
			if (nextSandboxResult.value.sandbox?.status === "error") {
				sandboxError =
					(nextSandboxResult.value.sandbox.meta?.lastError as string) ??
					"Sandbox provision failed";
			} else if (nextSandboxResult.value.sandbox?.status === "ready") {
				sandboxError = null;
				if (previousSandboxStatus !== "ready") {
					showSpaceStatusNotice("Environment ready");
				}
			}
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

async function handleRecreateSandbox() {
	if (!space) return;
	sandboxError = null;
	try {
		await recreateSpaceSandbox(spaceId);
		await loadSpace({ force: true });
		void loadFileTree(true);
	} catch (error) {
		sandboxError =
			error instanceof Error ? error.message : "Failed to recreate sandbox";
	}
}

async function handleRenameSpace(newName: string) {
	renameSaving = true;
	renameError = "";
	try {
		const result = await renameSpace(spaceId, newName);
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
		const response = await getSessionMessagesPaginated(sessionId, {
			limit: 30,
		});
		sessionPendingStore.reconcilePersisted(sessionId, response.messages);
		await messageCache.replaceAuthoritativeSnapshot({
			sessionId,
			messages: response.messages,
			hasMore: response.hasMore,
		});
		const existingOlder = state.messages.filter((message) =>
			response.messages.every((incoming) => incoming.id !== message.id),
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
				Boolean(
					streamingDraftAnchorUserMessageIdBySessionId[currentActiveSessionId],
				);
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
			spaceSessions = spaceSessions.map(
				(s): SessionRecord =>
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
function connectSessionWS(_sessionId: string) {
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

		sessionPendingStore.markStatus(
			sessionId,
			clientMessageId,
			"sent_unconfirmed",
		);
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
	const threshold = 140;
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
	void goto(buildSpaceDetailRoute(spaceId), {
		replaceState: true,
		noScroll: true,
		keepFocus: true,
	});
}

async function handleFileKeyboardSave(event: KeyboardEvent) {
	if (
		(event.metaKey || event.ctrlKey) &&
		event.key.toLowerCase() === "s" &&
		fileMode === "file"
	) {
		event.preventDefault();
		await saveOpenFile();
	}
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

	// Preload models catalog so model selector is ready immediately
	void loadModelsCatalog();

	// Set up WebSocket event listener once — filters by activeSessionId internally
	const wsClient = getRealtimeClient();
	const wsEventCleanup = wsClient.on("event", (payload) => {
		void handleWsEvent(payload);
	});

	const handleVisibility = () => {
		pageVisible = !document.hidden;
		if (pageVisible && activeSessionId) connectSessionWS(activeSessionId);
		if (!pageVisible) disconnectAllWS();
		scheduleStatusRefresh();
	};
	const handleOnline = () => {
		pageOnline = true;
		if (activeSessionId) connectSessionWS(activeSessionId);
		scheduleStatusRefresh();
	};
	const handleOffline = () => {
		pageOnline = false;
		disconnectAllWS();
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
		if (checkpointCopiedTimer) clearTimeout(checkpointCopiedTimer);
		if (spaceStatusNoticeTimer) clearTimeout(spaceStatusNoticeTimer);
		if (statusRefreshTimer) clearTimeout(statusRefreshTimer);
		pageMounted = false;
		wsEventCleanup();
		void wsClient.disconnect();
		window.removeEventListener("visibilitychange", handleVisibility);
		window.removeEventListener("online", handleOnline);
		window.removeEventListener("offline", handleOffline);
		window.removeEventListener("keydown", handleFileKeyboardSave);
		rightSidebarResizeCleanup?.();
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
		ensureSessionModelLoaded(routeSessionId);
		shouldAutoFollow = true;
		const state = sessionStateById[routeSessionId];
		if (state?.session?.lastMessageId)
			unreadTracker.markViewed(routeSessionId, state.session.lastMessageId);
		suppressScrollSaveSessionIds.add(routeSessionId);
		scrollTargetSessionId = routeSessionId;
		scheduleResetScrollTarget();
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
			scrollPosBySession.set(activeSessionId, container.scrollTop);
		}
		updateAutoFollow();
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
      {#if routeView === "session" && activeSessionState?.session}
        <button
          type="button"
          class="text-[13px] text-text-primary truncate max-w-[35%] select-none text-left hover:text-text-secondary transition-colors"
          title="Space details"
        >{space?.name || space?.title || spaceId}</button>
        <span class="text-text-tertiary shrink-0 text-[13px] select-none">/</span>
        <span class="text-[13px] text-text-secondary truncate">{getSessionTitle(activeSessionState.session)}</span>
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
    {#if routeView === 'checkpoint-new'}
      <div class="flex-1 p-4 overflow-y-auto max-w-2xl">
        {#if spaceLoadError}
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
        {#if spaceLoadError}
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
    {#if spaceLoadError && !sandboxError}
      <div class="m-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{spaceLoadError}</div>
    {/if}

    {#if createSessionError && !sandboxError}
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
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 sm:p-5">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Sandbox</div>
                  <div class="mt-1 text-[15px] font-medium text-text-primary">Environment status</div>
                </div>
                <div class={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${sandboxStatusTone}`}>
                  {(sandbox?.status ?? space?.sandboxStatus ?? "pending").replace(/_/g, " ")}
                </div>
              </div>

              <div class="mt-4 space-y-2 text-[13px] text-text-secondary">
                {#if sandboxError}
                  <p>The sandbox failed to provision.</p>
                  <div class="rounded-[6px] border border-error-soft/20 bg-error-soft/8 p-3 text-[12px] font-mono text-error-soft break-all">
                    {sandboxError}
                  </div>
                {:else if sandbox?.status === "ready" || space?.sandboxStatus === "ready"}
                  <p>The sandbox is ready. You can start a new chat now.</p>
                {:else}
                  <p>The sandbox is still provisioning. New chats become available as soon as the environment is ready.</p>
                {/if}
              </div>

              {#if sandboxError}
                <div class="mt-4">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-[6px] border border-[#FF3E00]/20 bg-[#FF3E00]/10 px-3 py-2 text-[12px] font-medium text-brand transition-colors hover:bg-[#FF3E00]/15"
                    onclick={handleRecreateSandbox}
                  >
                    <RefreshCw class="w-3.5 h-3.5" />
                    Retry sandbox
                  </button>
                </div>
              {/if}
            </section>

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
                  <p>Workspace initialization failed. Existing sandbox state is unaffected.</p>
                {:else}
                  <p>Workspace initialization is running independently from sandbox provisioning.</p>
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
                <div class="mt-1 text-[15px] font-medium text-text-primary">Ready when environment is ready</div>
              </div>
              <div class="text-[12px] text-text-tertiary">{spaceSessions.length} existing</div>
            </div>

            <div class="mt-4 text-[13px] text-text-secondary">
              {#if canCreateSession}
                <p>You can create a new chat immediately.</p>
              {:else}
                <p>Waiting for sandbox readiness before enabling new chats.</p>
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
        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-2 rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary transition-colors duration-100 disabled:opacity-50"
          onclick={() => handleCreateNewSession()}
          disabled={!canCreateSession}
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
    {:else if !sandboxError}
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
          selectedPath={routeFilePath ?? ""}
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
      selectedPath={routeFilePath ?? ""}
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
                    const url = `${window.location.origin}${buildSpaceSessionRoute(spaceId, perm.resourceId)}`;
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
