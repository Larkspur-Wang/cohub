<script lang="ts">
import type { ContentBlock } from "@cohub/protocol/core";
import type {
	GenerationParameterConstraint,
	GenerationPolicy,
	PublicGenerationDeclaration,
} from "@cohub/protocol/generation";
import type {
	MessageToolCallsFile,
	SessionTurnIndexItem,
	SessionTurnRecord,
	StoredIntermediateMessage,
} from "@cohub/protocol/model";
import type { SpacePublicEndpoints } from "@cohub/protocol/ports";
import type { ChannelEnvelope } from "@cohub/protocol/realtime";
import type { CanvasSemanticOp } from "@neta-art/cohub";
import {
	type CheckpointRecord,
	type CronJobRecord,
	type GenerationStreamEvent,
	HttpError,
	type Permission,
	type PromptTemplateCatalogEntry,
	type SessionRecord,
	type SpaceAccessPolicy,
	type SpaceFsEntry,
	type SpaceFsFileResponse,
	type SpaceMember,
	type SpaceRecord,
	type TaskRunRecord,
	type UserProfile,
	type WorkRecord,
	type WorkVersionRecord,
} from "@neta-art/cohub";
import {
	Activity,
	AlertCircle,
	ArrowDown,
	Check,
	Clock,
	Clock3,
	Code,
	Copy,
	Download,
	ExternalLink,
	Eye,
	FolderKanban,
	GitCommitHorizontal,
	Globe,
	Link,
	ListTree,
	Loader2,
	Lock,
	Maximize2,
	MessageSquare,
	Minimize2,
	MoreHorizontal,
	Network,
	PanelRightClose,
	PanelRightOpen,
	Pencil,
	Plus,
	Power,
	PowerOff,
	Rocket,
	Save,
	Settings,
	Share2,
	Terminal,
	TextCursorInput,
	Trash2,
	Upload,
	UserRound,
	X,
} from "lucide-svelte";
import { onDestroy, onMount, tick, untrack } from "svelte";
import { goto } from "$app/navigation";
import type { SessionListForkRecord } from "$lib/cache/db";
import {
	deleteCanvasPendingTransaction,
	listCanvasPendingTransactions,
	markCanvasPendingTransactionAttempt,
	writeCanvasPendingTransaction,
} from "$lib/cache/repositories/canvas-pending-tx-repo";
import { sessionTurnsRepo } from "$lib/cache/repositories/session-turns-repo";
import { spaceFsRepo } from "$lib/cache/repositories/space-fs-repo";
import { spaceRecordRepo } from "$lib/cache/repositories/space-record-repo";
import { writeTaskRunDetail } from "$lib/cache/repositories/task-runs-repo";
import {
	canvasItemToNode,
	createEmptyCovasDocument,
} from "$lib/canvas/canvas-document";
import { ensureCovasExtension, isCovasFile } from "$lib/canvas/canvas-file";
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import Dialog from "$lib/components/Dialog.svelte";
import FileUploadPane from "$lib/components/FileUploadPane.svelte";
import MessageContentFlow from "$lib/components/MessageContentFlow.svelte";
import MobileRightDrawer from "$lib/components/MobileRightDrawer.svelte";
import ModelSelector from "$lib/components/ModelSelector.svelte";
import { mediaLightbox } from "$lib/components/media-lightbox";
import NewChatBackground from "$lib/components/NewChatBackground.svelte";
import PageHeader from "$lib/components/PageHeader.svelte";
import PortPreview from "$lib/components/PortPreview.svelte";
import ResourceLabelPicker from "$lib/components/ResourceLabelPicker.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import SessionTaskTray, {
	type GenerationTaskNotice,
	type SessionTaskNotice,
} from "$lib/components/SessionTaskTray.svelte";
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";
import SpaceFileSidebar from "$lib/components/SpaceFileSidebar.svelte";
import ToolCallList from "$lib/components/ToolCallList.svelte";
import TurnBottomSheet from "$lib/components/TurnBottomSheet.svelte";
import TurnRail from "$lib/components/TurnRail.svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import WorkPublishDialog from "$lib/components/WorkPublishDialog.svelte";
import WorkspacePreviewPane from "$lib/components/WorkspacePreviewPane.svelte";
import {
	buildComposerTextContentBlock,
	type ComposerAttachment,
	type ComposerFileAttachment,
	type ComposerImageAttachment,
} from "$lib/composer-attachments";
// SettingsOverlay removed — settings merged inline into detail page
import {
	extractGenerationMediaItems,
	extractGenerationPromptPreview,
	isInlineMediaUrl,
} from "$lib/generation-task-media";
import { isComposingKeyboardEvent } from "$lib/keyboard";
import {
	parseResourceLabelRealtimePayload,
	syncResourceLabelsToCache,
} from "$lib/labels/resource-label-cache-sync";
import {
	COMPACT_SHELL_MAX_WIDTH_PX,
	DESKTOP_SHELL_MIN_WIDTH_PX,
} from "$lib/layout/breakpoints";
import { extractSpaceMentionsFromText } from "$lib/mentions/space";
import {
	readCachedPromptTemplates,
	writeCachedPromptTemplates,
} from "$lib/prompt-template-cache";
import { uploadChatAttachmentImage } from "$lib/public-asset-images";
import { sdk } from "$lib/sdk";
import { sortSessionsByRecentActivity } from "$lib/session-sort";
import type { TimelineItem } from "$lib/session-tree";
import { buildTurnTimelineItems } from "$lib/session-turn-render";
import {
	activateSpaceConfig,
	deactivateSpaceConfig,
	isSpaceConfigPath,
	type NewChatComposerApplyPayload,
	refreshSpaceConfig,
	type SpaceConfig,
	subscribeSpaceConfig,
	subscribeSpaceConfigBackgroundAction,
} from "$lib/space-config";
import {
	buildSpaceFileDownloadUrl,
	downloadSpaceFile,
} from "$lib/space-file-download";
import type { SpaceFsNode } from "$lib/space-fs";
import {
	buildSpaceCheckpointNewRoute,
	buildSpaceCheckpointRoute,
	buildSpaceCronjobNewRoute,
	buildSpaceCronjobRoute,
	buildSpaceFileRoute,
	buildSpaceLandingRoute,
	buildSpaceNewSessionRoute,
	buildSpaceSessionRoute,
	buildSpaceSessionTurnRoute,
	buildSpaceTaskRoute,
	buildSpaceWorkRoute,
} from "$lib/space-routes";
import {
	activateSpaceStyle,
	deactivateSpaceStyle,
	isSpaceStylePath,
	refreshSpaceStyle,
} from "$lib/space-style";
import { uploadSpaceEntries } from "$lib/space-upload";
import { authStore } from "$lib/stores/auth.svelte";
import {
	billingConversion,
	isBillingAccessBlockedCode,
} from "$lib/stores/billing-conversion.svelte";
import { insertComposerSnippet } from "$lib/stores/composer-insert";
import { modelsCatalogStore } from "$lib/stores/models-catalog.svelte";
import { sessionGenerationStore } from "$lib/stores/session-generation.svelte";
import {
	buildStreamingStoredIntermediateMessages,
	clearGenerationError,
	completeGeneration,
	failGeneration,
	interruptGeneration,
	replaceGenerationTurnId,
	resetGeneration,
	startGenerationRequest,
} from "$lib/stores/session-generation-controller";
import {
	fetchSessionListWithCache,
	getCachedSessionListSnapshot,
	onSessionListCacheUpdated,
	patchCachedSessionList,
} from "$lib/stores/session-list-cache";
import { unreadTracker } from "$lib/stores/session-state.svelte";
import {
	clearCachedSpaceFsSubtree,
	fetchSpaceFsDirWithCache,
	getCachedSpaceFsDir,
	patchCachedSpaceFsDir,
} from "$lib/stores/space-fs-cache";
import { patchCachedSpaceList } from "$lib/stores/space-list-cache";
import { cacheSpaceRecordSoon } from "$lib/stores/space-record-cache";
import {
	getCachedTaskRuns,
	mergeCachedCronJobTaskRuns,
	mergeCachedTaskRun,
	onTaskRunsCacheUpdated,
	restoreCachedTaskRuns,
} from "$lib/stores/task-runs-cache";
import { mergeTurnsById } from "$lib/stores/turn-cache";
import {
	loadMessageToolCalls,
	loadTurnIntermediate,
} from "$lib/stores/turn-intermediate-cache";
import {
	RIGHT_SIDEBAR_MAX,
	RIGHT_SIDEBAR_MIN,
	uiState,
} from "$lib/stores/ui.svelte";
import type { LocalUploadEntry } from "$lib/upload-entries";
import CanvasPreviewPanel from "./modules/CanvasPreviewPanel.svelte";
import CheckpointView from "./modules/CheckpointView.svelte";
import CronjobView from "./modules/CronjobView.svelte";
import {
	createCanvasPreviewController,
	type InlineCanvasPanelState,
} from "./modules/canvas-preview-controller.svelte";
import {
	buildSendMessagePayload,
	cronjobModelLabel,
	cronjobPayloadContent,
	cronjobPromptMeta,
	defaultTimezone,
	formatCronjobPrompt,
	promptTextFromPayload,
	validateCronjobForm,
} from "./modules/cronjob-utils";
import FilesSidebarPanel from "./modules/FilesSidebarPanel.svelte";
import FileWorkspace from "./modules/FileWorkspace.svelte";
import { createFileWorkspaceController } from "./modules/file-workspace-controller.svelte";
import {
	buildFsEntry,
	getParentDirPath,
	hasRenderedFilePreview,
	isHtmlPath,
	isMarkdownPath,
	makeFsNode,
	makeFsNodes,
	replaceNodeChildren,
	updateNodeState,
} from "./modules/file-workspace-utils";
import InlineFilePanel from "./modules/InlineFilePanel.svelte";
import PortPreviewPanel from "./modules/PortPreviewPanel.svelte";
import PortReadyToastView from "./modules/PortReadyToast.svelte";
import { createPortPreviewController } from "./modules/port-preview-controller.svelte";
import { extractPublicEndpoints } from "./modules/port-preview-utils";
import SessionWorkspace from "./modules/SessionWorkspace.svelte";
import {
	createSessionComposerController,
	revokeComposerAttachmentPreview,
} from "./modules/session-composer-controller.svelte";
import { createSessionGenerationRealtimeController } from "./modules/session-generation-realtime-controller.svelte";
import { createSessionScrollController } from "./modules/session-scroll-controller.svelte";
import {
	createSessionTaskController,
	isBackgroundBashTaskRun,
	isGenerationTaskRun,
	SESSION_TASK_TYPES,
	type SessionTaskType,
} from "./modules/session-task-controller.svelte";
import { createSessionTurnLoadingController } from "./modules/session-turn-loading-controller.svelte";
import {
	areSessionTurnRecordsEqual,
	extractBackgroundBashResultPreview,
	formatBackgroundBashSubtitle,
	getSessionTitle,
	getTurnClientMessageId,
	isOptimisticTurn,
	isSameClientMessageTurn,
	normalizeTurnDuplicates,
	reconcileOptimisticTurn,
} from "./modules/session-utils";
import { createSessionWorkspaceController } from "./modules/session-workspace-controller.svelte";
import { createSpaceRealtimeController } from "./modules/space-realtime-controller.svelte";
import {
	createSpaceStatusController,
	type SpaceSandboxSnapshot,
} from "./modules/space-status-controller.svelte";
import TaskRunView from "./modules/TaskRunView.svelte";
import { taskTypeLabel } from "./modules/task-run-utils";
import WorkView from "./modules/WorkView.svelte";
import {
	scopeState,
	selectedScopeList,
	WORK_SCOPE_OPTIONS,
	WORK_VIEWER_SCOPE_OPTIONS,
	workStatusTone,
} from "./modules/work-utils";
import {
	asRecord,
	displayUserName,
	formatBootstrapStage,
	formatBootstrapStatus,
	formatCompactId,
	formatDateTime,
	formatFileSize,
	formatShortDateTime,
	formatTokenCount,
	formatUsageCost,
	getSpacePrettyUrlHint,
	getSpacePublicPath,
	sandboxStatusKind,
	sandboxStatusLabel,
} from "./space-utils";

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
			| "work"
			| "task";
		sessionId?: string | null;
		filePath?: string | null;
		checkpointId?: string | null;
		cronjobId?: string | null;
		workId?: string | null;
		taskId?: string | null;
		turnSequence?: string | null;
	};
};
type SelectedModel = {
	provider: string;
	id: string;
	name?: string;
};
type ActiveFsSource =
	| { kind: "live" }
	| { kind: "checkpoint"; checkpointId: string };
type SessionViewState = {
	session: SessionRecord | undefined;
	turns: SessionTurnRecord[];
	loading: boolean;
	loaded: boolean;
	error: string;
	hasMore: boolean;
	hasMoreNewer: boolean;
	loadingOlder: boolean;
	loadingNewer: boolean;
	oldestCursor: number | undefined;
};
const PRELOAD_THRESHOLD = 10;
const TURN_SCROLL_ANCHOR_OFFSET = 16;
const SESSION_INITIAL_LOADING_DELAY_MS = 160;
const LOCAL_BOOTSTRAP_CACHE_TIMEOUT_MS = 180;
const props = $props();
const data = $derived((props as Props).data);
const spaceId = $derived(data.spaceId);
const routeView = $derived(data.view);
const routeSessionId = $derived(data.sessionId ?? null);
const isNewSessionRoute = $derived(
	routeView === "session" && routeSessionId === "new",
);
let resolvedNewSessionId = $state<string | null>(null);
const isDraftNewSessionRoute = $derived(
	isNewSessionRoute && !resolvedNewSessionId,
);
const routeFilePath = $derived(data.filePath ?? null);
const routeCheckpointId = $derived(data.checkpointId ?? null);
const activeFsSource = $derived.by(
	(): ActiveFsSource =>
		routeView === "checkpoint" && routeCheckpointId
			? { kind: "checkpoint", checkpointId: routeCheckpointId }
			: { kind: "live" },
);
const activeFsSourceKey = $derived(
	activeFsSource.kind === "checkpoint"
		? `checkpoint:${activeFsSource.checkpointId}`
		: "live",
);
const activeFsReadonly = $derived(activeFsSource.kind === "checkpoint");
const activeFsSidebarSubtitle = $derived(
	activeFsSource.kind === "checkpoint"
		? `Saved snapshot · ${activeFsSource.checkpointId.slice(0, 8)}`
		: "Space files",
);
const routeCronjobId = $derived(data.cronjobId ?? null);
const routeWorkId = $derived(data.workId ?? null);
const routeTaskId = $derived(data.taskId ?? null);
const routeTurnSequence = $derived.by(() => {
	const value = data.turnSequence;
	if (!value) return null;
	const sequence = Number(value);
	return Number.isFinite(sequence) && sequence > 0
		? Math.floor(sequence)
		: null;
});
let isMobile = $state(
	typeof window !== "undefined"
		? window.matchMedia(`(max-width: ${COMPACT_SHELL_MAX_WIDTH_PX}px)`).matches
		: false,
);
$effect(() => {
	if (typeof window === "undefined") return;
	const mql = window.matchMedia(`(max-width: ${COMPACT_SHELL_MAX_WIDTH_PX}px)`);
	const handler = (event: MediaQueryListEvent) => {
		isMobile = event.matches;
	};
	mql.addEventListener("change", handler);
	return () => mql.removeEventListener("change", handler);
});
const fileMode = $derived<"chat" | "file">(
	routeView === "file" ? "file" : "chat",
);
const isRightDrawerVisible = $derived(
	uiState.rightIsDragging || uiState.mobileRightDrawerOpen,
);
let space = $state<SpaceRecord | null>(null);
let spaceConfig = $state<SpaceConfig | null>(null);
let newChatProfileExpanded = $state(false);
let newChatProfileCanExpand = $state(false);
let newChatProfileBodyMaxHeight = $state(320);
let newChatProfileViewportEl: HTMLDivElement | null = $state(null);
let newChatProfileContentEl: HTMLDivElement | null = $state(null);
let newChatProfileBodyEl: HTMLDivElement | null = $state(null);
function hasAccessPermission(permission: Permission): boolean {
	return space?.access?.permissions.includes(permission) === true;
}
const canManageSessionAccess = $derived(hasAccessPermission("member.manage"));
// True when the backend returned only minimal info (session-level access only)
const spaceHasMinimalAccess = $derived(space?.accessLevel === "minimal");
const canEditSpaceProfile = $derived(hasAccessPermission("space.edit"));
const canEditFiles = $derived(hasAccessPermission("file.edit"));
const sessionWorkspace = createSessionWorkspaceController();
const spaceSessions = $derived(sessionWorkspace.spaceSessions);
const sessionStateById = $derived(sessionWorkspace.sessionStateById);
const activeSessionId = $derived(sessionWorkspace.activeSessionId);
const sessionComposer = createSessionComposerController();
const input = $derived(sessionComposer.input);
const attachments = $derived(sessionComposer.attachments);
const sending = $derived(sessionComposer.sending);
const aborting = $derived(sessionComposer.aborting);
// Session rename (header inline edit)
let sessionRenaming = $state(false);
let sessionRenameValue = $state("");
let sessionRenameSaving = $state(false);
let sessionRenameInputEl: HTMLInputElement | null = $state(null);
const composerError = $derived(sessionComposer.error);
const composerErrorCode = $derived(sessionComposer.errorCode);

function clearComposerError() {
	sessionComposer.clearError();
}

function setComposerError(message: string, code: string | null = null) {
	sessionComposer.setError(message, code);
}

function getHttpErrorCode(error: unknown): string | null {
	if (!(error instanceof HttpError)) return null;
	const body = error.body;
	if (!body || typeof body !== "object" || Array.isArray(body)) return null;
	const record = body as Record<string, unknown>;
	const directError = record.error;
	if (
		directError &&
		typeof directError === "object" &&
		!Array.isArray(directError)
	) {
		const code = (directError as Record<string, unknown>).code;
		if (typeof code === "string") return code;
	}
	const code = record.code;
	return typeof code === "string" ? code : null;
}
const modelsCatalog = $derived(modelsCatalogStore.items);
const visibleModelsCatalog = $derived(modelsCatalogStore.visibleItems);
let generationModelsCatalog = $state<PublicGenerationDeclaration[] | null>(
	null,
);
let generationPolicyMode = $state<"auto" | "limited">("auto");
let selectedGenerationModels = $state<Set<string>>(new Set());
let generationEnumSelections = $state<
	Record<string, Record<string, Set<string>>>
>({});
let generationNumericConstraints = $state<
	Record<string, Record<string, { min?: number; max?: number }>>
>({});
let generationBooleanConstraints = $state<
	Record<string, Record<string, { value?: boolean }>>
>({});
type PersistedGenerationPolicy = {
	mode: "auto" | "limited";
	models: string[];
	enumSelections: Record<string, Record<string, string[]>>;
	numericConstraints?: Record<
		string,
		Record<string, { min?: number; max?: number }>
	>;
	booleanConstraints?: Record<string, Record<string, { value?: boolean }>>;
};
let promptTemplates = $state<PromptTemplateCatalogEntry[]>([]);
let promptTemplatesLoaded = $state(false);
let promptTemplatesLoadedFor = $state<string | null>(null);
let promptTemplatesRefreshInFlight: Promise<void> | null = null;
let promptTemplatesRefreshInFlightFor: string | null = null;
let showModelSelector = $state(false);
let resourceActionMenuOpen = $state(false);
let labelPickerResource = $state<{
	type: "session" | "checkpoint" | "file";
	ref: string;
} | null>(null);
let sessionModelById = $state<Record<string, SelectedModel | null>>({});
let draftSessionModel = $state<SelectedModel | null>(null);
const portPreview = createPortPreviewController({
	getSpaceId: () => spaceId,
	getSpace: () => space,
	getPageMounted: () => pageMounted,
	getHasMinimalAccess: () => spaceHasMinimalAccess,
	onOpenPanel: () => {
		closePreviewFocusMode();
		ensurePreviewPanelFits();
	},
	onClosePanel: () => {
		closePreviewFocusMode();
	},
	onBeforeOpenPort: () => {
		fileWorkspace.closeInlineFile();
		canvasPreview.closeCanvas();
	},
});
const previewEndpoints = $derived(portPreview.endpoints);
const inlinePortPreview = $derived(portPreview.preview);
const portReadyToast = $derived(portPreview.readyToast);
const spaceStatus = createSpaceStatusController({
	getSpaceId: () => spaceId,
	getBootstrapStatus: () => bootstrapStatus,
	getPageVisible: () => pageVisible,
	getPageOnline: () => pageOnline,
	getPageMounted: () => pageMounted,
	onSpaceLoaded: (nextSpace) => {
		space = nextSpace;
		portPreview.setEndpoints(extractPublicEndpoints(nextSpace));
		cacheSpaceRecordSoon(nextSpace);
	},
});
const spaceLoadError = $derived(spaceStatus.loadError);
const spaceMembers = $derived(spaceStatus.members);
const spaceMembersLoadedFor = $derived(spaceStatus.membersLoadedFor);
const spaceUsage = $derived(spaceStatus.usage);
const spaceUsageLoadedFor = $derived(spaceStatus.usageLoadedFor);
const spaceSandbox = $derived(spaceStatus.sandbox);
const spaceSandboxLoadedFor = $derived(spaceStatus.sandboxLoadedFor);
const spaceStatusNotice = $derived(spaceStatus.notice);
let workPublishTarget = $state<{
	targetType: "file" | "directory" | "port";
	targetRef: string;
} | null>(null);
const fileWorkspace = createFileWorkspaceController({
	getSpaceId: () => spaceId,
	getActiveFsSource: () => activeFsSource,
	getActiveFsSourceKey: () => activeFsSourceKey,
	getRouteFilePath: () => routeFilePath,
	getCanEditFiles: () => canEditFiles,
	getActiveFsReadonly: () => activeFsReadonly,
	getSpaceHasMinimalAccess: () => spaceHasMinimalAccess,
	onCloseRouteFile: () => {
		void goto(buildSpaceNewSessionRoute(spaceId), {
			replaceState: true,
			noScroll: true,
			keepFocus: true,
		});
	},
	onOpenInlineCanvas: (path) => canvasPreview.openCanvas(path),
	onCloseInlineCanvas: () => canvasPreview.closeCanvas(),
	onRenameInlineCanvas: (fromPath, toPath) =>
		canvasPreview.renamePath(fromPath, toPath),
	onOpenInlinePort: (port, url, optionsArg) =>
		portPreview.openPort(port, url, optionsArg),
	onCloseInlinePort: () => portPreview.closePort(),
	onClosePreviewFocusMode: closePreviewFocusMode,
	onEnsurePreviewPanelFits: ensurePreviewPanelFits,
});
const canvasPreview = createCanvasPreviewController({
	getSpaceId: () => spaceId,
	getSourceKey: () => activeFsSourceKey,
	readFile: fileWorkspace.readActiveFsFile,
	onOpenPanel: () => {
		closePreviewFocusMode();
		ensurePreviewPanelFits();
	},
	onClosePanel: () => {
		closePreviewFocusMode();
	},
	onBeforeOpenCanvas: () => {
		fileWorkspace.closeInlineFile();
		portPreview.closePort();
	},
	onMarkSavePending: fileWorkspace.markFileSavePending,
	onClearSavePendingSoon: fileWorkspace.clearFileSavePendingSoon,
});
const fileTree = $derived(fileWorkspace.fileTree);
const fileTreeLoading = $derived(fileWorkspace.fileTreeLoading);
const fileTreeError = $derived(fileWorkspace.fileTreeError);
const openFile = $derived(fileWorkspace.openFile);
const openFileLoading = $derived(fileWorkspace.openFileLoading);
const openFileSaving = $derived(fileWorkspace.openFileSaving);
const openFileError = $derived(fileWorkspace.openFileError);
const openFileTooLarge = $derived(fileWorkspace.openFileTooLarge);
const inlineFile = $derived(fileWorkspace.inlineFile);
const inlineCanvas = $derived(canvasPreview.canvas);
const selectedFilePath = $derived(
	inlineCanvas?.path ?? inlineFile?.path ?? routeFilePath ?? "",
);
const inlineFileDirty = $derived(fileWorkspace.inlineFileDirty);
const openWorkPublish = (
	targetType: "file" | "directory" | "port",
	targetRef: string,
) => {
	workPublishTarget = { targetType, targetRef };
};
const publishOpenFile = () => {
	if (openFile) openWorkPublish("file", openFile.path);
};
const publishInlineFile = () => {
	if (inlineFile?.response) openWorkPublish("file", inlineFile.response.path);
};
const inlineFileIsMarkdown = $derived(fileWorkspace.inlineFileIsMarkdown);
const inlineFileIsHtml = $derived(fileWorkspace.inlineFileIsHtml);
const inlineFileHasRenderedPreview = $derived(
	fileWorkspace.inlineFileHasRenderedPreview,
);
const inlineFileExt = $derived(fileWorkspace.inlineFileExt);
const inlineFileIsImage = $derived(fileWorkspace.inlineFileIsImage);
const inlineFileIsVideo = $derived(fileWorkspace.inlineFileIsVideo);
const inlineFileIsText = $derived(fileWorkspace.inlineFileIsText);
const inlineFileDataUrl = $derived(fileWorkspace.inlineFileDataUrl);
const inlineFileDownloadUrl = $derived(fileWorkspace.inlineFileDownloadUrl);
const inlineFileDownloadName = $derived(fileWorkspace.inlineFileDownloadName);
const inlinePortEndpoint = $derived.by(() => {
	if (!inlinePortPreview) return null;
	return previewEndpoints[inlinePortPreview.port] ?? null;
});
const activePreviewKind = $derived(
	inlinePortPreview
		? "port"
		: inlineCanvas
			? "canvas"
			: inlineFile
				? "file"
				: null,
);
const openFileDraft = $derived(fileWorkspace.openFileDraft);
const openFileCopied = $derived(fileWorkspace.openFileCopied);
const inlineFileCopied = $derived(fileWorkspace.inlineFileCopied);
const fileDirty = $derived(fileWorkspace.fileDirty);
const openFileIsMarkdown = $derived(fileWorkspace.openFileIsMarkdown);
const openFileIsHtml = $derived(fileWorkspace.openFileIsHtml);
const openFileHasRenderedPreview = $derived(
	fileWorkspace.openFileHasRenderedPreview,
);
const openFileExt = $derived(fileWorkspace.openFileExt);
const openFileIsImage = $derived(fileWorkspace.openFileIsImage);
const openFileIsVideo = $derived(fileWorkspace.openFileIsVideo);
const openFileIsText = $derived(fileWorkspace.openFileIsText);
const openFileDataUrl = $derived(fileWorkspace.openFileDataUrl);
const openFileDownloadUrl = $derived(fileWorkspace.openFileDownloadUrl);
const openFileDownloadName = $derived(fileWorkspace.openFileDownloadName);
const openFilePanHandlers = makeImagePanHandlers(
	() => fileWorkspace.openFileZoom,
	() => fileWorkspace.openFilePanX,
	() => fileWorkspace.openFilePanY,
	(v) => (fileWorkspace.openFilePanX = v),
	(v) => (fileWorkspace.openFilePanY = v),
	(v) => (fileWorkspace.openFileDragging = v),
);
const inlineFilePanHandlers = makeImagePanHandlers(
	() => fileWorkspace.inlineFileZoom,
	() => fileWorkspace.inlineFilePanX,
	() => fileWorkspace.inlineFilePanY,
	(v) => (fileWorkspace.inlineFilePanX = v),
	(v) => (fileWorkspace.inlineFilePanY = v),
	(v) => (fileWorkspace.inlineFileDragging = v),
);
let previewPanelWidth = $state(480);
let previewPanelResizeCleanup: (() => void) | null = null;
let previewFocusMode = $state(false);
let previewFocusSnapshot: {
	leftSidebarCollapsed: boolean;
	rightSidebarCollapsed: boolean;
	previewPanelWidth: number;
} | null = null;
let workspaceBodyEl = $state<HTMLDivElement | null>(null);
const CHAT_PANEL_MIN_WIDTH = 320;
const PREVIEW_PANEL_MIN_WIDTH = 280;

let loadedSpaceId = $state<string | null>(null);
let pageMounted = false;
let creatingSession = $state(false);
let createSessionError = $state("");
const loadingSessionIds = $derived(sessionWorkspace.loadingSessionIds);
const visibleInitialLoadingSessionIds = $derived(
	sessionWorkspace.visibleInitialLoadingSessionIds,
);
let bootstrapping = $state(true);
const sessionScroll = createSessionScrollController();
let bottomFollowFrame: number | null = null;
let bottomFollowActive = false;
let composerHostEl = $state<HTMLDivElement | null>(null);
const shouldAutoFollow = $derived(sessionScroll.shouldAutoFollow);
const composerHeight = $derived(sessionScroll.composerHeight);
let hasUnread = $derived.by(() => {
	const session = activeSessionState?.session;
	if (
		!session ||
		!activeSessionState.loaded ||
		activeSessionState.turns.length === 0
	)
		return false;
	return unreadTracker.isUnread(session, session.lastMessageId);
});
let autoScrollGuard = $state(false);
let restoringBottomSessionId = $state<string | null>(null);
let programmaticScrollActive = false;
let programmaticScrollTarget: number | null = null;
let userScrollActive = false;
let rightSidebarResizeCleanup: (() => void) | null = null;
const listEl = $derived(sessionScroll.listEl);
const chatTimelineRef = $derived(sessionScroll.chatTimelineRef);
const sessionTurnLoading = createSessionTurnLoadingController({
	getSpaceId: () => spaceId,
});
const turnIndexBySessionId = $derived(sessionTurnLoading.turnIndexBySessionId);
const turnIndexLoadingBySessionId = $derived(
	sessionTurnLoading.turnIndexLoadingBySessionId,
);
const turnIndexRetryAfterBySessionId = $derived(
	sessionTurnLoading.turnIndexRetryAfterBySessionId,
);
const loadingTurnSequence = $derived(sessionTurnLoading.loadingTurnSequence);
let currentTurnSequence = $state<number | null>(null);
let highlightedTurnSequence = $state<number | null>(null);
const turnMarkerPositions = $derived(sessionScroll.turnMarkerPositions);
const turnMarkerHeights = $derived(sessionScroll.turnMarkerHeights);
const timelineScrollTop = $derived(sessionScroll.timelineScrollTop);
const timelineScrollHeight = $derived(sessionScroll.timelineScrollHeight);
const timelineClientHeight = $derived(sessionScroll.timelineClientHeight);
let showTurnBottomSheet = $state(false);
let appliedRouteTurnKey = $state<string | null>(null);
let appliedRouteFileKey = "";
let appliedFsSourceKey: string | null = null;
let preloadingSessionIds = new Set<string>();
let turnMarkerMeasureFrame: number | null = null;
let lastTurnIndexRefreshKey = "";
let refreshSessionsListInFlight: Promise<void> | null = null;
let refreshSessionsListQueued = false;
let refreshSessionsListQueuedForce = false;
const sessionLoadInFlight = new Map<string, Promise<void>>();
const syncSessionNewerInFlight = new Map<string, Promise<void>>();
const turnHydrationInFlight = new Map<string, Promise<void>>();
let reconnectSyncInFlight: Promise<void> | null = null;
type SessionScrollAnchor = {
	sequence: number;
	offset: number;
	updatedAt: number;
};
const SESSION_SCROLL_ANCHOR_STORAGE_KEY = "cohub:session_scroll_anchor";
const scrollAnchorBySession = $derived(sessionScroll.scrollAnchorBySession);
const pendingRestoreSessionId = $derived(sessionScroll.pendingRestoreSessionId);
const activeAnchorRestore = $derived(sessionScroll.activeAnchorRestore);
const pendingTimelineMarkdownRenders = $derived(
	sessionScroll.pendingTimelineMarkdownRenders,
);
const anchorRestoreWaitingForMarkdown = $derived(
	sessionScroll.anchorRestoreWaitingForMarkdown,
);
const spaceRealtime = createSpaceRealtimeController({
	onTransportOpen: () => generationRealtime.onTransportOpen(),
	onConnectionOpened: () => {
		if (inlineCanvas?.documentId) {
			void flushInlineCanvasPendingTransactions(inlineCanvas.documentId).catch(
				() => undefined,
			);
		}
	},
	onConnectionRecovered: () => {
		void reconnectSync();
	},
	onHidden: () => {
		if (activeSessionId) captureCurrentScrollAnchor(activeSessionId);
	},
	onVisible: () => {
		void refreshSessionsList(false);
		if (activeSessionId && sessionStateById[activeSessionId]?.loaded) {
			void reconcileSessionTail(activeSessionId);
		}
	},
	onOnline: () => {
		if (wsConnectionState === "open") {
			void refreshSessionsList(false);
		}
		if (inlineCanvas?.documentId) {
			void flushInlineCanvasPendingTransactions(inlineCanvas.documentId).catch(
				() => undefined,
			);
		}
	},
	onOffline: () => undefined,
	onStatusVisibilityChanged: () => scheduleStatusRefresh(),
});
const pageVisible = $derived(spaceRealtime.pageVisible);
const pageOnline = $derived(spaceRealtime.pageOnline);
const wsConnectionState = $derived(spaceRealtime.connectionState);
const wsCanRecover = $derived(spaceRealtime.canRecover);
const generationRealtime = createSessionGenerationRealtimeController({
	getSpaceId: () => spaceId,
	getConnectionState: () => wsConnectionState,
	getActiveSessionId: () => activeSessionId,
	getSessionState: (id) => sessionStateById[id],
	updateSessionState: (id, state) => {
		sessionWorkspace.sessionStateById = {
			...sessionStateById,
			[id]: state,
		};
	},
	refreshSessionsList: (force) => refreshSessionsList(force ?? true),
	requestBottomFollow: (options) => requestBottomFollow(options),
	shouldAutoFollow: () => shouldAutoFollow,
	getListEl: () => listEl,
	captureCurrentScrollAnchor: (sessionId) =>
		captureCurrentScrollAnchor(sessionId),
	getSessionScrollAnchor: (sessionId) => getSessionScrollAnchor(sessionId),
	areSessionScrollAnchorsEqual: (current, snapshot) =>
		areSessionScrollAnchorsEqual(current, snapshot),
	restoreSessionScrollAnchorSoon: (sessionId) =>
		restoreSessionScrollAnchorSoon(sessionId),
	isUserScrollActive: () => userScrollActive,
	syncGenerationStateFromTail: (sessionId, turns, requestStartedAt) =>
		syncGenerationStateFromTail(sessionId, turns, requestStartedAt),
	onRecovered: () => {
		spaceRealtime.markRecovered();
	},
	onExhausted: (sessionId) => {
		console.warn("[SessionRecoveryCoordinator] Fallback sync exhausted", {
			sessionId,
			spaceId,
		});
	},
});
// ─── Share ───
let showShareModal = $state(false);
let shareModalSessionId = $state<string | null>(null);
let shareCopied = $state(false);
let shareCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let shareModalError = $state("");
let shareModalSaving = $state(false);
let forkingTurnId = $state<string | null>(null);
let sessionAccessById = $state<Record<string, SpaceAccessPolicy | null>>({});
let checkpointDetail = $state<CheckpointRecord | null>(null);
// ─── Cronjobs ───
let cronjobDetail = $state<CronJobRecord | null>(null);
// ─── Works ───
let workDetail = $state<WorkRecord | null>(null);
// ─── Tasks ───
let taskRunDetail = $state<TaskRunRecord | null>(null);
const sessionTasks = createSessionTaskController();
const generationTaskRunById = $derived(sessionTasks.generationTaskRunById);
const backgroundBashTaskRunById = $derived(
	sessionTasks.backgroundBashTaskRunById,
);
const backgroundBashHydrateKey = $derived(
	sessionTasks.backgroundBashHydrateKey,
);
const sessionTaskRecentHydrateKey = $derived(sessionTasks.recentHydrateKey);
const SESSION_TASK_PAGE_LIMIT = 8;
const taskHydrateRetryCounts = new Map<string, number>();
const taskHydrateRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const sessionTaskRecentLoading = $derived(sessionTasks.recentLoading);
const sessionTaskRecentCursors = $derived(sessionTasks.recentCursors);
const sessionTaskRecentHasMoreByType = $derived(
	sessionTasks.recentHasMoreByType,
);
const pendingFollowupActionIds = $derived(
	sessionTasks.pendingFollowupActionIds,
);
function normalizeTabTitleSegment(
	value: string | null | undefined,
	fallback: string,
	maxLength = 48,
): string {
	const normalized = value?.replace(/\s+/g, " ").trim() || fallback;
	return normalized.length > maxLength
		? `${normalized.slice(0, maxLength - 1)}…`
		: normalized;
}
function hasSessionPermission(sessionId: string): boolean {
	const access = sessionAccessById[sessionId];
	return (
		!!access &&
		(access.anonymous_user === "guest" ||
			access.anonymous_user === "builder" ||
			access.signed_in_user === "guest" ||
			access.signed_in_user === "builder")
	);
}
async function removeSessionAccess(sessionId: string) {
	try {
		await sdk.sessionAccess.remove(sessionId);
		sessionAccessById = { ...sessionAccessById, [sessionId]: null };
	} catch {
		// Silently fail
	}
}
function modelFromPayload(payload: unknown): SelectedModel | null {
	const record = asRecord(payload);
	const provider = record?.provider;
	const model = record?.model;
	if (typeof provider !== "string" || !provider.trim()) return null;
	if (typeof model !== "string" || !model.trim()) return null;
	const catalogItem = modelsCatalog?.find(
		(item) => item.provider === provider && item.id === model,
	);
	return {
		provider,
		id: model,
		name: catalogItem?.model.name as string | undefined,
	};
}
// ─── Task detail ───
const taskRunSortTime = (run: Pick<TaskRunRecord, "updatedAt" | "createdAt">) =>
	Date.parse(run.updatedAt ?? run.createdAt ?? "") || 0;
function getTaskPayloadData(run: Pick<TaskRunRecord, "payload">) {
	return asRecord(asRecord(run.payload)?.data);
}
function mergeTaskRunRecord(
	current: TaskRunRecord | null,
	patch: Partial<TaskRunRecord> & {
		id: string;
		type?: string;
		userId?: string | null;
	},
): TaskRunRecord {
	const now = new Date().toISOString();
	return {
		id: patch.id,
		jobId: patch.jobId ?? current?.jobId ?? patch.id,
		cronJobId: patch.cronJobId ?? current?.cronJobId ?? null,
		taskType: patch.taskType ?? patch.type ?? current?.taskType ?? "unknown",
		status: patch.status ?? current?.status ?? "pending",
		payload: patch.payload ?? current?.payload ?? null,
		result: patch.result ?? current?.result ?? null,
		errorMessage: patch.errorMessage ?? current?.errorMessage ?? null,
		attemptCount: patch.attemptCount ?? current?.attemptCount ?? 0,
		spaceId: patch.spaceId ?? current?.spaceId ?? spaceId,
		sessionId: patch.sessionId ?? current?.sessionId ?? null,
		turnId: patch.turnId ?? current?.turnId ?? null,
		userUuid: patch.userUuid ?? patch.userId ?? current?.userUuid ?? null,
		userProfile: patch.userProfile ?? current?.userProfile,
		scheduledAt: patch.scheduledAt ?? current?.scheduledAt ?? null,
		startedAt: patch.startedAt ?? current?.startedAt ?? null,
		finishedAt: patch.finishedAt ?? current?.finishedAt ?? null,
		createdAt: patch.createdAt ?? current?.createdAt ?? now,
		updatedAt: patch.updatedAt ?? current?.updatedAt ?? now,
	};
}
function mergeTaskRunList(
	runs: TaskRunRecord[],
	patch: Partial<TaskRunRecord> & {
		id: string;
		type?: string;
		userId?: string | null;
	},
) {
	const existing = runs.find((run) => run.id === patch.id) ?? null;
	const nextRun = mergeTaskRunRecord(existing, patch);
	const nextRuns = existing
		? runs.map((run) => (run.id === patch.id ? nextRun : run))
		: [nextRun, ...runs];
	return [...nextRuns].sort((a, b) => taskRunSortTime(b) - taskRunSortTime(a));
}
function isDisplayableGenerationTaskRun(
	run: TaskRunRecord,
): run is TaskRunRecord & {
	sessionId: string;
	status: GenerationTaskNotice["status"];
} {
	return (
		isGenerationTaskRun(run) &&
		!!run.sessionId &&
		(run.status === "pending" ||
			run.status === "running" ||
			run.status === "completed" ||
			run.status === "failed")
	);
}
function toGenerationTaskNotice(
	run: TaskRunRecord,
): GenerationTaskNotice | null {
	if (!isDisplayableGenerationTaskRun(run)) return null;
	return {
		id: run.id,
		kind: "generation",
		spaceId: run.spaceId ?? spaceId,
		sessionId: run.sessionId,
		turnId: run.turnId ?? null,
		status: run.status,
		title:
			run.status === "completed"
				? "Generation ready"
				: run.status === "failed"
					? "Generation failed"
					: "Generating",
		subtitle: null,
		preview: extractGenerationPromptPreview(run.payload),
		mediaItems: extractGenerationMediaItems(run.result, { deferBase64: true }),
		createdAt: run.createdAt,
		startedAt: run.startedAt,
		updatedAt: run.updatedAt,
		finishedAt: run.finishedAt,
	};
}
function toBackgroundBashTaskNotice(
	run: TaskRunRecord,
): SessionTaskNotice | null {
	if (!isBackgroundBashTaskRun(run)) return null;
	if (!["pending", "running", "completed", "failed"].includes(run.status))
		return null;
	const sessionId = run.sessionId;
	if (!sessionId) return null;
	const data = getTaskPayloadData(run);
	const command =
		typeof data?.command === "string"
			? data.command.trim()
			: "Background command";
	return {
		id: run.id,
		kind: "background_bash",
		spaceId: run.spaceId ?? spaceId,
		sessionId,
		turnId: run.turnId ?? null,
		status: run.status,
		title: command.split("\n")[0]?.trim() || "Background command",
		subtitle: formatBackgroundBashSubtitle(run),
		preview: extractBackgroundBashResultPreview(run.result),
		mediaItems: [],
		createdAt: run.createdAt,
		startedAt: run.startedAt,
		updatedAt: run.updatedAt,
		finishedAt: run.finishedAt,
	};
}
function upsertGenerationTaskRun(run: TaskRunRecord) {
	sessionTasks.upsertGenerationTaskRun(run);
}
function upsertBackgroundBashTaskRun(run: TaskRunRecord) {
	sessionTasks.upsertBackgroundBashTaskRun(run);
}
async function hydrateTaskRun(taskId: string) {
	try {
		const detail = await sdk.tasks.get(taskId);
		taskHydrateRetryCounts.delete(taskId);
		const retryTimer = taskHydrateRetryTimers.get(taskId);
		if (retryTimer) clearTimeout(retryTimer);
		taskHydrateRetryTimers.delete(taskId);
		if (detail.run.spaceId) mergeCachedTaskRun(detail.run.spaceId, detail.run);
		if (detail.run.spaceId)
			void writeTaskRunDetail(
				detail.run.spaceId,
				detail.run,
				detail.progress,
			).catch(() => undefined);
		if (isGenerationTaskRun(detail.run)) upsertGenerationTaskRun(detail.run);
		if (isBackgroundBashTaskRun(detail.run))
			upsertBackgroundBashTaskRun(detail.run);
	} catch {
		const retryCount = taskHydrateRetryCounts.get(taskId) ?? 0;
		if (retryCount >= 3 || taskHydrateRetryTimers.has(taskId)) return;
		taskHydrateRetryCounts.set(taskId, retryCount + 1);
		const timer = setTimeout(
			() => {
				taskHydrateRetryTimers.delete(taskId);
				void hydrateTaskRun(taskId);
			},
			1000 * 2 ** retryCount,
		);
		taskHydrateRetryTimers.set(taskId, timer);
	}
}
function ingestSessionTaskRun(run: TaskRunRecord) {
	mergeCachedTaskRun(spaceId, run);
	if (isGenerationTaskRun(run)) upsertGenerationTaskRun(run);
	if (isBackgroundBashTaskRun(run)) upsertBackgroundBashTaskRun(run);
}
async function fetchSessionTasksByType(
	sessionId: string,
	taskType: SessionTaskType,
	options: {
		status?: "active";
		cursor?: string | null;
	},
) {
	const { runs, pageInfo } = await sdk.tasks.list({
		spaceId,
		sessionId,
		taskType,
		status: options.status,
		limit: SESSION_TASK_PAGE_LIMIT,
		cursor: options.cursor ?? undefined,
	});
	return {
		runs,
		pageInfo: pageInfo ?? { hasMore: false, nextCursor: null },
	};
}
async function hydrateActiveSessionTasks(sessionId: string) {
	const requestSpaceId = spaceId;
	try {
		const results = await Promise.all(
			SESSION_TASK_TYPES.map((taskType) =>
				fetchSessionTasksByType(sessionId, taskType, { status: "active" }),
			),
		);
		if (spaceId !== requestSpaceId || activeSessionId !== sessionId) return;
		for (const result of results) {
			for (const run of result.runs) ingestSessionTaskRun(run);
		}
	} catch (error) {
		console.warn("Failed to load active session tasks:", error);
	}
}
function resetRecentSessionTaskPagination() {
	sessionTasks.resetRecentPagination();
}
async function loadRecentSessionTaskPage(sessionId: string) {
	if (sessionTaskRecentLoading) return;
	const requestSpaceId = spaceId;
	const hydrateKey = `${requestSpaceId}:${sessionId}`;
	const isCurrentRequest = () =>
		spaceId === requestSpaceId &&
		sessionWorkspace.activeSessionId === sessionId;
	sessionTasks.recentLoading = true;
	try {
		const results = await Promise.all(
			SESSION_TASK_TYPES.map(async (taskType) => {
				if (
					sessionTaskRecentHydrateKey === hydrateKey &&
					sessionTaskRecentHasMoreByType[taskType] === false
				) {
					return { taskType, runs: [], pageInfo: null };
				}
				const { runs, pageInfo } = await fetchSessionTasksByType(
					sessionId,
					taskType,
					{
						cursor:
							sessionTaskRecentHydrateKey === hydrateKey
								? sessionTaskRecentCursors[taskType]
								: undefined,
					},
				);
				return { taskType, runs, pageInfo };
			}),
		);
		if (!isCurrentRequest()) return;
		for (const result of results) {
			for (const run of result.runs) ingestSessionTaskRun(run);
		}
		const nextCursors: Partial<Record<SessionTaskType, string | null>> = {
			...(sessionTaskRecentHydrateKey === hydrateKey
				? sessionTaskRecentCursors
				: {}),
		};
		const nextHasMore: Partial<Record<SessionTaskType, boolean>> = {
			...(sessionTaskRecentHydrateKey === hydrateKey
				? sessionTaskRecentHasMoreByType
				: {}),
		};
		for (const result of results) {
			if (!result.pageInfo) continue;
			nextCursors[result.taskType] = result.pageInfo.nextCursor;
			nextHasMore[result.taskType] = result.pageInfo.hasMore;
		}
		sessionTasks.setRecentPagination(hydrateKey, nextCursors, nextHasMore);
	} catch (error) {
		if (isCurrentRequest())
			console.warn("Failed to load recent session tasks:", error);
	} finally {
		if (isCurrentRequest()) sessionTasks.recentLoading = false;
	}
}
function handleSessionTaskTrayExpand() {
	if (!activeSessionId) return;
	void loadRecentSessionTaskPage(activeSessionId);
}
function handleSessionTaskTrayLoadMore() {
	if (!activeSessionId) return;
	void loadRecentSessionTaskPage(activeSessionId);
}
async function handleOpenGenerationTaskMedia(notice: GenerationTaskNotice) {
	const hasDeferredMedia = notice.mediaItems.some(
		(item) =>
			item.deferred ||
			isInlineMediaUrl(item.src) ||
			isInlineMediaUrl(item.poster),
	);
	if (!hasDeferredMedia) {
		mediaLightbox.show(notice.mediaItems);
		return;
	}
	try {
		const detail = await sdk.tasks.get(notice.id);
		const mediaItems = extractGenerationMediaItems(detail.run.result);
		if (mediaItems.length > 0) mediaLightbox.show(mediaItems);
	} catch (error) {
		console.warn("Failed to load generation media:", error);
	}
}
function openShareModal(sessionId: string) {
	if (!canManageSessionAccess) return;
	shareModalSessionId = sessionId;
	showShareModal = true;
	shareCopied = false;
	shareModalError = "";
}
async function shareAndCopyLink() {
	if (!shareModalSessionId || !canManageSessionAccess) return;
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
	if (!shareModalSessionId || !canManageSessionAccess) return;
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
const draftSessionState = $derived<SessionViewState | null>(
	isDraftNewSessionRoute
		? {
				session: undefined,
				turns: [],
				loading: false,
				loaded: true,
				error: "",
				hasMore: false,
				hasMoreNewer: false,
				loadingOlder: false,
				loadingNewer: false,
				oldestCursor: undefined,
			}
		: null,
);
const activeSessionState = $derived(
	isDraftNewSessionRoute
		? draftSessionState
		: activeSessionId
			? (sessionStateById[activeSessionId] ?? null)
			: null,
);
const activeSessionInitialLoadingVisible = $derived.by(() =>
	Boolean(activeSessionId && visibleInitialLoadingSessionIds[activeSessionId]),
);
const newChatBackground = $derived(
	spaceConfig?.ui?.newChat?.background ?? null,
);
const shouldShowNewChatBackground = $derived(
	Boolean(
		newChatBackground &&
			isNewSessionRoute &&
			!activeSessionId &&
			(activeSessionState?.turns.length ?? 0) === 0,
	),
);
const shouldShowNewChatProfile = $derived(
	Boolean(
		space &&
			isNewSessionRoute &&
			!activeSessionId &&
			(activeSessionState?.turns.length ?? 0) === 0 &&
			!shouldShowNewChatBackground,
	),
);
$effect(() => {
	if (!shouldShowNewChatProfile || !space) return;
	untrack(() => {
		if (
			hasAccessPermission("member.view") &&
			spaceMembersLoadedFor !== spaceId
		) {
			void loadSpaceMembers(spaceId);
		}
		if (spaceUsageLoadedFor !== spaceId) void loadSpaceUsage(spaceId);
		if (
			hasAccessPermission("sandbox.view") &&
			spaceSandboxLoadedFor !== spaceId
		) {
			void loadSpaceSandbox(spaceId);
		}
	});
});
function updateNewChatProfileOverflow() {
	const viewport = newChatProfileViewportEl;
	const content = newChatProfileContentEl;
	const body = newChatProfileBodyEl;
	if (!viewport || !content || !shouldShowNewChatProfile) {
		newChatProfileCanExpand = false;
		return;
	}
	const collapsedBodyOverflow = body
		? Math.max(0, body.scrollHeight - body.clientHeight)
		: 0;
	const naturalContentHeight = content.scrollHeight + collapsedBodyOverflow;
	const needsCollapse = naturalContentHeight > viewport.clientHeight + 2;
	newChatProfileCanExpand = needsCollapse;
	if (body) {
		const nonBodyHeight = content.scrollHeight - body.clientHeight;
		const expandControlReserve = needsCollapse ? 42 : 0;
		newChatProfileBodyMaxHeight = Math.max(
			112,
			viewport.clientHeight - nonBodyHeight - expandControlReserve - 4,
		);
	}
}
$effect(() => {
	const viewport = newChatProfileViewportEl;
	const content = newChatProfileContentEl;
	const body = newChatProfileBodyEl;
	if (!shouldShowNewChatProfile || !viewport || !content) return;
	void tick().then(updateNewChatProfileOverflow);
	const observer = new ResizeObserver(updateNewChatProfileOverflow);
	observer.observe(viewport);
	observer.observe(content);
	if (body) observer.observe(body);
	return () => observer.disconnect();
});
const sessionTaskNotices = $derived.by<SessionTaskNotice[]>(() => {
	if (!activeSessionId) return [];
	return [
		...Object.values(generationTaskRunById)
			.filter((run) => run.sessionId === activeSessionId)
			.map(toGenerationTaskNotice),
		...Object.values(backgroundBashTaskRunById)
			.filter((run) => run.sessionId === activeSessionId)
			.map(toBackgroundBashTaskNotice),
	]
		.filter((notice): notice is SessionTaskNotice => notice !== null)
		.sort((a, b) => taskRunSortTime(a) - taskRunSortTime(b));
});
const sessionTaskHasMore = $derived.by(() =>
	SESSION_TASK_TYPES.some(
		(taskType) => sessionTaskRecentHasMoreByType[taskType],
	),
);
$effect(() => {
	const sessionId = activeSessionId;
	if (!sessionId) {
		sessionTasks.backgroundBashHydrateKey = "";
		resetRecentSessionTaskPagination();
		return;
	}
	const hydrateKey = `${spaceId}:${sessionId}`;
	if (backgroundBashHydrateKey !== hydrateKey) {
		sessionTasks.backgroundBashHydrateKey = hydrateKey;
		resetRecentSessionTaskPagination();
		void restoreCachedTaskRuns(spaceId, sessionId)
			.then((runs) => {
				for (const run of runs) {
					if (isGenerationTaskRun(run)) upsertGenerationTaskRun(run);
					if (isBackgroundBashTaskRun(run)) upsertBackgroundBashTaskRun(run);
				}
			})
			.catch(() => undefined);
		void hydrateActiveSessionTasks(sessionId);
	}
});
const browserTabTitle = $derived.by(() => {
	const spaceTitle = normalizeTabTitleSegment(
		space?.name || space?.title || spaceId,
		"Space",
		36,
	);
	const spaceDescriptionTitle = space?.description?.trim()
		? normalizeTabTitleSegment(space.description, "", 64)
		: null;
	const routeTitle = (() => {
		if (routeView === "space") return null;
		if (routeView === "session") {
			if (isNewSessionRoute) return null;
			return activeSessionState?.session
				? normalizeTabTitleSegment(
						getSessionTitle(activeSessionState.session),
						"Chat",
					)
				: "Chat";
		}
		if (routeView === "file") {
			return normalizeTabTitleSegment(
				routeFilePath?.split("/").pop(),
				"File",
				44,
			);
		}
		if (routeView === "checkpoint") {
			return normalizeTabTitleSegment(
				checkpointDetail?.description?.trim() ||
					(routeCheckpointId ? `Save ${routeCheckpointId.slice(0, 8)}` : null),
				"Save",
			);
		}
		if (routeView === "checkpoint-new") return "New save";
		if (routeView === "cronjob") {
			return normalizeTabTitleSegment(cronjobDetail?.title, "Cronjob");
		}
		if (routeView === "cronjob-new") return "New cronjob";
		if (routeView === "work")
			return normalizeTabTitleSegment(workDetail?.slug, "Work");
		if (routeView === "task") return "Task";
		return null;
	})();
	if (routeTitle) return `${routeTitle} · ${spaceTitle} — Cohub`;
	return spaceDescriptionTitle
		? `${spaceTitle} · ${spaceDescriptionTitle} — Cohub`
		: `${spaceTitle} — Cohub`;
});
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
const bootstrapErrorCode = $derived.by<string | null>(() => {
	const value = bootstrapMeta?.errorCode;
	return typeof value === "string" && value.trim().length > 0 ? value : null;
});
const bootstrapNeedsBillingAction = $derived(
	isBillingAccessBlockedCode(bootstrapErrorCode),
);
const canCreateSession = $derived(Boolean(space && !creatingSession));
const firstCatalogModel = $derived(
	visibleModelsCatalog && visibleModelsCatalog.length > 0
		? {
				provider: visibleModelsCatalog[0].provider,
				id: visibleModelsCatalog[0].id,
				name: visibleModelsCatalog[0].model.name as string | undefined,
			}
		: null,
);
const TERMINAL_GENERATION_STATUSES = new Set([
	"idle",
	"completed",
	"failed",
	"interrupted",
]);
const activeTurnIndex = $derived.by(() =>
	activeSessionId ? (turnIndexBySessionId[activeSessionId] ?? []) : [],
);
const activeSessionLastTurnModel = $derived.by(() => {
	const turns = [...(activeSessionState?.turns ?? []), ...activeTurnIndex]
		.filter((turn) => typeof turn.model === "string" && turn.model.trim())
		.sort((a, b) => a.sequence - b.sequence);
	const lastTurn = turns.at(-1);
	if (!lastTurn?.model) return null;
	const provider = lastTurn.provider ?? "cohub";
	const catalogItem = visibleModelsCatalog?.find(
		(item) => item.id === lastTurn.model && item.provider === provider,
	);
	if (!provider) return null;
	return {
		provider,
		id: lastTurn.model,
		name: catalogItem?.model.name as string | undefined,
	} satisfies SelectedModel;
});
const activeSessionModel = $derived.by(() => {
	if (!activeSessionId) return draftSessionModel ?? firstCatalogModel;
	return (
		sessionModelById[activeSessionId] ??
		activeSessionLastTurnModel ??
		firstCatalogModel
	);
});
const activeGenerationState = $derived.by(() =>
	sessionGenerationStore.get(activeSessionId),
);
const activeTurnRailItems = $derived.by<SessionTurnIndexItem[]>(() => {
	const bySequence = new Map<number, SessionTurnIndexItem>();
	for (const item of activeTurnIndex) bySequence.set(item.sequence, item);
	for (const turn of activeSessionState?.turns ?? []) {
		const item = turnToIndexItem(turn);
		bySequence.set(turn.sequence, {
			...bySequence.get(turn.sequence),
			...item,
		});
	}
	return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
});
const loadedTurnSequences = $derived.by(() =>
	(activeSessionState?.turns ?? [])
		.map((turn) => turn.sequence)
		.sort((a, b) => a - b),
);
const loadedMinTurnSequence = $derived(loadedTurnSequences.at(0) ?? null);
const loadedMaxTurnSequence = $derived(loadedTurnSequences.at(-1) ?? null);
const unloadedOlderTurnCount = $derived.by(() => {
	if (loadedMinTurnSequence == null) return 0;
	return activeTurnIndex.filter((turn) => turn.sequence < loadedMinTurnSequence)
		.length;
});
const unloadedNewerTurnCount = $derived.by(() => {
	if (loadedMaxTurnSequence == null) return 0;
	return activeTurnIndex.filter((turn) => turn.sequence > loadedMaxTurnSequence)
		.length;
});
const activeStreamingIntermediateMessages = $derived.by(() => {
	if (!activeGenerationState || !activeSessionId) return [];
	return buildStreamingStoredIntermediateMessages({
		spaceId,
		sessionId: activeSessionId,
		turnId: activeGenerationState.turnId,
		intermediateMessages: activeGenerationState.intermediateMessages,
	});
});
const activeGenerationClientMessageId = $derived.by(() => {
	const turnId = activeGenerationState?.turnId;
	if (!turnId) return null;
	return getTurnClientMessageId(
		activeSessionState?.turns.find((turn) => turn.id === turnId) ??
			activeSessionState?.turns.find(
				(turn) => getTurnClientMessageId(turn) === turnId,
			) ?? { meta: null },
	);
});
const activeStreamError = $derived.by(() => activeGenerationState?.error ?? "");
const activeStreamErrorCode = $derived.by(
	() => activeGenerationState?.errorCode ?? null,
);
const composerNotice = $derived.by(() => activeStreamError || composerError);
const composerShowsBillingAction = $derived(
	isBillingAccessBlockedCode(activeStreamErrorCode) ||
		isBillingAccessBlockedCode(composerErrorCode),
);
const activeSessionIsRunning = $derived.by(() =>
	Boolean(
		activeGenerationState &&
			!TERMINAL_GENERATION_STATUSES.has(activeGenerationState.status),
	),
);
const timeline = $derived.by<TimelineItem[]>(() => {
	const state = activeSessionState;
	if (!state) return [];
	return buildTurnTimelineItems({
		sessionId: activeSessionId,
		turns: state.turns,
		streaming:
			activeGenerationState &&
			(activeGenerationState.status === "streaming" ||
				activeGenerationState.status === "pending" ||
				!TERMINAL_GENERATION_STATUSES.has(activeGenerationState.status))
				? {
						sessionId: activeSessionId ?? "active",
						turnId: activeGenerationState.turnId ?? null,
						anchorUserMessageId:
							activeGenerationState.anchorUserMessageId ?? null,
						clientMessageId: activeGenerationClientMessageId,
						intermediateMessages: activeStreamingIntermediateMessages,
						contentBlocks: activeGenerationState.contentBlocks,
						finalizedPreview: activeGenerationState.finalizedPreview,
						status: activeGenerationState.status,
						runtimePhase: activeGenerationState.runtimePhase,
						runtimeProvider: activeGenerationState.runtimeProvider,
						runtimeModel: activeGenerationState.runtimeModel,
					}
				: null,
	});
});
function preferFollowupQueueTurn(
	current: SessionTurnRecord,
	incoming: SessionTurnRecord,
) {
	if (isOptimisticTurn(current) && !isOptimisticTurn(incoming)) return incoming;
	if (!isOptimisticTurn(current) && isOptimisticTurn(incoming)) return current;
	return Date.parse(incoming.updatedAt) >= Date.parse(current.updatedAt)
		? incoming
		: current;
}

function dedupeFollowupQueueTurns(turns: SessionTurnRecord[]) {
	const byKey = new Map<string, SessionTurnRecord>();
	for (const turn of turns) {
		const clientMessageId = getTurnClientMessageId(turn);
		const key = clientMessageId
			? `client:${clientMessageId}`
			: `turn:${turn.id}`;
		const current = byKey.get(key);
		byKey.set(key, current ? preferFollowupQueueTurn(current, turn) : turn);
	}
	return [...byKey.values()].sort(
		(a, b) => a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt),
	);
}

const followupQueue = $derived.by(() =>
	dedupeFollowupQueueTurns(
		(activeSessionState?.turns ?? []).filter(
			(turn) =>
				turn.status === "queued" &&
				turn.intent === "followup" &&
				turn.id !== activeGenerationState?.turnId,
		),
	),
);

function turnPreviewText(turn: SessionTurnRecord) {
	return (turn.userText ?? "").replace(/\s+/g, " ").trim() || "Follow-up";
}

function removeQueuedFollowupDuplicates(
	turns: SessionTurnRecord[],
	resolvedTurn: SessionTurnRecord,
) {
	const clientMessageId = getTurnClientMessageId(resolvedTurn);
	if (!clientMessageId)
		return turns.filter((turn) => turn.id !== resolvedTurn.id);
	return turns.filter((turn) => {
		if (turn.id === resolvedTurn.id) return false;
		return !(
			turn.status === "queued" &&
			turn.intent === "followup" &&
			getTurnClientMessageId(turn) === clientMessageId
		);
	});
}

async function refreshSessionAfterStaleFollowupAction(sessionId: string) {
	clearComposerError();
	await syncSessionNewer(sessionId, null).catch(() => undefined);
}

async function handleSteerFollowup(turnId: string) {
	if (!activeSessionId || !space || pendingFollowupActionIds.has(turnId))
		return;
	const sessionId = activeSessionId;
	sessionTasks.addPendingFollowupAction(turnId);
	clearComposerError();
	try {
		const result = await sdk
			.space(spaceId)
			.session(sessionId)
			.steerTurn(turnId);
		const current = sessionStateById[sessionId];
		if (current) {
			sessionWorkspace.sessionStateById = {
				...sessionStateById,
				[sessionId]: {
					...current,
					turns: mergeTurnsById(
						removeQueuedFollowupDuplicates(current.turns, result.turn),
						result.affectedTurns,
						{ preferIncoming: true },
					),
				},
			};
		}
		startGenerationRequest(sessionId, {
			spaceId,
			turnId: result.turn.id,
		});
	} catch (error) {
		if (error instanceof HttpError && error.status === 409) {
			await refreshSessionAfterStaleFollowupAction(sessionId);
			return;
		}
		setComposerError(
			error instanceof Error ? error.message : "Failed to steer follow-up",
		);
	} finally {
		sessionTasks.removePendingFollowupAction(turnId);
	}
}

async function handleCancelFollowup(turnId: string) {
	if (!activeSessionId || !space || pendingFollowupActionIds.has(turnId))
		return;
	const sessionId = activeSessionId;
	sessionTasks.addPendingFollowupAction(turnId);
	clearComposerError();
	try {
		const result = await sdk
			.space(spaceId)
			.session(sessionId)
			.cancelTurn(turnId);
		const current = sessionStateById[sessionId];
		if (current) {
			sessionWorkspace.sessionStateById = {
				...sessionStateById,
				[sessionId]: {
					...current,
					turns: mergeTurnsById(
						removeQueuedFollowupDuplicates(current.turns, result.turn),
						[result.turn],
						{ preferIncoming: true },
					),
				},
			};
		}
	} catch (error) {
		if (error instanceof HttpError && error.status === 409) {
			await refreshSessionAfterStaleFollowupAction(sessionId);
			return;
		}
		setComposerError(
			error instanceof Error ? error.message : "Failed to cancel follow-up",
		);
	} finally {
		sessionTasks.removePendingFollowupAction(turnId);
	}
}

function turnToIndexItem(turn: SessionTurnRecord): SessionTurnIndexItem {
	return {
		id: turn.id,
		sessionId: turn.sessionId,
		sequence: turn.sequence,
		status: turn.status,
		startedAt: turn.startedAt,
		completedAt: turn.completedAt,
		durationMs: turn.durationMs,
		createdAt: turn.createdAt,
		updatedAt: turn.updatedAt,
		userPreview: turn.userText,
		assistantPreview: turn.assistantText,
		provider: turn.provider,
		model: turn.model,
		finalUsage: turn.finalUsage,
		totalUsage: turn.totalUsage,
		errorMessage: turn.errorMessage,
	};
}
function getSessionGenerationPolicyKey(sessionId: string) {
	return `cohub:generation-policy:${sessionId}`;
}
function serializeGenerationEnumSelections() {
	return Object.fromEntries(
		Object.entries(generationEnumSelections).map(([model, parameters]) => [
			model,
			Object.fromEntries(
				Object.entries(parameters).map(([parameter, values]) => [
					parameter,
					[...values],
				]),
			),
		]),
	);
}

function sanitizeGenerationNumericConstraints(
	value: unknown,
): Record<string, Record<string, { min?: number; max?: number }>> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).map(([model, parameters]) => [
			model,
			Object.fromEntries(
				Object.entries(
					parameters &&
						typeof parameters === "object" &&
						!Array.isArray(parameters)
						? parameters
						: {},
				).flatMap(([parameter, rawConstraint]) => {
					if (
						!rawConstraint ||
						typeof rawConstraint !== "object" ||
						Array.isArray(rawConstraint)
					)
						return [];
					const constraint = rawConstraint as { min?: unknown; max?: unknown };
					const next: { min?: number; max?: number } = {};
					if (
						typeof constraint.min === "number" &&
						Number.isFinite(constraint.min)
					)
						next.min = constraint.min;
					if (
						typeof constraint.max === "number" &&
						Number.isFinite(constraint.max)
					)
						next.max = constraint.max;
					return next.min === undefined && next.max === undefined
						? []
						: [[parameter, next]];
				}),
			),
		]),
	);
}

function sanitizeGenerationBooleanConstraints(
	value: unknown,
): Record<string, Record<string, { value?: boolean }>> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).map(([model, parameters]) => [
			model,
			Object.fromEntries(
				Object.entries(
					parameters &&
						typeof parameters === "object" &&
						!Array.isArray(parameters)
						? parameters
						: {},
				).flatMap(([parameter, rawConstraint]) => {
					if (
						!rawConstraint ||
						typeof rawConstraint !== "object" ||
						Array.isArray(rawConstraint)
					)
						return [];
					const value = (rawConstraint as { value?: unknown }).value;
					return typeof value === "boolean" ? [[parameter, { value }]] : [];
				}),
			),
		]),
	);
}

function loadSessionGenerationPolicy(
	sessionId: string,
): PersistedGenerationPolicy | null {
	try {
		const raw = localStorage.getItem(getSessionGenerationPolicyKey(sessionId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<PersistedGenerationPolicy>;
		return {
			mode: parsed.mode === "limited" ? "limited" : "auto",
			models: Array.isArray(parsed.models)
				? parsed.models.filter(
						(model): model is string => typeof model === "string",
					)
				: [],
			enumSelections: Object.fromEntries(
				Object.entries(parsed.enumSelections ?? {}).map(
					([model, parameters]) => [
						model,
						Object.fromEntries(
							Object.entries(parameters ?? {}).map(([parameter, values]) => [
								parameter,
								Array.isArray(values) ? values.map(String) : [],
							]),
						),
					],
				),
			),
			numericConstraints: sanitizeGenerationNumericConstraints(
				parsed.numericConstraints,
			),
			booleanConstraints: sanitizeGenerationBooleanConstraints(
				parsed.booleanConstraints,
			),
		};
	} catch {
		return null;
	}
}
function applySessionGenerationPolicy(
	policy: PersistedGenerationPolicy | null,
) {
	generationPolicyMode = policy?.mode ?? "auto";
	selectedGenerationModels = new Set(policy?.models ?? []);
	generationEnumSelections = Object.fromEntries(
		Object.entries(policy?.enumSelections ?? {}).map(([model, parameters]) => [
			model,
			Object.fromEntries(
				Object.entries(parameters).map(([parameter, values]) => [
					parameter,
					new Set(values),
				]),
			),
		]),
	);
	generationNumericConstraints = policy?.numericConstraints ?? {};
	generationBooleanConstraints = policy?.booleanConstraints ?? {};
}
function saveSessionGenerationPolicy(sessionId: string) {
	localStorage.setItem(
		getSessionGenerationPolicyKey(sessionId),
		JSON.stringify({
			mode: generationPolicyMode,
			models: [...selectedGenerationModels],
			enumSelections: serializeGenerationEnumSelections(),
			numericConstraints: generationNumericConstraints,
			booleanConstraints: generationBooleanConstraints,
		} satisfies PersistedGenerationPolicy),
	);
}
function persistActiveSessionGenerationPolicy() {
	if (!activeSessionId) return;
	saveSessionGenerationPolicy(activeSessionId);
}
function ensureSessionModelLoaded(sessionId: string) {
	if (Object.hasOwn(sessionModelById, sessionId)) return;
	sessionModelById = {
		...sessionModelById,
		[sessionId]: null,
	};
}
async function loadModelsCatalog() {
	try {
		await modelsCatalogStore.load();
	} catch (error) {
		console.error("Failed to load models catalog:", error);
	}
}
async function loadGenerationModelsCatalog() {
	if (generationModelsCatalog) return;
	try {
		const response = await sdk.models.listMultimodal();
		generationModelsCatalog = response.models;
	} catch (error) {
		console.error("Failed to load generation models catalog:", error);
	}
}
function buildTurnGenerationPolicy(): GenerationPolicy | null {
	if (generationPolicyMode !== "limited") return null;
	const models = [...selectedGenerationModels]
		.filter(
			(model) =>
				generationModelsCatalog?.some((item) => item.model === model) ?? true,
		)
		.map((model) => {
			const declaration = generationModelsCatalog?.find(
				(item) => item.model === model,
			);
			const parameterPolicies: Record<string, GenerationParameterConstraint> =
				{};
			for (const [name, selectedValues] of Object.entries(
				generationEnumSelections[model] ?? {},
			)) {
				const spec = declaration?.parameters?.[name];
				const enumValues =
					spec && "enum" in spec && Array.isArray(spec.enum) ? spec.enum : [];
				if (enumValues.length === 0 || selectedValues.size >= enumValues.length)
					continue;
				const allowed = enumValues.filter((value) =>
					selectedValues.has(String(value)),
				);
				if (allowed.length > 0)
					parameterPolicies[name] = {
						kind: "enum",
						values: allowed as Array<string | number | boolean>,
					};
			}
			for (const [name, constraint] of Object.entries(
				generationNumericConstraints[model] ?? {},
			)) {
				const spec = declaration?.parameters?.[name];
				const type = spec && "type" in spec ? spec.type : null;
				if (type !== "integer" && type !== "number") continue;
				const next: Extract<
					GenerationParameterConstraint,
					{ kind: "integer" | "number" }
				> = {
					kind: type === "integer" ? "integer" : "number",
				};
				if (constraint.min !== undefined) next.min = constraint.min;
				if (constraint.max !== undefined) next.max = constraint.max;
				if (next.min !== undefined || next.max !== undefined)
					parameterPolicies[name] = next;
			}
			for (const [name, constraint] of Object.entries(
				generationBooleanConstraints[model] ?? {},
			)) {
				const spec = declaration?.parameters?.[name];
				if (!spec || !("type" in spec) || spec.type !== "boolean") continue;
				if (constraint.value !== undefined)
					parameterPolicies[name] = {
						kind: "boolean",
						value: constraint.value,
					};
			}
			return Object.keys(parameterPolicies).length > 0
				? { model, parameters: parameterPolicies }
				: { model };
		});
	return models.length > 0 ? { version: 1, mode: "limited", models } : null;
}
function getDefaultGenerationEnumSelections(
	model: PublicGenerationDeclaration,
): Record<string, Set<string>> {
	const result: Record<string, Set<string>> = {};
	for (const [name, spec] of Object.entries(model.parameters ?? {})) {
		if ("enum" in spec && Array.isArray(spec.enum) && spec.enum.length > 0) {
			result[name] = new Set(spec.enum.map(String));
		}
	}
	return result;
}
function ensureGenerationModelEnumSelections(modelId: string) {
	const model = generationModelsCatalog?.find((item) => item.model === modelId);
	if (!model || generationEnumSelections[modelId]) return;
	generationEnumSelections = {
		...generationEnumSelections,
		[modelId]: getDefaultGenerationEnumSelections(model),
	};
}
function setGenerationPolicyMode(mode: "auto" | "limited") {
	generationPolicyMode = mode;
	persistActiveSessionGenerationPolicy();
}
function setGenerationModelSelected(modelId: string, selected: boolean) {
	if (generationPolicyMode !== "limited") generationPolicyMode = "limited";
	const nextModels = new Set(selectedGenerationModels);
	if (selected) {
		nextModels.add(modelId);
		ensureGenerationModelEnumSelections(modelId);
	} else {
		nextModels.delete(modelId);
		const { [modelId]: _removedEnum, ...restEnum } = generationEnumSelections;
		generationEnumSelections = restEnum;
		const { [modelId]: _removedNumeric, ...restNumeric } =
			generationNumericConstraints;
		generationNumericConstraints = restNumeric;
		const { [modelId]: _removedBoolean, ...restBoolean } =
			generationBooleanConstraints;
		generationBooleanConstraints = restBoolean;
	}
	selectedGenerationModels = nextModels;
	persistActiveSessionGenerationPolicy();
}
function ensureGenerationModelSelectedForPolicy(modelId: string) {
	if (generationPolicyMode !== "limited") generationPolicyMode = "limited";
	if (!selectedGenerationModels.has(modelId)) {
		selectedGenerationModels = new Set([...selectedGenerationModels, modelId]);
	}
}

function setGenerationEnumValueSelected(
	modelId: string,
	parameter: string,
	value: string,
	selected: boolean,
) {
	const model = generationModelsCatalog?.find((item) => item.model === modelId);
	if (!model) return;
	const base =
		generationEnumSelections[modelId] ??
		getDefaultGenerationEnumSelections(model);
	const nextValues = new Set(base[parameter] ?? []);
	if (selected) nextValues.add(value);
	else nextValues.delete(value);
	generationEnumSelections = {
		...generationEnumSelections,
		[modelId]: {
			...base,
			[parameter]: nextValues,
		},
	};
	ensureGenerationModelSelectedForPolicy(modelId);
	persistActiveSessionGenerationPolicy();
}

function setGenerationNumericConstraint(
	modelId: string,
	parameter: string,
	constraint: { min?: number; max?: number },
) {
	const nextConstraint: { min?: number; max?: number } = {};
	if (constraint.min !== undefined && Number.isFinite(constraint.min))
		nextConstraint.min = constraint.min;
	if (constraint.max !== undefined && Number.isFinite(constraint.max))
		nextConstraint.max = constraint.max;
	generationNumericConstraints = {
		...generationNumericConstraints,
		[modelId]: {
			...(generationNumericConstraints[modelId] ?? {}),
			[parameter]: nextConstraint,
		},
	};
	ensureGenerationModelSelectedForPolicy(modelId);
	persistActiveSessionGenerationPolicy();
}

function setGenerationBooleanConstraint(
	modelId: string,
	parameter: string,
	constraint: { value?: boolean },
) {
	generationBooleanConstraints = {
		...generationBooleanConstraints,
		[modelId]: {
			...(generationBooleanConstraints[modelId] ?? {}),
			[parameter]:
				constraint.value === undefined ? {} : { value: constraint.value },
		},
	};
	ensureGenerationModelSelectedForPolicy(modelId);
	persistActiveSessionGenerationPolicy();
}
function restoreCachedPromptTemplates(targetSpaceId: string) {
	const cached = readCachedPromptTemplates(targetSpaceId);
	if (!cached) {
		promptTemplates = [];
		promptTemplatesLoaded = false;
		promptTemplatesLoadedFor = null;
		return;
	}
	promptTemplates = cached;
	promptTemplatesLoaded = true;
	promptTemplatesLoadedFor = targetSpaceId;
}

async function refreshPromptTemplates(targetSpaceId: string) {
	if (
		promptTemplatesRefreshInFlight &&
		promptTemplatesRefreshInFlightFor === targetSpaceId
	) {
		return promptTemplatesRefreshInFlight;
	}
	const run = (async () => {
		try {
			const response = await sdk.prompts.list({ spaceId: targetSpaceId });
			writeCachedPromptTemplates(targetSpaceId, response.prompts);
			if (spaceId !== targetSpaceId) return;
			promptTemplates = response.prompts;
			promptTemplatesLoaded = true;
			promptTemplatesLoadedFor = targetSpaceId;
		} catch (error) {
			console.error("Failed to load prompt templates:", error);
		}
	})();
	const trackedRun = run.finally(() => {
		if (promptTemplatesRefreshInFlight === trackedRun) {
			promptTemplatesRefreshInFlight = null;
			promptTemplatesRefreshInFlightFor = null;
		}
	});
	promptTemplatesRefreshInFlight = trackedRun;
	promptTemplatesRefreshInFlightFor = targetSpaceId;
	return trackedRun;
}

async function loadPromptTemplates() {
	const targetSpaceId = spaceId;
	if (promptTemplatesLoadedFor !== targetSpaceId) {
		restoreCachedPromptTemplates(targetSpaceId);
	}
	await refreshPromptTemplates(targetSpaceId);
}
function handleModelSelect(model: { provider: string; id: string }) {
	const catalogItem = modelsCatalog?.find(
		(item) => item.provider === model.provider && item.id === model.id,
	);
	const selected = {
		provider: model.provider,
		id: model.id,
		name: catalogItem?.model.name as string | undefined,
	} satisfies SelectedModel;
	if (!activeSessionId) {
		draftSessionModel = selected;
		showModelSelector = false;
		focusComposerSoon();
		return;
	}
	sessionModelById = {
		...sessionModelById,
		[activeSessionId]: selected,
	};
	showModelSelector = false;
	focusComposerSoon();
}
function buildPreferredSessionRoute(sessionId: string) {
	return buildSpaceSessionRoute(spaceId, sessionId);
}
function navigateToSession(
	sessionId: string,
	options?: { replaceState?: boolean },
) {
	return goto(buildPreferredSessionRoute(sessionId), {
		replaceState: options?.replaceState ?? true,
		keepFocus: true,
		noScroll: true,
	});
}
function updateUrlSession(sessionId: string | null) {
	if (sessionId) {
		return navigateToSession(sessionId, { replaceState: true });
	}
	return goto(buildSpaceNewSessionRoute(spaceId), {
		replaceState: true,
		keepFocus: true,
		noScroll: true,
	});
}
function loadSessionScrollAnchors() {
	sessionScroll.loadSessionScrollAnchors(SESSION_SCROLL_ANCHOR_STORAGE_KEY);
}
function persistSessionScrollAnchorsNow() {
	sessionScroll.persistSessionScrollAnchorsNow(
		SESSION_SCROLL_ANCHOR_STORAGE_KEY,
	);
}
function setSessionScrollAnchor(
	sessionId: string,
	anchor: SessionScrollAnchor,
) {
	sessionScroll.setSessionScrollAnchor(
		SESSION_SCROLL_ANCHOR_STORAGE_KEY,
		sessionId,
		anchor,
	);
}
function getSessionScrollAnchor(sessionId: string) {
	return sessionScroll.getSessionScrollAnchor(sessionId);
}
function clearSessionScrollAnchor(sessionId: string) {
	sessionScroll.clearSessionScrollAnchor(
		SESSION_SCROLL_ANCHOR_STORAGE_KEY,
		sessionId,
	);
}
function getMessageElementAbsoluteTop(node: HTMLElement) {
	return sessionScroll.getMessageElementAbsoluteTop(node);
}
function updateTimelineScrollMetrics() {
	sessionScroll.updateTimelineScrollMetrics();
}
function measureTurnMarkerPositions() {
	sessionScroll.measureTurnMarkerPositions(TURN_SCROLL_ANCHOR_OFFSET);
}
function scheduleTurnMarkerMeasure() {
	if (turnMarkerMeasureFrame != null) return;
	turnMarkerMeasureFrame = requestAnimationFrame(() => {
		turnMarkerMeasureFrame = null;
		measureTurnMarkerPositions();
	});
}
function isGenerationInProgress(sessionId: string) {
	const status = sessionGenerationStore.get(sessionId)?.status;
	return Boolean(status && !TERMINAL_GENERATION_STATUSES.has(status));
}
function markVisibleLatestTurnViewed(
	sessionId: string,
	nodes: HTMLElement[],
	containerRect: DOMRect,
) {
	const state = sessionStateById[sessionId];
	if (!state?.session) return;
	const latestTurn =
		state.turns.findLast(
			(turn) => turn.status !== "running" && turn.status !== "abort_requested",
		) ?? null;
	if (!latestTurn) return;
	const latestVisibleTurnSequence = nodes.reduce((latest, node) => {
		const rect = node.getBoundingClientRect();
		if (rect.bottom <= containerRect.top + 8) return latest;
		if (rect.top >= containerRect.bottom - 8) return latest;
		const sequence = Number(node.dataset.turnSequence);
		return Number.isFinite(sequence) ? Math.max(latest, sequence) : latest;
	}, -Infinity);
	if (latestVisibleTurnSequence >= latestTurn.sequence) {
		unreadTracker.markViewed(sessionId, state.session.lastMessageId);
	}
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
	markVisibleLatestTurnViewed(sessionId, nodes, containerRect);
	updateCurrentTurnSequence();
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
	const state = sessionStateById[sessionId];
	unreadTracker.markViewed(sessionId, state?.session?.lastMessageId ?? null);
}
function updateRootFsEntries(entries: SpaceFsEntry[]) {
	fileWorkspace.updateRootFsEntries(entries);
}
function setActiveFileTree(nodes: SpaceFsNode[]) {
	fileWorkspace.setActiveFileTree(nodes);
}
function listActiveFsDir(path: string) {
	return fileWorkspace.listActiveFsDir(path);
}
function readActiveFsFile(path: string) {
	return fileWorkspace.readActiveFsFile(path);
}
async function patchFsDirectory(
	dirPath: string,
	updater: (entries: SpaceFsEntry[]) => SpaceFsEntry[],
) {
	return fileWorkspace.patchFsDirectory(dirPath, updater);
}
function upsertSessionRecord(
	session: SessionRecord,
	options?: { cache?: boolean },
) {
	const nextSessions = sessionWorkspace.upsertSessionRecord(session, options);
	if (options?.cache !== false) {
		void patchCachedSessionList(spaceId, () => nextSessions).catch(
			() => undefined,
		);
	}
}
function applySessionRealtimeRecord(session: SessionRecord) {
	upsertSessionRecord(session);
}
function applySessionsSnapshot(sessions: SessionRecord[]) {
	sessionWorkspace.applySessionsSnapshot(sessions);
}
function seedSessions(sessions: SessionRecord[]) {
	sessionWorkspace.seedSessions(sessions);
}
async function syncForkResponseToSessionListCache(
	session: SessionRecord,
	fork: SessionListForkRecord | null | undefined,
	parentSession?: SessionRecord | null,
) {
	const snapshot = await getCachedSessionListSnapshot(spaceId).catch(
		() => null,
	);
	const forkByChildId = new Map(
		(snapshot?.forks ?? []).map((item) => [item.childSessionId, item]),
	);
	if (fork?.childSessionId) forkByChildId.set(fork.childSessionId, fork);
	await patchCachedSessionList(
		spaceId,
		(current) => {
			const base =
				current.length > 0 ? current : parentSession ? [parentSession] : [];
			return [session, ...base.filter((item) => item.id !== session.id)];
		},
		undefined,
		Array.from(forkByChildId.values()),
	);
}
async function refreshSessionsList(force = true) {
	if (refreshSessionsListInFlight) {
		refreshSessionsListQueued = true;
		refreshSessionsListQueuedForce ||= force;
		return refreshSessionsListInFlight;
	}
	const run = (async () => {
		try {
			const sessions = await fetchSessionListWithCache(
				spaceId,
				async () => {
					const result = await sdk.space(spaceId).sessions.list({
						includeForks: true,
					});
					return {
						sessions: result.sessions ?? [],
						forks: result.forks,
						pageInfo: result.pageInfo,
					};
				},
				{ force },
			);
			applySessionsSnapshot(sessions);
		} catch (error) {
			console.warn("[space] Failed to refresh sessions:", error);
		}
	})();
	refreshSessionsListInFlight = run.finally(() => {
		refreshSessionsListInFlight = null;
		if (refreshSessionsListQueued) {
			const rerunForce = refreshSessionsListQueuedForce;
			refreshSessionsListQueued = false;
			refreshSessionsListQueuedForce = false;
			void refreshSessionsList(rerunForce);
		}
	});
	return refreshSessionsListInFlight;
}
function prepareRouteSession(sessionId: string) {
	sessionWorkspace.prepareRouteSession(sessionId);
	sessionScroll.pendingRestoreSessionId = sessionId;
	sessionScroll.activeAnchorRestore = null;
	sessionScroll.anchorRestoreWaitingForMarkdown = false;
	userScrollActive = false;
	programmaticScrollActive = false;
	currentTurnSequence = null;
	showTurnBottomSheet = false;
	ensureSessionModelLoaded(sessionId);
	applySessionGenerationPolicy(loadSessionGenerationPolicy(sessionId));
	sessionScroll.shouldAutoFollow = true;
}
async function loadPreviewEndpoints() {
	await portPreview.loadEndpoints();
}

function closePortReadyToast() {
	portPreview.closeReadyToast();
}

function previewPortFromToast() {
	portPreview.previewFromToast();
}

function applyPortsChanged(payload: ChannelEnvelope) {
	portPreview.applyPortsChanged(payload);
}

function loadSpace() {
	return spaceStatus.loadSpace();
}
function loadSpaceMembers(currentSpaceId = spaceId) {
	return spaceStatus.loadMembers(currentSpaceId);
}
function loadSpaceUsage(currentSpaceId = spaceId) {
	return spaceStatus.loadUsage(currentSpaceId);
}
function loadSpaceSandbox(currentSpaceId = spaceId) {
	return spaceStatus.loadSandbox(currentSpaceId);
}

function withBootstrapCacheTimeout<T>(promise: Promise<T>): Promise<T | null> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return Promise.race([
		promise.catch(() => null),
		new Promise<null>((resolve) => {
			timer = setTimeout(resolve, LOCAL_BOOTSTRAP_CACHE_TIMEOUT_MS, null);
		}),
	]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

function scheduleStatusRefresh() {
	spaceStatus.scheduleRefresh();
}
function spaceRoleRank(role: SpaceMember["role"]): number {
	if (role === "host") return 0;
	if (role === "builder") return 1;
	return 2;
}
function sortedSpaceMembersForProfile(): SpaceMember[] {
	return spaceMembers
		.filter((member) => member.userId !== space?.userUuid)
		.sort((a, b) => {
			const roleDiff = spaceRoleRank(a.role) - spaceRoleRank(b.role);
			if (roleDiff !== 0) return roleDiff;
			return displayUserName(a.profile, a.userId).localeCompare(
				displayUserName(b.profile, b.userId),
			);
		});
}
function userTitle(
	profile: UserProfile | null | undefined,
	userUuid: string | null | undefined,
): string {
	return [displayUserName(profile, userUuid), userUuid]
		.filter(Boolean)
		.join(" · ");
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

// ── Session rename (header inline edit) ────────────────────────────────
function startSessionRename() {
	const session = activeSessionState?.session;
	if (!session) return;
	sessionRenaming = true;
	sessionRenameValue = session.title ?? getSessionTitle(session);
	void tick().then(() => {
		sessionRenameInputEl?.focus();
		sessionRenameInputEl?.select();
	});
}
function cancelSessionRename() {
	sessionRenaming = false;
	sessionRenameValue = "";
}
async function submitSessionRename() {
	if (sessionRenameSaving || !activeSessionId) return;
	const trimmed = sessionRenameValue.trim();
	if (!trimmed) {
		cancelSessionRename();
		return;
	}
	const session = activeSessionState?.session;
	if (!session) return;
	if (trimmed === (session.title ?? getSessionTitle(session))) {
		cancelSessionRename();
		return;
	}
	sessionRenameSaving = true;
	try {
		const result = await sdk
			.space(spaceId)
			.session(activeSessionId)
			.rename(trimmed);
		sessionWorkspace.spaceSessions = spaceSessions.map((session) =>
			session.id === activeSessionId ? result.session : session,
		);
		void patchCachedSessionList(spaceId, (current) =>
			current.map((s) => (s.id === activeSessionId ? result.session : s)),
		).catch(() => undefined);
		if (sessionStateById[activeSessionId]) {
			sessionWorkspace.sessionStateById = {
				...sessionStateById,
				[activeSessionId]: {
					...sessionStateById[activeSessionId],
					session: result.session,
				},
			};
		}
	} catch {
		// Silently fail
	} finally {
		sessionRenameSaving = false;
		cancelSessionRename();
	}
}
async function syncGenerationStateFromTail(
	sessionId: string,
	turns: SessionTurnRecord[],
	requestStartedAt: number,
) {
	const runningTurn = turns.findLast(
		(turn) => turn.status === "running" || turn.status === "abort_requested",
	);
	if (runningTurn) {
		const current = sessionGenerationStore.get(sessionId);
		const optimisticTurn = turns.find(
			(turn) =>
				turn.meta?.optimistic === true &&
				getTurnClientMessageId(turn) === getTurnClientMessageId(runningTurn),
		);
		if (optimisticTurn?.id && optimisticTurn.id !== runningTurn.id) {
			return;
		}
		// The HTTP API response may lag behind WebSocket events. Two guards:
		//
		// 1. If the generation already reached a terminal state for the same
		//    turn, the API data is stale — skip to avoid re-activating.
		//
		// 2. If the generation is actively streaming for the same turn and
		//    the API request was sent BEFORE the last streaming event arrived,
		//    the API data is likely stale (the server may not have persisted
		//    the completed status yet). Skip to avoid replacing
		//    streaming-accumulated content with a stale snapshot, which would
		//    reset the StreamingMarkdownController and cause a re-stream.
		const isSameTurn = current?.turnId === runningTurn.id;
		const alreadyTerminalForTurn =
			current && TERMINAL_GENERATION_STATUSES.has(current.status) && isSameTurn;
		const staleApiForActiveStream =
			current &&
			isSameTurn &&
			(current.status === "streaming" || current.status === "pending") &&
			(current.lastEventAt ?? 0) > requestStartedAt;
		if (alreadyTerminalForTurn || staleApiForActiveStream) {
			return;
		}
		const anchorUserMessageId =
			typeof runningTurn.meta?.userMessageId === "string"
				? runningTurn.meta.userMessageId
				: runningTurn.id;
		sessionGenerationStore.resumePending(sessionId, {
			spaceId,
			turnId: runningTurn.id,
			anchorUserMessageId,
		});
		const state = sessionStateById[sessionId];
		if (!state?.turns.some((turn) => turn.id === runningTurn.id)) {
			await hydrateTurnOnce({
				sessionId,
				turnId: runningTurn.id,
				reason: "running-recovery",
			});
		}
		await restoreSessionStreamSnapshot(sessionId, { turnId: runningTurn.id });
		return;
	}
	const current = sessionGenerationStore.get(sessionId);
	if (
		current &&
		!TERMINAL_GENERATION_STATUSES.has(current.status) &&
		(current.lastEventAt ?? 0) <= requestStartedAt
	) {
		resetGeneration(sessionId);
	}
}
async function loadSessionState(sessionId: string, force = false) {
	const existing = sessionStateById[sessionId];
	const inFlight = sessionLoadInFlight.get(sessionId);
	if (inFlight && !force) return inFlight;
	if (existing?.loaded && !force) return;
	const run = (async () => {
		const cached = !force
			? await sessionTurnsRepo.getCached(spaceId, sessionId)
			: null;
		if (cached && (cached.turns.length > 0 || cached.session)) {
			sessionWorkspace.sessionStateById = {
				...sessionStateById,
				[sessionId]: {
					session:
						cached.session ??
						existing?.session ??
						spaceSessions.find((s) => s.id === sessionId),
					turns: cached.turns,
					loading: true,
					loaded: true,
					error: "",
					hasMore: cached.hasMoreOlder,
					hasMoreNewer: cached.hasMoreNewer,
					loadingOlder: false,
					loadingNewer: false,
					oldestCursor: cached.oldestSequence ?? undefined,
				},
			};
		}
		sessionWorkspace.loadingSessionIds = {
			...loadingSessionIds,
			[sessionId]: true,
		};
		sessionWorkspace.visibleInitialLoadingSessionIds = {
			...visibleInitialLoadingSessionIds,
			[sessionId]: false,
		};
		const loadSpaceId = spaceId;
		const loadingTimer = setTimeout(() => {
			if (spaceId !== loadSpaceId) return;
			if (sessionStateById[sessionId]?.loaded) return;
			sessionWorkspace.visibleInitialLoadingSessionIds = {
				...visibleInitialLoadingSessionIds,
				[sessionId]: true,
			};
		}, SESSION_INITIAL_LOADING_DELAY_MS);
		const currentSeed = sessionStateById[sessionId];
		sessionWorkspace.sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				session:
					currentSeed?.session ??
					existing?.session ??
					spaceSessions.find((s) => s.id === sessionId),
				turns: currentSeed?.turns ?? existing?.turns ?? [],
				loading: true,
				loaded: currentSeed?.loaded ?? existing?.loaded ?? false,
				error: currentSeed?.error ?? existing?.error ?? "",
				hasMore: currentSeed?.hasMore ?? existing?.hasMore ?? true,
				hasMoreNewer:
					currentSeed?.hasMoreNewer ?? existing?.hasMoreNewer ?? false,
				loadingOlder: false,
				loadingNewer: false,
				oldestCursor: currentSeed?.oldestCursor ?? existing?.oldestCursor,
			},
		};
		try {
			const requestStartedAt = Date.now();
			const response = await sdk
				.space(spaceId)
				.session(sessionId)
				.turns.listPaginated({
					limit: 30,
				});
			await syncGenerationStateFromTail(
				sessionId,
				response.turns,
				requestStartedAt,
			);
			const snapshot = await sessionTurnsRepo.replaceTail(spaceId, sessionId, {
				session: response.session,
				turns: response.turns,
				hasMore: response.hasMore,
			});
			upsertSessionRecord(response.session);
			sessionWorkspace.sessionStateById = {
				...sessionStateById,
				[sessionId]: {
					session: snapshot.session ?? response.session,
					turns: snapshot.turns,
					loading: false,
					loaded: true,
					error: "",
					hasMore: snapshot.hasMoreOlder,
					hasMoreNewer: snapshot.hasMoreNewer,
					loadingOlder: false,
					loadingNewer: false,
					oldestCursor: snapshot.oldestSequence ?? undefined,
				},
			};
		} catch (error) {
			const fallback = sessionStateById[sessionId];
			sessionWorkspace.sessionStateById = {
				...sessionStateById,
				[sessionId]: {
					session:
						fallback?.session ??
						existing?.session ??
						spaceSessions.find((s) => s.id === sessionId),
					turns: fallback?.turns ?? existing?.turns ?? [],
					loading: false,
					loaded: Boolean(fallback?.loaded ?? existing?.loaded),
					error:
						error instanceof Error ? error.message : "Failed to load session",
					hasMore: fallback?.hasMore ?? existing?.hasMore ?? true,
					hasMoreNewer:
						fallback?.hasMoreNewer ?? existing?.hasMoreNewer ?? false,
					loadingOlder: false,
					loadingNewer: false,
					oldestCursor: fallback?.oldestCursor ?? existing?.oldestCursor,
				},
			};
		} finally {
			clearTimeout(loadingTimer);
			const nextVisibleLoading = { ...visibleInitialLoadingSessionIds };
			delete nextVisibleLoading[sessionId];
			sessionWorkspace.visibleInitialLoadingSessionIds = nextVisibleLoading;
			sessionWorkspace.loadingSessionIds = {
				...loadingSessionIds,
				[sessionId]: false,
			};
		}
	})();
	sessionLoadInFlight.set(sessionId, run);
	return run.finally(() => {
		if (sessionLoadInFlight.get(sessionId) === run) {
			sessionLoadInFlight.delete(sessionId);
		}
	});
}
async function loadTurnIndex(sessionId: string, force = false) {
	await sessionTurnLoading.loadTurnIndex(sessionId, force);
}
function getTurnAnchorNode(sequence: number) {
	return (
		listEl?.querySelector<HTMLElement>(
			`[data-turn-anchor="user"][data-turn-sequence="${sequence}"]`,
		) ?? null
	);
}
function snapScrollToNearestTurn(threshold = 32) {
	if (!listEl) return false;
	const anchors = Array.from(
		listEl.querySelectorAll<HTMLElement>('[data-turn-anchor="user"]'),
	);
	let nearest: { sequence: number; distance: number } | null = null;
	for (const anchor of anchors) {
		const sequence = Number(anchor.dataset.turnSequence);
		if (!Number.isFinite(sequence)) continue;
		const targetTop = Math.max(
			0,
			getMessageElementAbsoluteTop(anchor) - TURN_SCROLL_ANCHOR_OFFSET,
		);
		const distance = Math.abs(targetTop - listEl.scrollTop);
		if (!nearest || distance < nearest.distance) {
			nearest = { sequence, distance };
		}
	}
	if (!nearest || nearest.distance > threshold) return false;
	return scrollToTurnAnchor(nearest.sequence);
}
function scrollToTurnAnchor(sequence: number) {
	if (!listEl) return false;
	const node = getTurnAnchorNode(sequence);
	if (!node) return false;
	setProgrammaticScrollTop(
		Math.max(0, getMessageElementAbsoluteTop(node) - TURN_SCROLL_ANCHOR_OFFSET),
	);
	sessionScroll.shouldAutoFollow = false;
	currentTurnSequence = sequence;
	requestAnimationFrame(() => updateCurrentTurnSequence());
	highlightedTurnSequence = sequence;
	window.setTimeout(() => {
		if (highlightedTurnSequence === sequence) highlightedTurnSequence = null;
	}, 1400);
	return true;
}
async function ensureTurnWindowLoaded(sessionId: string, sequence: number) {
	const key = `${sessionId}:${sequence}`;
	const inFlight = sessionTurnLoading.getTurnWindowInFlight(key);
	if (inFlight) return inFlight;
	const run = (async () => {
		const state = sessionStateById[sessionId];
		if (state?.turns.some((turn) => turn.sequence === sequence)) return;
		if (state?.loaded && !state.loading && state.turns.length === 0) return;
		sessionTurnLoading.loadingTurnSequence = sequence;
		try {
			const response = await sdk
				.space(spaceId)
				.session(sessionId)
				.turns.window({
					sequence,
					before: 10,
					after: 20,
				});
			const current = sessionStateById[sessionId] ?? state;
			const mergedTurns = current
				? normalizeTurnDuplicates(
						mergeTurnsById(current.turns, response.turns, {
							preferIncoming: true,
						}),
					)
				: response.turns;
			void sessionTurnsRepo
				.mergeTurns(spaceId, sessionId, response.turns, {
					session: response.session,
					hasMoreOlder: response.hasMoreOlder,
					hasMoreNewer:
						"hasMoreNewer" in response ? response.hasMoreNewer : undefined,
					source: "network",
					trimAnchorSequence: sequence,
				})
				.catch(() => undefined);
			if (current) {
				sessionWorkspace.sessionStateById = {
					...sessionStateById,
					[sessionId]: {
						...current,
						session: response.session ?? current.session,
						turns: mergedTurns,
						hasMore: response.hasMoreOlder,
						hasMoreNewer:
							"hasMoreNewer" in response
								? response.hasMoreNewer
								: current.hasMoreNewer,
						oldestCursor: mergedTurns[0]?.sequence ?? undefined,
						loaded: true,
						loading: false,
					},
				};
			}
		} catch (error) {
			const current = sessionStateById[sessionId];
			if (
				error instanceof HttpError &&
				error.status === 404 &&
				!current?.turns.some((turn) => turn.sequence === sequence)
			) {
				return;
			}
			throw error;
		} finally {
			sessionTurnLoading.loadingTurnSequence = null;
		}
	})();
	sessionTurnLoading.setTurnWindowInFlight(key, run);
	return run.finally(() => {
		sessionTurnLoading.clearTurnWindowInFlight(key, run);
	});
}
async function jumpToTurn(sequence: number) {
	if (!activeSessionId) return;
	try {
		clearComposerError();
		if (scrollToTurnAnchor(sequence)) return;
		await ensureTurnWindowLoaded(activeSessionId, sequence);
		await tick();
		requestAnimationFrame(() => scrollToTurnAnchor(sequence));
	} catch (error) {
		console.warn("[jumpToTurn] Failed to jump to turn:", error);
		setComposerError(
			error instanceof Error ? error.message : "Failed to jump to turn",
		);
	}
}
async function jumpToTurnAndUpdateUrl(sequence: number) {
	if (!activeSessionId) return;
	try {
		appliedRouteTurnKey = `${activeSessionId}:${sequence}`;
		await goto(buildSpaceSessionTurnRoute(spaceId, activeSessionId, sequence), {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
		await jumpToTurn(sequence);
	} catch (error) {
		console.warn("[jumpToTurnAndUpdateUrl] Failed to jump to turn:", error);
		setComposerError(
			error instanceof Error ? error.message : "Failed to jump to turn",
		);
	}
}
async function syncSessionNewer(sessionId: string, _cached: unknown) {
	const inFlight = syncSessionNewerInFlight.get(sessionId);
	if (inFlight) return inFlight;
	const run = (async () => {
		const state = sessionStateById[sessionId];
		if (!state || state.turns.length === 0) return;
		const newestSeq = state.turns.at(-1)?.sequence;
		if (newestSeq == null) return;
		sessionWorkspace.sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				...state,
				loadingNewer: true,
			},
		};
		try {
			const response = await sdk
				.space(spaceId)
				.session(sessionId)
				.turns.listPaginated({
					cursor: newestSeq,
					direction: "newer",
					limit: 100,
				});
			if (response.turns.length > 0) {
				void sessionTurnsRepo
					.mergeTurns(spaceId, sessionId, response.turns, {
						session: response.session,
						source: "network",
					})
					.catch(() => undefined);
				const current = sessionStateById[sessionId];
				if (current) {
					const mergedTurns = normalizeTurnDuplicates(
						mergeTurnsById(current.turns, response.turns, {
							preferIncoming: true,
						}),
					);
					sessionWorkspace.sessionStateById = {
						...sessionStateById,
						[sessionId]: {
							...current,
							session: response.session ?? current.session,
							turns: mergedTurns,
						},
					};
				}
			}
		} catch (error) {
			console.warn("[syncSessionNewer] Failed to sync newer turns:", error);
		} finally {
			const current = sessionStateById[sessionId];
			if (current) {
				sessionWorkspace.sessionStateById = {
					...sessionStateById,
					[sessionId]: {
						...current,
						loadingNewer: false,
					},
				};
			}
		}
	})();
	syncSessionNewerInFlight.set(sessionId, run);
	return run.finally(() => {
		if (syncSessionNewerInFlight.get(sessionId) === run) {
			syncSessionNewerInFlight.delete(sessionId);
		}
	});
}
async function loadOlderTurns(sessionId: string) {
	const state = sessionStateById[sessionId];
	if (!state?.hasMore || state.loadingOlder) return;
	chatTimelineRef?.preparePrepend();
	sessionWorkspace.sessionStateById = {
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
			.turns.listPaginated({
				cursor: state.oldestCursor,
				direction: "older",
				limit: 30,
			});
		void sessionTurnsRepo
			.loadOlder(spaceId, sessionId, {
				session: response.session,
				turns: response.turns,
				hasMore: response.hasMore,
			})
			.catch(() => undefined);
		const current = sessionStateById[sessionId] ?? state;
		const mergedTurns = normalizeTurnDuplicates(
			mergeTurnsById(current.turns, response.turns, {
				preferIncoming: false,
			}),
		);
		sessionWorkspace.sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				...current,
				session: response.session ?? current.session,
				turns: mergedTurns,
				hasMore: response.hasMore,
				hasMoreNewer: current.hasMoreNewer,
				loadingOlder: false,
				loadingNewer: false,
				oldestCursor: mergedTurns[0]?.sequence ?? undefined,
			},
		};
		if (response.turns.length > 0) {
			await tick();
			chatTimelineRef?.finalizePrepend();
		}
	} catch (error) {
		sessionWorkspace.sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				...state,
				loadingOlder: false,
				error:
					error instanceof Error ? error.message : "Failed to load older turns",
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
		void loadOlderTurns(sessionId).finally(() =>
			preloadingSessionIds.delete(sessionId),
		);
	}
}
function restoreSessionStreamSnapshot(
	sessionId: string,
	options?: { turnId?: string | null; force?: boolean },
) {
	return generationRealtime.restoreSessionStreamSnapshot(sessionId, options);
}
function reconcileSessionTail(sessionId: string) {
	return generationRealtime.reconcileSessionTail(sessionId);
}
function clearPostSendRecovery(sessionId: string | null | undefined) {
	generationRealtime.clearPostSendRecovery(sessionId);
}
function clearAllPostSendRecovery() {
	generationRealtime.clearAllPostSendRecovery();
}
function schedulePostSendRecoveryCheck(sessionId: string) {
	generationRealtime.schedulePostSendRecoveryCheck(sessionId);
}
async function reconnectSync() {
	if (reconnectSyncInFlight) return reconnectSyncInFlight;
	const run = (async () => {
		await generationRealtime.reconcileAfterReconnect(
			activeSessionId && sessionStateById[activeSessionId]?.loaded
				? activeSessionId
				: null,
		);
		if (activeSessionId && sessionStateById[activeSessionId]?.loaded) {
			const activeState = sessionStateById[activeSessionId];
			const latestTurn =
				activeState?.turns.findLast(
					(turn) =>
						turn.status !== "running" && turn.status !== "abort_requested",
				) ?? activeState?.turns.at(-1);
			if (latestTurn && shouldAutoFollow) {
				unreadTracker.markViewed(
					activeSessionId,
					activeState?.session?.lastMessageId ?? null,
				);
			}
		}
	})();
	reconnectSyncInFlight = run.finally(() => {
		reconnectSyncInFlight = null;
	});
	return reconnectSyncInFlight;
}
function spaceStyleChanged(
	changes: Array<{ path?: string; oldPath?: string }> | undefined,
) {
	return changes?.some(
		(change) =>
			isSpaceStylePath(change.path) || isSpaceStylePath(change.oldPath),
	);
}
function spaceConfigChanged(
	changes: Array<{ path?: string; oldPath?: string }> | undefined,
) {
	return changes?.some(
		(change) =>
			isSpaceConfigPath(change.path) || isSpaceConfigPath(change.oldPath),
	);
}
async function handleSpaceFsChanged(payload: ChannelEnvelope) {
	const sourceKey = activeFsSourceKey;
	const shouldPatchVisibleTree = () =>
		activeFsSource.kind === "live" && activeFsSourceKey === sourceKey;
	const eventPayload = payload.payload as {
		source?: string;
		resync?: boolean;
		changes?: Array<{
			path?: string;
			oldPath?: string;
			kind?: string;
			nodeType?: string;
			mtimeMs?: number;
			size?: number;
		}>;
	};
	const shouldRefreshSpaceStyle =
		eventPayload.resync || spaceStyleChanged(eventPayload.changes);
	if (shouldRefreshSpaceStyle) refreshSpaceStyle(spaceId);
	const shouldRefreshSpaceConfig =
		eventPayload.resync || spaceConfigChanged(eventPayload.changes);
	if (shouldRefreshSpaceConfig) refreshSpaceConfig(spaceId);
	const { refreshDirs: dirsToRefresh } = await spaceFsRepo.applyFsChanged(
		spaceId,
		eventPayload as Parameters<typeof spaceFsRepo.applyFsChanged>[1],
	);
	for (const dir of dirsToRefresh) {
		const snapshot = await spaceFsRepo.getDir(spaceId, dir);
		if (!snapshot || !shouldPatchVisibleTree()) continue;
		if (dir === "") updateRootFsEntries(snapshot.entries);
		else
			setActiveFileTree(
				replaceNodeChildren(fileTree, dir, makeFsNodes(snapshot.entries)),
			);
	}
	if (!shouldPatchVisibleTree()) return;
	if (eventPayload.resync) {
		await loadFileTree(true);
		if (routeView === "file" && routeFilePath && !fileDirty) {
			await openFileFromUrl(routeFilePath).catch(() => undefined);
		}
		if (inlineFile?.path && !inlineFileDirty) {
			await openInlineFile(inlineFile.path).catch(() => undefined);
		}
		return;
	}
	for (const change of eventPayload.changes ?? []) {
		const isOwnPendingChange = fileWorkspace.isOwnPendingFileSave(
			change.path,
			eventPayload.source,
			change.kind,
		);
		if (
			openFile?.path &&
			(change.path === openFile.path || change.oldPath === openFile.path)
		) {
			if (isOwnPendingChange) {
				// The API save we just initiated broadcasts a file-change event before
				// the save response updates local content. Do not treat it as an
				// external edit conflict.
			} else if (change.kind === "delete") closeFile();
			else if (!fileDirty && change.path)
				await openFileFromUrl(change.path).catch(() => undefined);
			else if (fileDirty) fileWorkspace.markOpenFileExternalChange();
		}
		if (
			inlineFile?.path &&
			(change.path === inlineFile.path || change.oldPath === inlineFile.path)
		) {
			if (isOwnPendingChange) {
				// See open-file branch above: this is our own save echo, not an
				// external modification.
			} else if (change.kind === "delete") closeInlineFile();
			else if (!inlineFileDirty && change.path)
				await openInlineFile(change.path).catch(() => undefined);
			else if (inlineFileDirty) fileWorkspace.markInlineFileExternalChange();
		}
	}
	if (dirsToRefresh.has("")) await loadFileTree(true);
	if (!shouldPatchVisibleTree()) return;
	for (const dir of dirsToRefresh) {
		if (!dir) continue;
		const node = findFsNode(fileTree, dir);
		if (node?.isOpen) {
			if (!shouldPatchVisibleTree()) return;
			setActiveFileTree(
				updateNodeState(fileTree, dir, (item) => ({
					...item,
					isLoaded: false,
				})),
			);
			await expandDirectory({ ...node, isOpen: false, isLoaded: false });
		}
	}
}

function findFsNode(nodes: SpaceFsNode[], path: string): SpaceFsNode | null {
	for (const node of nodes) {
		if (node.path === path) return node;
		const child = findFsNode(node.children, path);
		if (child) return child;
	}
	return null;
}

function applyAcceptedTurnId(input: {
	sessionId: string;
	previousTurnId?: string | null;
	nextTurnId: string;
	confirmedTurn?: SessionTurnRecord | null;
}) {
	if (input.previousTurnId && input.previousTurnId !== input.nextTurnId) {
		replaceGenerationTurnId(input.sessionId, {
			previousTurnId: input.previousTurnId,
			nextTurnId: input.nextTurnId,
		});
		void sessionTurnsRepo.replaceTurnId(
			spaceId,
			input.sessionId,
			{
				previousTurnId: input.previousTurnId,
				nextTurnId: input.nextTurnId,
			},
			{ source: "indexeddb" },
		);
		const current = sessionStateById[input.sessionId];
		if (current) {
			const turns = current.turns.map((turn) => {
				if (turn.id !== input.previousTurnId) return turn;
				const meta = {
					...(turn.meta ?? {}),
					...(input.confirmedTurn?.meta ?? {}),
				};
				delete meta.optimistic;
				return {
					...turn,
					...(input.confirmedTurn ?? {}),
					id: input.nextTurnId,
					userUuid: input.confirmedTurn?.userUuid ?? turn.userUuid,
					authorProfile:
						input.confirmedTurn?.authorProfile ?? turn.authorProfile ?? null,
					provider: input.confirmedTurn?.provider ?? turn.provider,
					model: input.confirmedTurn?.model ?? turn.model,
					meta,
				};
			});
			sessionWorkspace.sessionStateById = {
				...sessionStateById,
				[input.sessionId]: {
					...current,
					turns: normalizeTurnDuplicates(turns),
				},
			};
		}
		return;
	}
	replaceGenerationTurnId(input.sessionId, { nextTurnId: input.nextTurnId });
}
function hydrateTurnOnce(input: {
	sessionId: string;
	turnId: string;
	reason: string;
	onHydrated?: () => void;
}) {
	const key = `${input.sessionId}:${input.turnId}`;
	const inFlight = turnHydrationInFlight.get(key);
	if (inFlight) return inFlight;
	const run = sdk
		.space(spaceId)
		.session(input.sessionId)
		.turns.get(input.turnId)
		.then(async (response) => {
			const current = sessionStateById[input.sessionId];
			if (!current) return;
			const snapshot = await sessionTurnsRepo.mergeTurns(
				spaceId,
				input.sessionId,
				[response.turn],
				{
					session: response.session ?? current.session ?? null,
					source: "network",
				},
			);
			sessionWorkspace.sessionStateById = {
				...sessionStateById,
				[input.sessionId]: {
					...current,
					session: snapshot.session ?? current.session,
					turns: snapshot.turns,
				},
			};
			input.onHydrated?.();
		})
		.catch((error) =>
			console.warn(`[${input.reason}] Failed to load full turn:`, error),
		);
	turnHydrationInFlight.set(key, run);
	return run.finally(() => {
		if (turnHydrationInFlight.get(key) === run) {
			turnHydrationInFlight.delete(key);
		}
	});
}
function handleTaskRealtimeEvent(payload: ChannelEnvelope) {
	const eventPayload = payload.payload as {
		task?: Partial<TaskRunRecord> & {
			id?: string;
			type?: string;
			userId?: string | null;
		};
		progress?: unknown;
		changed?: string[];
	};
	const task = eventPayload.task;
	if (!task?.id) return;
	const eventSpaceId = task.spaceId ?? payload.spaceId ?? spaceId;
	if (eventSpaceId !== spaceId) return;
	mergeCachedTaskRun(spaceId, task as Parameters<typeof mergeCachedTaskRun>[1]);
	const existingGenerationTaskRun = generationTaskRunById[task.id] ?? null;
	const mergedTaskRun = mergeTaskRunRecord(existingGenerationTaskRun, {
		...(task as Partial<TaskRunRecord>),
		id: task.id,
		type: task.type,
		userId: task.userId,
	});
	if (isGenerationTaskRun(mergedTaskRun))
		upsertGenerationTaskRun(mergedTaskRun);
	if (isBackgroundBashTaskRun(mergedTaskRun))
		upsertBackgroundBashTaskRun(mergedTaskRun);
	if (
		task.sessionId === activeSessionId &&
		(task.type === "run_command" || task.type === "generation")
	) {
		void hydrateTaskRun(task.id);
	}
	if (routeTaskId === task.id) {
		taskRunDetail = mergeTaskRunRecord(taskRunDetail, {
			...(task as Partial<TaskRunRecord>),
			id: task.id,
			type: task.type,
			userId: task.userId,
		});
	}
	if (payload.type === "task.updated") {
		if (
			eventPayload.changed?.includes("status") &&
			task.status === "completed"
		) {
		}
	}
}
async function handleWsEvent(payload: ChannelEnvelope) {
	try {
		if (payload.type === "space.fs.changed") {
			await handleSpaceFsChanged(payload);
			return;
		}
		if (payload.type === "space.ports.changed") {
			applyPortsChanged(payload);
			return;
		}
		if (payload.type === "task.created" || payload.type === "task.updated") {
			handleTaskRealtimeEvent(payload);
			return;
		}
		if (payload.type === "label.assignments.updated") {
			const snapshot = parseResourceLabelRealtimePayload({
				spaceId: payload.spaceId,
				payload: payload.payload,
			});
			if (snapshot?.spaceId === spaceId)
				await syncResourceLabelsToCache(snapshot);
			return;
		}
		if (
			payload.type === "session.created" ||
			payload.type === "session.updated"
		) {
			const session = payload.payload.session as SessionRecord | undefined;
			if (session?.id) applySessionRealtimeRecord(session);
			return;
		}
		const targetSessionId =
			typeof payload.sessionId === "string" ? payload.sessionId : null;
		if (!targetSessionId) return;
		if (typeof payload.spaceId === "string" && payload.spaceId !== spaceId) {
			return;
		}
		const currentActiveSessionId = activeSessionId;
		const isActiveSession = targetSessionId === currentActiveSessionId;
		if (payload.type === "session.request.accepted") {
			clearPostSendRecovery(targetSessionId);
			return;
		}
		if (payload.type === "session.request.error") {
			const requestError = payload.payload as {
				code?: string;
				message?: string;
				clientMessageId?: string | null;
			};
			const message = requestError.message?.trim() || "Message request failed";
			const code =
				typeof requestError.code === "string" ? requestError.code : null;
			if (isBillingAccessBlockedCode(code)) {
				billingConversion.openFromIntent({
					level: "hard",
					reason: "negative_balance_limit_exceeded",
					audience: "unknown",
					preferredOfferKind: "mixed",
					title: "Add credits to continue",
					message: "Add credits or choose a plan to resume AI requests.",
					primaryAction: {
						label: "Add credits now",
						action: "open_billing_conversion",
					},
					source: "session_request_error",
				});
			}
			failGeneration(targetSessionId, message, { errorCode: code });
			if (isActiveSession) setComposerError(message, code);
			clearPostSendRecovery(targetSessionId);
			return;
		}
		let state = sessionStateById[targetSessionId];
		if (!state) {
			if (payload.type === "session.turn.created") {
				void loadSessionState(targetSessionId);
			}
			if (payload.type === "session.turn.finalized") {
				const turnId =
					typeof (payload.payload.turn as { id?: unknown } | undefined)?.id ===
					"string"
						? (payload.payload.turn as { id: string }).id
						: null;
				completeGenerationForTurn(targetSessionId, turnId);
			}
			return;
		}
		if (payload.type === "session.turn.created") {
			const turn = payload.payload.turn as SessionTurnRecord | undefined;
			if (turn?.id) {
				const clientMessageId = getTurnClientMessageId(turn);
				const optimisticTurn = state.turns.find(
					(item) =>
						isOptimisticTurn(item) &&
						isSameClientMessageTurn(item, clientMessageId),
				);
				if (optimisticTurn?.id && optimisticTurn.id !== turn.id) {
					applyAcceptedTurnId({
						sessionId: targetSessionId,
						previousTurnId: optimisticTurn.id,
						nextTurnId: turn.id,
						confirmedTurn: turn,
					});
					state = sessionStateById[targetSessionId] ?? state;
				}
				const current = sessionStateById[targetSessionId] ?? state;
				const reconciled = reconcileOptimisticTurn(current.turns, turn);
				const snapshot = await sessionTurnsRepo.mergeTurns(
					spaceId,
					targetSessionId,
					[turn],
					{ session: current.session ?? null },
				);
				sessionWorkspace.sessionStateById = {
					...sessionStateById,
					[targetSessionId]: {
						...current,
						turns: normalizeTurnDuplicates(
							mergeTurnsById(reconciled.turns, snapshot.turns, {
								preferIncoming: true,
							}),
						),
					},
				};
			}
			return;
		}
		if (
			payload.type === "session.turn.finalized" ||
			payload.type === "session.turn.updated"
		) {
			const turnPatch = payload.payload.turn as
				| Partial<SessionTurnRecord>
				| undefined;
			const normalizedTurnPatch = turnPatch
				? {
						...turnPatch,
						finalUsage:
							turnPatch.finalUsage ??
							(turnPatch as { usage?: SessionTurnRecord["finalUsage"] })
								.usage ??
							null,
					}
				: undefined;
			const turnId =
				typeof normalizedTurnPatch?.id === "string"
					? normalizedTurnPatch.id
					: null;
			if (!turnId) return;
			const existingTurn =
				state.turns.find((turn) => turn.id === turnId) ?? null;
			if (existingTurn) {
				const snapshot = await sessionTurnsRepo.mergeTurns(
					spaceId,
					targetSessionId,
					[{ ...existingTurn, ...normalizedTurnPatch } as SessionTurnRecord],
					{ session: state.session ?? null },
				);
				sessionWorkspace.sessionStateById = {
					...sessionStateById,
					[targetSessionId]: {
						...state,
						turns: snapshot.turns,
					},
				};
			}
			if (!existingTurn || payload.type === "session.turn.finalized") {
				void hydrateTurnOnce({
					sessionId: targetSessionId,
					turnId,
					reason: "turn.event",
					onHydrated:
						payload.type === "session.turn.finalized"
							? () => completeGenerationForTurn(targetSessionId, turnId)
							: undefined,
				});
			}
			if (isActiveSession && shouldAutoFollow) {
				await tick();
				requestBottomFollow();
			}
			return;
		}
		return;
	} catch (error) {
		console.error("[WS] handleWsEvent error:", error);
	}
}
function completeGenerationForTurn(sessionId: string, turnId: string | null) {
	const current = sessionGenerationStore.get(sessionId);
	if (turnId && current?.turnId && current.turnId !== turnId) return;
	completeGeneration(sessionId);
}

function handleGenerationStreamEvent(
	sessionId: string,
	event: GenerationStreamEvent,
) {
	return generationRealtime.handleGenerationStreamEvent(sessionId, event);
}
async function handleForkTurn(turn: SessionTurnRecord) {
	if (!activeSessionId || forkingTurnId) return;
	forkingTurnId = turn.id;
	clearComposerError();
	try {
		const response = await sdk
			.space(spaceId)
			.session(activeSessionId)
			.turn(turn.sourceTurnId ?? turn.id)
			.fork();
		await sessionTurnsRepo
			.clearSession(spaceId, response.session.id)
			.catch(() => undefined);
		await syncForkResponseToSessionListCache(
			response.session,
			response.fork as SessionListForkRecord,
			activeSessionState?.session ?? null,
		).catch(() => undefined);
		await goto(buildSpaceSessionRoute(spaceId, response.session.id));
	} catch (error) {
		setComposerError(
			error instanceof Error ? error.message : "Failed to fork session",
		);
	} finally {
		forkingTurnId = null;
	}
}

async function handleAbort() {
	if (!activeSessionId || !activeSessionState?.session || !space || aborting)
		return;
	sessionComposer.aborting = true;
	clearComposerError();
	try {
		await sdk
			.space(spaceId)
			.session(activeSessionId)
			.abort({
				turnId: activeGenerationState?.turnId ?? null,
			});
		interruptGeneration(activeSessionId);
	} catch (error) {
		setComposerError(
			error instanceof Error ? error.message : "Failed to stop generation",
		);
	} finally {
		sessionComposer.aborting = false;
	}
}

function escapeMarkdownPath(path: string) {
	return path.replace(/[\r\n`]/g, "_");
}

function buildFileReferencesText(paths: string[]) {
	if (paths.length === 0) return "";
	return [
		"Files:",
		...paths.map((path) => `- \`${escapeMarkdownPath(path)}\``),
	].join("\n");
}

function buildImageReferencesText(imageUrls: string[]) {
	if (imageUrls.length === 0) return "";
	return ["Images:", ...imageUrls.map((url) => `- ${url}`)].join("\n");
}

async function uploadComposerFileAttachments(
	sessionId: string,
	fileAttachments: ComposerFileAttachment[],
) {
	if (fileAttachments.length === 0) return [];
	sessionComposer.setUploading("file");
	const uploaded = await uploadSpaceEntries({
		spaceId,
		destination: { kind: "sandbox_tmp", sessionId },
		entries: fileAttachments.map((attachment) => ({
			file: attachment.file,
			relativePath: attachment.relativePath,
		})),
	});
	return uploaded.map((file) => file.path);
}

async function uploadComposerImageAttachments(
	sessionId: string,
	imageAttachments: ComposerImageAttachment[],
) {
	if (imageAttachments.length === 0) return new Map<string, string>();
	sessionComposer.setUploading("image");
	const uploaded = await Promise.all(
		imageAttachments.map(async (attachment) => {
			if (attachment.uploadedUrl)
				return [attachment.id, attachment.uploadedUrl] as const;
			const asset = await uploadChatAttachmentImage({
				spaceId,
				sessionId,
				file: attachment.file,
				mediaType: attachment.mediaType,
				filename: attachment.name,
			});
			return [attachment.id, asset.publicUrl] as const;
		}),
	);
	const imageUrls = new Map(uploaded);
	sessionComposer.setUploadedImageUrls(imageUrls);
	return imageUrls;
}

async function handleSend() {
	if (
		(!activeSessionState?.session && !isNewSessionRoute) ||
		(!input.trim() && attachments.length === 0) ||
		sending ||
		!space
	)
		return;
	sessionComposer.sending = true;
	const model = activeSessionModel;
	clearComposerError();
	clearGenerationError(activeSessionId);
	let sessionId = activeSessionState?.session?.id ?? null;
	let targetSessionState = activeSessionState;
	const pendingInput = input;
	const pendingAttachments = attachments;
	const optimisticTurnId = crypto.randomUUID();
	const clientMessageId = crypto.randomUUID();
	const currentUser = {
		uuid: authStore.userUuid ?? null,
		profile: authStore.profile,
	};
	let content: ContentBlock[] = [];
	let text = "";
	let hadFileUpload = false;
	let hadImageUpload = false;
	let uploadCompleted = false;
	let uploadedReferenceText = "";
	let uploadedImageUrls = new Map<string, string>();
	let optimisticTurn: SessionTurnRecord | null = null;
	let hasActiveTurn = false;
	try {
		if (!sessionId) {
			const result = await sdk
				.space(spaceId)
				.sessions.create({ source: "web" });
			const newSession = result.session;
			const nextSessions = sortSessionsByRecentActivity([
				newSession,
				...spaceSessions.filter((session) => session.id !== newSession.id),
			]);
			void patchCachedSessionList(spaceId, (current) => [
				newSession,
				...current.filter((session) => session.id !== newSession.id),
			]).catch(() => undefined);
			seedSessions(nextSessions);
			targetSessionState = {
				session: newSession,
				turns: [],
				loading: false,
				loaded: true,
				error: "",
				hasMore: false,
				hasMoreNewer: false,
				loadingOlder: false,
				loadingNewer: false,
				oldestCursor: undefined,
			};
			sessionWorkspace.sessionStateById = {
				...sessionStateById,
				[newSession.id]: targetSessionState,
			};
			resolvedNewSessionId = newSession.id;
			if (model) {
				sessionModelById = {
					...sessionModelById,
					[newSession.id]: model,
				};
			}
			sessionWorkspace.activeSessionId = newSession.id;
			sessionId = newSession.id;
			ensureSessionModelLoaded(newSession.id);
			applySessionGenerationPolicy(loadSessionGenerationPolicy(newSession.id));
			void updateUrlSession(newSession.id).catch((error) => {
				console.warn(
					"[NewChat] failed to update URL after session creation",
					error,
				);
			});
		}
		if (!sessionId || !targetSessionState?.session) {
			throw new Error("Failed to create session");
		}
		const fileAttachments = attachments.filter(
			(attachment): attachment is ComposerFileAttachment =>
				attachment.kind === "file",
		);
		const imageAttachments = attachments.filter(
			(attachment): attachment is ComposerImageAttachment =>
				attachment.kind === "image",
		);
		hadFileUpload = fileAttachments.length > 0;
		hadImageUpload = imageAttachments.length > 0;
		const [filePaths, imageUrls] = await Promise.all([
			uploadComposerFileAttachments(sessionId, fileAttachments),
			uploadComposerImageAttachments(sessionId, imageAttachments),
		]);
		uploadedImageUrls = imageUrls;
		uploadCompleted = true;
		const userText = input.trim();
		const referenceText = [
			buildFileReferencesText(filePaths),
			buildImageReferencesText([...imageUrls.values()]),
		]
			.filter(Boolean)
			.join("\n\n");
		uploadedReferenceText = referenceText;
		text = [userText, referenceText].filter(Boolean).join("\n\n");
		const attachmentBlocks: ContentBlock[] = attachments.flatMap(
			(attachment) => {
				if (attachment.kind === "file") return [];
				if (attachment.kind === "text")
					return [buildComposerTextContentBlock(attachment)];
				const url = imageUrls.get(attachment.id);
				if (!url) throw new Error("Failed to upload image.");
				return [
					{
						type: "image",
						source: {
							type: "url",
							url,
						},
						_meta: {
							filename: attachment.name,
							mediaType: attachment.mediaType,
							size: attachment.size,
						},
					} satisfies ContentBlock,
				];
			},
		);
		const mentions = extractSpaceMentionsFromText(text);
		content = [
			...(text
				? [
						{
							type: "text",
							text,
							_meta: mentions.length > 0 ? { mentions } : undefined,
						} satisfies ContentBlock,
					]
				: []),
			...attachmentBlocks,
		];

		// Clear input immediately so it disappears from the composer at the same
		// time the optimistic turn appears in the list — avoids the awkward "stuck"
		// feeling where the message shows in the list but lingers in the input.
		sessionComposer.clearDraft();
		const now = new Date().toISOString();
		const sequenceHint = (targetSessionState.turns.at(-1)?.sequence ?? 0) + 1;
		hasActiveTurn = activeSessionIsRunning;
		optimisticTurn = {
			id: optimisticTurnId,
			sessionId,
			userUuid: currentUser.uuid,
			sequence: sequenceHint,
			status: hasActiveTurn ? "queued" : "running",
			intent: "followup",
			userContent: content,
			userText: text,
			assistantContent: null,
			assistantText: null,
			provider: model?.provider ?? null,
			model: model?.id ?? null,
			stopReason: null,
			errorMessage: null,
			finalUsage: null,
			totalUsage: null,
			summary: null,
			intermediateIndex: null,
			intermediateSummary: null,
			meta: {
				optimistic: true,
				userId: currentUser.uuid,
				clientMessageId,
			},
			authorProfile: currentUser.profile,
			startedAt: now,
			completedAt: null,
			durationMs: null,
			createdAt: now,
			updatedAt: now,
		} as SessionTurnRecord;
		sessionWorkspace.sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				...targetSessionState,
				turns: mergeTurnsById(targetSessionState.turns, [optimisticTurn], {
					preferIncoming: true,
				}),
			},
		};
		// Sending a message is an explicit intent to jump back to the live edge.
		// This keeps the optimistic user turn and the following streaming reply in view,
		// even if the user was previously reading older context.
		sessionScroll.shouldAutoFollow = true;
		await tick();
		requestBottomFollow({ immediate: true });
		void sessionTurnsRepo.mergeTurns(spaceId, sessionId, [optimisticTurn], {
			session: targetSessionState.session,
		});
		if (!hasActiveTurn)
			startGenerationRequest(sessionId, { spaceId, turnId: optimisticTurnId });
		const sendResult = await sdk.space(spaceId).prompt({
			sessionId,
			content,
			model: model?.id,
			provider: model?.provider,
			clientMessageId,
			generationPolicy: buildTurnGenerationPolicy(),
			accessMode: "full_access",
			source: "web",
			intent: "followup",
			schedule: { mode: "immediate" },
		});
		if (sendResult.mode !== "immediate") {
			throw new Error("Expected immediate prompt response");
		}
		const acceptedTurn = sendResult.turn;
		applyAcceptedTurnId({
			sessionId,
			previousTurnId: optimisticTurnId,
			nextTurnId: acceptedTurn.id,
			confirmedTurn: acceptedTurn,
		});
		if (sendResult.session) upsertSessionRecord(sendResult.session);
		const current = sessionStateById[sessionId];
		if (current) {
			const snapshot = await sessionTurnsRepo.mergeTurns(
				spaceId,
				sessionId,
				[
					{
						...acceptedTurn,
						userUuid: acceptedTurn.userUuid ?? currentUser.uuid,
						authorProfile:
							acceptedTurn.authorProfile ?? currentUser.profile ?? null,
					},
				],
				{ session: sendResult.session ?? current.session ?? null },
			);
			sessionWorkspace.sessionStateById = {
				...sessionStateById,
				[sessionId]: {
					...current,
					session: snapshot.session ?? current.session,
					turns: normalizeTurnDuplicates(snapshot.turns),
				},
			};
		}
		if (wsConnectionState !== "open") {
			schedulePostSendRecoveryCheck(sessionId);
		}
		for (const attachment of pendingAttachments)
			revokeComposerAttachmentPreview(attachment);
	} catch (error) {
		// Restore input and attachments on failure so user doesn't lose their message
		if ((hadFileUpload || hadImageUpload) && uploadCompleted) {
			sessionComposer.restoreDraft(
				[pendingInput.trim(), uploadedReferenceText]
					.filter(Boolean)
					.join("\n\n"),
				pendingAttachments
					.filter((attachment) => attachment.kind !== "file")
					.map((attachment) =>
						attachment.kind === "image"
							? {
									...attachment,
									status: "ready" as const,
									uploadedUrl:
										uploadedImageUrls.get(attachment.id) ??
										attachment.uploadedUrl,
								}
							: attachment,
					),
			);
		} else {
			sessionComposer.restoreDraft(pendingInput, pendingAttachments);
		}
		if ((hadFileUpload || hadImageUpload) && !uploadCompleted) {
			sessionComposer.markAttachmentUploadsFailed();
		}
		const sendError =
			error instanceof Error ? error.message : "Failed to send message";
		const sendErrorCode = getHttpErrorCode(error);
		const displayError =
			hadFileUpload || hadImageUpload
				? uploadCompleted
					? "Message failed. Attachments were uploaded."
					: "Upload failed. Please try again."
				: sendError;
		setComposerError(displayError, sendErrorCode);
		if (sessionId)
			failGeneration(sessionId, sendError, { errorCode: sendErrorCode });
		const current = sessionId ? sessionStateById[sessionId] : null;
		const failedSessionId = sessionId;
		if (current && optimisticTurn && failedSessionId) {
			const failedAt = new Date().toISOString();
			const failedTurn = {
				id: optimisticTurnId,
				sessionId: failedSessionId,
				userUuid: currentUser.uuid,
				sequence: optimisticTurn.sequence,
				status: hasActiveTurn ? "cancelled" : "failed",
				intent: "followup",
				userContent: content,
				userText: text,
				assistantContent: null,
				assistantText: null,
				provider: optimisticTurn.provider,
				model: optimisticTurn.model,
				stopReason: "error",
				errorMessage: displayError,
				finalUsage: null,
				totalUsage: null,
				summary: null,
				intermediateIndex: null,
				intermediateSummary: null,
				meta: {
					...(optimisticTurn.meta ?? {}),
					localOnly: true,
					failedAt,
				},
				authorProfile: currentUser.profile,
				startedAt: optimisticTurn.startedAt,
				completedAt: failedAt,
				durationMs: null,
				createdAt: optimisticTurn.createdAt,
				updatedAt: failedAt,
			} as SessionTurnRecord;
			sessionWorkspace.sessionStateById = {
				...sessionStateById,
				[failedSessionId]: {
					...current,
					turns: mergeTurnsById(
						current.turns.filter((turn) => turn.id !== optimisticTurnId),
						[failedTurn],
						{ preferIncoming: true },
					),
				},
			};
		}
	} finally {
		sessionComposer.sending = false;
	}
}
function scrollToBottomNow() {
	if (!listEl) return;
	autoScrollGuard = true;
	setProgrammaticScrollTop(listEl.scrollHeight - listEl.clientHeight);
	if (activeSessionId) {
		writeBottomScrollAnchor(activeSessionId);
	}
	requestAnimationFrame(() => {
		autoScrollGuard = false;
	});
}
function stopBottomFollow() {
	bottomFollowActive = false;
	if (bottomFollowFrame != null) {
		cancelAnimationFrame(bottomFollowFrame);
		bottomFollowFrame = null;
	}
}
function requestBottomFollow(options?: { immediate?: boolean }) {
	if (!listEl || !shouldAutoFollow) return;
	if (options?.immediate) {
		scrollToBottomNow();
		return;
	}
	bottomFollowActive = true;
	if (bottomFollowFrame == null) {
		bottomFollowFrame = requestAnimationFrame(runBottomFollowFrame);
	}
}
function runBottomFollowFrame() {
	bottomFollowFrame = null;
	if (!bottomFollowActive || !listEl || !shouldAutoFollow) {
		bottomFollowActive = false;
		return;
	}
	const maxScroll = Math.max(0, listEl.scrollHeight - listEl.clientHeight);
	const distance = maxScroll - listEl.scrollTop;
	if (Math.abs(distance) <= 1) {
		setProgrammaticScrollTop(maxScroll);
		bottomFollowActive = false;
		return;
	}
	const velocity = Math.max(8, Math.min(96, Math.abs(distance) * 0.34));
	const next = listEl.scrollTop + Math.sign(distance) * velocity;
	setProgrammaticScrollTop(
		distance > 0 ? Math.min(next, maxScroll) : Math.max(next, maxScroll),
	);
	if (activeSessionId) writeBottomScrollAnchor(activeSessionId);
	bottomFollowFrame = requestAnimationFrame(runBottomFollowFrame);
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
	sessionScroll.shouldAutoFollow = distanceFromBottom <= threshold;
}
function updateCurrentTurnSequence() {
	if (!listEl) return;
	const nodes = Array.from(
		listEl.querySelectorAll<HTMLElement>('[data-turn-anchor="user"]'),
	);
	if (nodes.length === 0) {
		currentTurnSequence = null;
		return;
	}
	const containerRect = listEl.getBoundingClientRect();
	const probeY = containerRect.top + Math.min(160, containerRect.height * 0.35);
	let best: { sequence: number; distance: number } | null = null;
	for (const node of nodes) {
		const sequence = Number(node.dataset.turnSequence);
		if (!Number.isFinite(sequence)) continue;
		const rect = node.getBoundingClientRect();
		const distance =
			rect.top <= probeY ? probeY - rect.top : rect.top - probeY + 1000;
		if (!best || distance < best.distance) best = { sequence, distance };
	}
	currentTurnSequence = best?.sequence ?? null;
}
function setProgrammaticScrollTop(scrollTop: number) {
	if (!listEl) return;
	const nextScrollTop = Math.min(
		Math.max(0, listEl.scrollHeight - listEl.clientHeight),
		Math.max(0, scrollTop),
	);
	programmaticScrollActive = true;
	programmaticScrollTarget = nextScrollTop;
	userScrollActive = false;
	listEl.scrollTop = nextScrollTop;
	updateTimelineScrollMetrics();
	requestAnimationFrame(() => {
		programmaticScrollActive = false;
	});
}
function beginUserScroll() {
	if (!activeSessionId) return;
	stopBottomFollow();
	userScrollActive = true;
	programmaticScrollActive = false;
	programmaticScrollTarget = null;
	if (activeAnchorRestore?.sessionId === activeSessionId) {
		sessionScroll.activeAnchorRestore = null;
		sessionScroll.anchorRestoreWaitingForMarkdown = false;
	}
	if (pendingRestoreSessionId === activeSessionId) {
		sessionScroll.pendingRestoreSessionId = null;
	}
	if (restoringBottomSessionId === activeSessionId) {
		restoringBottomSessionId = null;
	}
}
function handleScrollKeydown(event: KeyboardEvent) {
	if (
		event.key === "ArrowDown" ||
		event.key === "ArrowUp" ||
		event.key === "PageDown" ||
		event.key === "PageUp" ||
		event.key === "Home" ||
		event.key === "End" ||
		event.key === " "
	) {
		beginUserScroll();
	}
}
function maybeCompleteAnchorRestore() {
	if (!activeAnchorRestore || !anchorRestoreWaitingForMarkdown) return;
	if (pendingTimelineMarkdownRenders > 0) return;
	sessionScroll.activeAnchorRestore = null;
	sessionScroll.anchorRestoreWaitingForMarkdown = false;
	updateAutoFollow();
}
function applyActiveAnchorRestore(restore = activeAnchorRestore) {
	if (!restore || !listEl || activeSessionId !== restore.sessionId)
		return false;
	const node = listEl.querySelector<HTMLElement>(
		`[data-sequence="${restore.sequence}"]`,
	);
	if (!node) return false;
	setProgrammaticScrollTop(getMessageElementAbsoluteTop(node) + restore.offset);
	sessionScroll.shouldAutoFollow = false;
	return true;
}
function areSessionScrollAnchorsEqual(
	current: SessionScrollAnchor | null | undefined,
	next: SessionScrollAnchor | null | undefined,
) {
	return Boolean(
		current &&
			next &&
			current.sequence === next.sequence &&
			current.offset === next.offset &&
			current.updatedAt === next.updatedAt,
	);
}
function restoreSessionScrollAnchorSoon(sessionId: string) {
	const anchor = getSessionScrollAnchor(sessionId);
	if (!anchor) return;
	const restore = { ...anchor, sessionId };
	sessionScroll.activeAnchorRestore = restore;
	sessionScroll.anchorRestoreWaitingForMarkdown = false;
	requestAnimationFrame(() => {
		if (!applyActiveAnchorRestore(restore)) {
			if (activeAnchorRestore?.sessionId === sessionId)
				sessionScroll.activeAnchorRestore = null;
			updateAutoFollow();
			return;
		}
		requestAnimationFrame(() => {
			applyActiveAnchorRestore(restore);
			if (activeAnchorRestore?.sessionId === sessionId)
				sessionScroll.activeAnchorRestore = null;
			updateAutoFollow();
			scheduleTurnMarkerMeasure();
		});
	});
}
function handleTimelineMarkdownRenderStart() {
	sessionScroll.pendingTimelineMarkdownRenders += 1;
}
function handleTimelineMarkdownRendered() {
	if (pendingTimelineMarkdownRenders > 0)
		sessionScroll.pendingTimelineMarkdownRenders -= 1;
	scheduleTurnMarkerMeasure();
	const restore = activeAnchorRestore;
	if (restore?.sessionId === activeSessionId) {
		requestAnimationFrame(() => {
			applyActiveAnchorRestore(restore);
			maybeCompleteAnchorRestore();
		});
		return;
	}
	if (
		activeSessionId &&
		(restoringBottomSessionId === activeSessionId || shouldAutoFollow)
	) {
		requestAnimationFrame(() => requestBottomFollow());
	}
	maybeCompleteAnchorRestore();
}
async function handlePickAttachments(
	files: FileList | File[] | LocalUploadEntry[] | null,
) {
	await sessionComposer.handlePickAttachments(files);
}

async function applyBackgroundComposerPayload(
	payload: NewChatComposerApplyPayload,
) {
	if (typeof payload.prompt === "string") {
		sessionComposer.input = payload.prompt;
	}
	if (payload.model && modelsCatalog) {
		const catalogItem = modelsCatalog.find(
			(item) =>
				item.provider === payload.model?.provider &&
				item.id === payload.model?.id,
		);
		if (catalogItem) {
			const selected = {
				provider: catalogItem.provider,
				id: catalogItem.id,
				name: catalogItem.model.name as string | undefined,
			} satisfies SelectedModel;
			draftSessionModel = selected;
			if (activeSessionId) {
				sessionModelById = {
					...sessionModelById,
					[activeSessionId]: selected,
				};
			}
		}
	}
	const imageEntries = (payload.images ?? []).filter(
		(image): image is { url: string; name?: string } =>
			typeof image.url === "string" && image.url.startsWith("https://"),
	);
	if (imageEntries.length > 0) {
		try {
			const files = await Promise.all(
				imageEntries.map(async (image) => {
					const response = await fetch(image.url);
					if (!response.ok) {
						throw new Error(`Failed to load image: ${image.url}`);
					}
					const blob = await response.blob();
					if (!blob.type.startsWith("image/")) {
						throw new Error(`Unsupported image type: ${image.url}`);
					}
					return new File([blob], image.name ?? "image", { type: blob.type });
				}),
			);
			await handlePickAttachments(files);
		} catch (error) {
			console.warn(
				"[NewChat] failed to apply background payload images",
				error,
			);
		}
	}
}
function handleRemoveAttachment(id: string) {
	sessionComposer.handleRemoveAttachment(id);
}
onDestroy(() => {
	sessionComposer.dispose();
});

function beginRightSidebarResize(event: PointerEvent) {
	event.preventDefault();
	if (
		window.innerWidth < DESKTOP_SHELL_MIN_WIDTH_PX ||
		uiState.rightSidebarCollapsed
	)
		return;
	const target = event.currentTarget as HTMLElement | null;
	target?.setPointerCapture?.(event.pointerId);
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
		if (target?.hasPointerCapture?.(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
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
function getRightSidebarReservedWidth() {
	if (uiState.rightSidebarCollapsed || spaceHasMinimalAccess) return 0;
	return uiState.rightSidebarWidth;
}
function getMaxPreviewPanelWidth() {
	if (typeof window === "undefined") return previewPanelWidth;
	const layoutWidth = workspaceBodyEl?.clientWidth ?? window.innerWidth;
	return Math.max(
		PREVIEW_PANEL_MIN_WIDTH,
		layoutWidth - CHAT_PANEL_MIN_WIDTH - getRightSidebarReservedWidth(),
	);
}
function setPreviewPanelWidth(width: number) {
	previewPanelWidth = Math.min(
		Math.max(PREVIEW_PANEL_MIN_WIDTH, width),
		getMaxPreviewPanelWidth(),
	);
}
function ensurePreviewPanelFits() {
	setPreviewPanelWidth(previewPanelWidth);
}
function restorePreviewFocusSnapshot() {
	const snapshot = previewFocusSnapshot;
	previewFocusSnapshot = null;
	if (!snapshot) return;
	uiState.setLeftSidebarCollapsed(snapshot.leftSidebarCollapsed);
	uiState.setRightSidebarCollapsed(snapshot.rightSidebarCollapsed);
	previewPanelWidth = snapshot.previewPanelWidth;
	ensurePreviewPanelFits();
}
async function togglePreviewFocusMode() {
	if (isMobile) return;
	if (previewFocusMode) {
		previewFocusMode = false;
		restorePreviewFocusSnapshot();
		return;
	}
	previewFocusSnapshot = {
		leftSidebarCollapsed: uiState.leftSidebarCollapsed,
		rightSidebarCollapsed: uiState.rightSidebarCollapsed,
		previewPanelWidth,
	};
	previewFocusMode = true;
	uiState.setLeftSidebarCollapsed(true);
	uiState.setRightSidebarCollapsed(true);
	await tick();
	setPreviewPanelWidth(getMaxPreviewPanelWidth());
}
function closePreviewFocusMode() {
	if (!previewFocusMode && !previewFocusSnapshot) return;
	previewFocusMode = false;
	restorePreviewFocusSnapshot();
}
function handlePreviewWindowResize() {
	if (previewFocusMode) {
		setPreviewPanelWidth(getMaxPreviewPanelWidth());
		return;
	}
	if (activePreviewKind) ensurePreviewPanelFits();
}
function beginPreviewPanelResize(event: PointerEvent) {
	event.preventDefault();
	if (window.innerWidth < DESKTOP_SHELL_MIN_WIDTH_PX) return;
	previewFocusMode = false;
	previewFocusSnapshot = null;
	const target = event.currentTarget as HTMLElement | null;
	target?.setPointerCapture?.(event.pointerId);
	previewPanelResizeCleanup?.();
	const startX = event.clientX;
	const startWidth = previewPanelWidth;
	const onPointerMove = (moveEvent: PointerEvent) => {
		const delta = startX - moveEvent.clientX;
		setPreviewPanelWidth(startWidth + delta);
	};
	const stop = () => {
		if (target?.hasPointerCapture?.(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
		document.body.classList.remove("sidebar-resizing");
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", stop);
		window.removeEventListener("pointercancel", stop);
		if (previewPanelResizeCleanup === stop) previewPanelResizeCleanup = null;
	};
	previewPanelResizeCleanup = stop;
	document.body.classList.add("sidebar-resizing");
	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", stop);
	window.addEventListener("pointercancel", stop);
}
async function toggleRightSidebar() {
	if (window.innerWidth < DESKTOP_SHELL_MIN_WIDTH_PX) {
		uiState.mobileRightDrawerOpen = !uiState.mobileRightDrawerOpen;
		return;
	}
	const nextCollapsed = !uiState.rightSidebarCollapsed;
	const rightWidth = uiState.rightSidebarWidth;
	uiState.setRightSidebarCollapsed(nextCollapsed);
	if (!activePreviewKind) return;
	closePreviewFocusMode();
	await tick();
	setPreviewPanelWidth(
		previewPanelWidth + (nextCollapsed ? rightWidth : -rightWidth),
	);
}
async function loadFileTree(force = false) {
	await fileWorkspace.loadFileTree(force);
}
async function expandDirectory(node: SpaceFsNode) {
	await fileWorkspace.expandDirectory(node);
}
async function openSpaceFile(path: string) {
	fileWorkspace.openSpaceFile(path);
}
async function refreshFileTree() {
	await fileWorkspace.refreshFileTree();
}
async function openFileFromUrl(path: string) {
	await fileWorkspace.openFileFromUrl(path);
}
async function saveOpenFile() {
	await fileWorkspace.saveOpenFile();
}
async function handleCreateFile(parentPath: string) {
	await fileWorkspace.handleCreateFile(parentPath);
}
async function handleCreateCanvas(parentPath: string) {
	await fileWorkspace.handleCreateCanvas(parentPath);
}
async function handleCreateDir(parentPath: string) {
	await fileWorkspace.handleCreateDir(parentPath);
}
async function handleRenameNode(node: SpaceFsNode) {
	await fileWorkspace.handleRenameNode(node);
}
async function handleDownloadNode(node: SpaceFsNode) {
	await fileWorkspace.handleDownloadNode(node);
}
async function handleDeleteNode(node: SpaceFsNode) {
	await fileWorkspace.handleDeleteNode(node);
	if (inlineCanvas?.path === node.path) closeInlineCanvas();
}
function closeFile() {
	fileWorkspace.closeFile();
}
async function openInlineFile(path: string) {
	await fileWorkspace.openInlineFile(path);
}
function closeInlineFile() {
	fileWorkspace.closeInlineFile();
}
async function openInlineCanvas(path: string) {
	await canvasPreview.openCanvas(path);
}
function closeInlineCanvas() {
	canvasPreview.closeCanvas();
}
async function flushInlineCanvasPendingTransactions(documentId: string) {
	await canvasPreview.flushPendingTransactions(documentId);
}
async function commitInlineCanvas(
	document: CovasDocument,
	ops: CanvasSemanticOp[],
) {
	await canvasPreview.commitCanvas(document, ops);
}
function openInlinePort(
	port: string,
	url: string,
	options: { autoOpened?: boolean } = {},
) {
	portPreview.openPort(port, url, options);
}
function closeInlinePort() {
	portPreview.closePort();
}
async function downloadOpenFile() {
	await fileWorkspace.downloadOpenFile();
}
async function downloadInlineFile() {
	await fileWorkspace.downloadInlineFile();
}
async function saveInlineFile() {
	await fileWorkspace.saveInlineFile();
}
function handleUploadFiles(
	files: File[] | LocalUploadEntry[],
	targetDir: string,
) {
	fileWorkspace.handleUploadFiles(files, targetDir);
}
async function handleFileKeyboardSave(event: KeyboardEvent) {
	if (
		(event.metaKey || event.ctrlKey) &&
		event.key.toLowerCase() === "s" &&
		(fileMode === "file" || inlineFile)
	) {
		event.preventDefault();
		if (inlineFile) await saveInlineFile();
		else await saveOpenFile();
	}
	if (event.key === "Escape" && (inlineFile || inlinePortPreview)) {
		event.preventDefault();
		if (inlinePortPreview) closeInlinePort();
		else closeInlineFile();
	}
}
async function copyFileContent() {
	await fileWorkspace.copyFileContent();
}
async function copyInlineFileContent() {
	await fileWorkspace.copyInlineFileContent();
}
function getFileActionNode(path: string): SpaceFsNode {
	return fileWorkspace.getFileActionNode(path);
}

function insertPathReference(path: string) {
	insertComposerSnippet(` \`${path}\` `);
	uiState.mobileRightDrawerOpen = false;
}

function insertActiveSessionReference() {
	if (!activeSessionId) return;
	insertPathReference(`/sessions/${activeSessionId}.jsonl`);
}

function insertFilePathReference(path: string) {
	insertPathReference(path);
}

function editResourceLabels(
	resourceType: "session" | "checkpoint" | "file",
	resourceRef: string,
) {
	labelPickerResource = { type: resourceType, ref: resourceRef };
}

function getHeaderFileActionPath() {
	if (routeView === "file" && openFile?.path) return openFile.path;
	return inlineFile?.path ?? null;
}

function hasResourceActions() {
	return Boolean(activeSessionState?.session || getHeaderFileActionPath());
}

function closeResourceActionMenu() {
	resourceActionMenuOpen = false;
	fileWorkspace.fileActionMenuOpenPath = null;
}

function insertHeaderReference() {
	const filePath = getHeaderFileActionPath();
	if (filePath) {
		insertFilePathReference(filePath);
		closeResourceActionMenu();
		return;
	}
	insertActiveSessionReference();
	closeResourceActionMenu();
}

function getHeaderResourceLabel() {
	return getHeaderFileActionPath() ? "file" : "chat";
}

function handleCreateNewSession() {
	if (!canCreateSession || !space) return;
	createSessionError = "";
	void goto(buildSpaceNewSessionRoute(space.id), {
		keepFocus: true,
		noScroll: true,
	})
		.then(() => {
			sessionWorkspace.activeSessionId = null;
			sessionScroll.pendingRestoreSessionId = null;
			sessionScroll.activeAnchorRestore = null;
			sessionScroll.anchorRestoreWaitingForMarkdown = false;
			currentTurnSequence = null;
			showTurnBottomSheet = false;
			sessionScroll.shouldAutoFollow = true;
			focusComposerSoon();
		})
		.catch((error) => {
			createSessionError =
				error instanceof Error ? error.message : "Failed to open new chat";
		});
}
function focusComposerSoon() {
	requestAnimationFrame(() => {
		window.dispatchEvent(new CustomEvent("cohub:composer-focus"));
	});
}

function isEditableShortcutTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	return Boolean(
		target.closest(
			'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
		),
	);
}

function stopVimScroll() {
	sessionScroll.stopVimScroll();
}

function scrollTimelineByLines(direction: 1 | -1) {
	sessionScroll.scrollTimelineByLines(direction, beginUserScroll);
}

function clearPendingVimG() {
	sessionScroll.clearPendingVimG();
}

function scrollTimelineToTop() {
	sessionScroll.scrollTimelineToTop(
		beginUserScroll,
		setProgrammaticScrollTop,
		updateCurrentTurnSequence,
	);
}

function scrollTimelineToBottom() {
	sessionScroll.scrollTimelineToBottom(scrollToBottomNow);
}

async function jumpRelativeTurn(direction: 1 | -1) {
	if (!activeSessionId || activeTurnRailItems.length === 0) return;
	const current = currentTurnSequence;
	const sorted = activeTurnRailItems
		.map((turn) => turn.sequence)
		.sort((a, b) => a - b);
	if (sorted.length === 0) return;
	let target: number | undefined;
	if (current == null) {
		target = direction > 0 ? sorted[0] : sorted.at(-1);
	} else if (direction > 0) {
		target = sorted.find((sequence) => sequence > current) ?? sorted.at(-1);
	} else {
		target = sorted.findLast((sequence) => sequence < current) ?? sorted[0];
	}
	if (target == null || target === current) return;
	await jumpToTurn(target);
}

function handleSessionVimKeydown(event: KeyboardEvent) {
	if (event.defaultPrevented || isComposingKeyboardEvent(event)) return;
	if (routeView !== "session" || !activeSessionState) return;
	const key = event.key.toLowerCase();
	if (
		(event.metaKey || event.ctrlKey) &&
		event.shiftKey &&
		!event.altKey &&
		key === "m"
	) {
		event.preventDefault();
		showModelSelector = true;
		void loadModelsCatalog();
		void loadGenerationModelsCatalog();
		return;
	}
	if (isEditableShortcutTarget(event.target)) return;
	if (key !== "g") clearPendingVimG();
	if (
		event.shiftKey &&
		!event.altKey &&
		!event.metaKey &&
		!event.ctrlKey &&
		key === "g"
	) {
		event.preventDefault();
		clearPendingVimG();
		scrollTimelineToBottom();
		return;
	}
	if (
		event.shiftKey &&
		!event.altKey &&
		!event.metaKey &&
		!event.ctrlKey &&
		(key === "j" || key === "k")
	) {
		event.preventDefault();
		void jumpRelativeTurn(key === "j" ? 1 : -1);
		return;
	}
	if (
		!event.altKey &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		key === "g"
	) {
		event.preventDefault();
		if (sessionScroll.vimPendingGActive) {
			clearPendingVimG();
			scrollTimelineToTop();
			return;
		}
		sessionScroll.armPendingVimG();
		return;
	}
	if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
	if (key === "i") {
		event.preventDefault();
		focusComposerSoon();
		return;
	}
	if (key === "j") {
		event.preventDefault();
		scrollTimelineByLines(1);
		return;
	}
	if (key === "k") {
		event.preventDefault();
		scrollTimelineByLines(-1);
	}
}

onMount(() => {
	pageMounted = true;
	spaceRealtime.start();
	loadSessionScrollAnchors();
	window.addEventListener("keydown", handleSessionVimKeydown);
	const offSessionListCacheUpdated = onSessionListCacheUpdated(
		({ spaceId: updatedSpaceId, sessions }) => {
			if (updatedSpaceId !== spaceId) return;
			applySessionsSnapshot(sessions);
		},
	);
	for (const run of getCachedTaskRuns(spaceId)) {
		if (isGenerationTaskRun(run)) upsertGenerationTaskRun(run);
		if (isBackgroundBashTaskRun(run)) upsertBackgroundBashTaskRun(run);
	}
	void restoreCachedTaskRuns(spaceId)
		.then((runs) => {
			for (const run of runs) {
				if (isGenerationTaskRun(run)) upsertGenerationTaskRun(run);
				if (isBackgroundBashTaskRun(run)) upsertBackgroundBashTaskRun(run);
			}
		})
		.catch(() => undefined);
	const offCanvasTxApplied = sdk
		.space(spaceId)
		.on("canvas.tx.applied", (event) => {
			const payload = event.payload as {
				documentId?: unknown;
				version?: unknown;
				actorId?: unknown;
			};
			if (
				typeof payload.documentId !== "string" ||
				payload.documentId !== inlineCanvas?.documentId
			)
				return;
			if (inlineCanvas?.saving) return;
			void sdk
				.space(spaceId)
				.canvas.bootstrap(payload.documentId)
				.then((bootstrap) => {
					canvasPreview.applyBootstrap(payload.documentId as string, bootstrap);
				})
				.catch((error) => {
					canvasPreview.setError(
						payload.documentId as string,
						error instanceof Error ? error.message : "Failed to sync canvas",
					);
				});
		});
	const offTaskRunsCacheUpdated = onTaskRunsCacheUpdated(
		({ spaceId: updatedSpaceId, runs }) => {
			if (updatedSpaceId !== spaceId) return;
			for (const run of runs) {
				if (isGenerationTaskRun(run)) upsertGenerationTaskRun(run);
				if (isBackgroundBashTaskRun(run)) upsertBackgroundBashTaskRun(run);
			}
			if (routeTaskId) {
				const run = runs.find((item) => item.id === routeTaskId);
				if (run)
					taskRunDetail = taskRunDetail ? { ...taskRunDetail, ...run } : run;
			}
		},
	);
	const offSpaceConfigUpdated = subscribeSpaceConfig((config) => {
		spaceConfig = config;
	});
	const offSpaceConfigBackgroundAction = subscribeSpaceConfigBackgroundAction(
		(payload) => {
			if (!shouldShowNewChatBackground) return;
			void applyBackgroundComposerPayload(payload);
		},
	);
	// Preload model catalogs so the selector is ready immediately
	void loadModelsCatalog();
	void loadGenerationModelsCatalog();
	void loadPromptTemplates();
	const handleOpenInlineFileEvent = (e: Event) => {
		const custom = e as CustomEvent<{ spaceId?: string; path?: string }>;
		if (custom.detail?.spaceId !== spaceId || !custom.detail?.path) return;
		void openInlineFile(custom.detail.path);
	};
	const handleResourceActionMenuKeydown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			closeResourceActionMenu();
			fileWorkspace.fileActionMenuOpenPath = null;
		}
	};
	const handleResourceActionMenuClickOutside = (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		if (!target.closest("[data-resource-actions]")) {
			closeResourceActionMenu();
			fileWorkspace.fileActionMenuOpenPath = null;
		}
	};
	window.addEventListener("resize", handlePreviewWindowResize);
	window.addEventListener("cohub:open-inline-file", handleOpenInlineFileEvent);
	window.addEventListener("keydown", handleFileKeyboardSave);
	window.addEventListener("keydown", handleResourceActionMenuKeydown);
	document.addEventListener("click", handleResourceActionMenuClickOutside);
	scheduleStatusRefresh();
	return () => {
		window.removeEventListener("keydown", handleSessionVimKeydown);
		offSessionListCacheUpdated();
		offCanvasTxApplied();
		offTaskRunsCacheUpdated();
		offSpaceConfigUpdated();
		offSpaceConfigBackgroundAction();
		spaceStatus.dispose();
		for (const timer of taskHydrateRetryTimers.values()) clearTimeout(timer);
		taskHydrateRetryTimers.clear();
		taskHydrateRetryCounts.clear();
		if (turnMarkerMeasureFrame != null)
			cancelAnimationFrame(turnMarkerMeasureFrame);
		stopVimScroll();
		clearPendingVimG();
		stopBottomFollow();
		generationRealtime.dispose();
		persistSessionScrollAnchorsNow();
		pageMounted = false;
		spaceRealtime.dispose();
		window.removeEventListener("resize", handlePreviewWindowResize);
		window.removeEventListener(
			"cohub:open-inline-file",
			handleOpenInlineFileEvent,
		);
		window.removeEventListener("keydown", handleFileKeyboardSave);
		window.removeEventListener("keydown", handleResourceActionMenuKeydown);
		document.removeEventListener("click", handleResourceActionMenuClickOutside);
		rightSidebarResizeCleanup?.();
		previewPanelResizeCleanup?.();
		deactivateSpaceStyle();
		deactivateSpaceConfig();
	};
});
// React to space changes: reset state and reload data
$effect(() => {
	const currentSpaceId = spaceId;
	if (!pageMounted || !currentSpaceId || loadedSpaceId === currentSpaceId)
		return;
	loadedSpaceId = currentSpaceId;
	activateSpaceStyle(currentSpaceId);
	activateSpaceConfig(currentSpaceId);
	// Reset space-specific state
	space = null;
	spaceConfig = null;
	spaceStatus.reset();
	newChatProfileExpanded = false;
	newChatProfileCanExpand = false;
	newChatProfileBodyMaxHeight = 320;
	newChatProfileViewportEl = null;
	newChatProfileContentEl = null;
	newChatProfileBodyEl = null;
	promptTemplates = [];
	promptTemplatesLoaded = false;
	promptTemplatesLoadedFor = null;
	void loadPromptTemplates();
	sessionWorkspace.spaceSessions = [];
	sessionWorkspace.sessionStateById = {};
	sessionWorkspace.loadingSessionIds = {};
	sessionWorkspace.visibleInitialLoadingSessionIds = {};
	sessionLoadInFlight.clear();
	sessionTurnLoading.reset();
	syncSessionNewerInFlight.clear();
	turnHydrationInFlight.clear();
	clearAllPostSendRecovery();
	generationRealtime.clearStreamSnapshotRecoveryCooldowns();
	spaceRealtime.resetRecoveredConnection();
	sessionWorkspace.activeSessionId = null;
	currentTurnSequence = null;
	sessionScroll.turnMarkerPositions = {};
	sessionScroll.turnMarkerHeights = {};
	lastTurnIndexRefreshKey = "";
	showTurnBottomSheet = false;
	appliedRouteTurnKey = null;
	fileWorkspace.resetForSpace();
	portPreview.setEndpoints({});
	portPreview.closePort();
	portPreview.closeReadyToast();
	resourceActionMenuOpen = false;
	showShareModal = false;
	shareModalSessionId = null;
	sessionAccessById = {};
	checkpointDetail = null;
	cronjobDetail = null;
	taskRunDetail = null;
	creatingSession = false;
	createSessionError = "";
	sessionTasks.reset();
	sessionGenerationStore.resetAll();
	bootstrapping = true;
	untrack(() => {
		void (async () => {
			let sessionLoad: Promise<void> | null = null;
			const spaceLoad = loadSpace();
			try {
				if (
					routeView === "session" &&
					routeSessionId &&
					routeSessionId !== "new"
				) {
					prepareRouteSession(routeSessionId);
					sessionLoad = loadSessionState(routeSessionId).catch(() => undefined);
				}
				const [cachedSpace, cachedSnapshot] = await Promise.all([
					withBootstrapCacheTimeout(spaceRecordRepo.getCached(currentSpaceId)),
					withBootstrapCacheTimeout(
						getCachedSessionListSnapshot(currentSpaceId),
					),
				]);
				if (spaceId !== currentSpaceId) return;
				const cachedSessions = cachedSnapshot?.sessions;
				if (cachedSessions && cachedSessions.length > 0) {
					seedSessions(cachedSessions);
				}
				if (
					routeView === "session" &&
					routeSessionId &&
					routeSessionId !== "new"
				) {
					prepareRouteSession(routeSessionId);
				}
				const cachedSessionLoad = sessionLoad;
				if (cachedSpace?.space && !space) {
					space = cachedSpace.space;
					portPreview.setEndpoints(extractPublicEndpoints(cachedSpace.space));
				} else if (!space) {
					await spaceLoad;
				}
				if (spaceId !== currentSpaceId) return;
				void refreshSessionsList(false);
				void loadPreviewEndpoints();
				void loadFileTree();
				if (
					routeView === "session" &&
					routeSessionId &&
					routeSessionId !== "new"
				) {
					prepareRouteSession(routeSessionId);
					await cachedSessionLoad;
					void loadTurnIndex(routeSessionId);
				}
			} catch {
				// Non-blocking; bootstrapping released below
			} finally {
				if (spaceId === currentSpaceId) {
					bootstrapping = false;
				}
			}
		})();
	});
});
// React to space changes: subscribe to WS events for the new space
$effect(() => {
	const currentSpaceId = spaceId;
	if (!pageMounted || !currentSpaceId) return;
	const wsEventCleanup = sdk.space(currentSpaceId).subscribe((event) => {
		void handleWsEvent(event as ChannelEnvelope);
	});
	return wsEventCleanup;
});
$effect(() => {
	const currentSpaceId = spaceId;
	const sessionId = activeSessionId;
	if (!pageMounted || !currentSpaceId || !sessionId) return;
	return sdk
		.space(currentSpaceId)
		.session(sessionId)
		.subscribeGeneration({
			event: (event) => {
				void handleGenerationStreamEvent(sessionId, event);
			},
		});
});
$effect(() => {
	const currentSpaceId = spaceId;
	const sessionId = activeSessionId;
	if (!pageMounted || !currentSpaceId || !sessionId) return;
	return sessionTurnsRepo.subscribe(currentSpaceId, sessionId, (snapshot) => {
		const current = sessionStateById[sessionId];
		if (!current) return;
		sessionWorkspace.sessionStateById = {
			...sessionStateById,
			[sessionId]: {
				...current,
				session: snapshot.session ?? current.session,
				turns: normalizeTurnDuplicates(
					mergeTurnsById(current.turns, snapshot.turns, {
						preferIncoming: true,
					}),
				),
				hasMore: snapshot.hasMoreOlder,
				hasMoreNewer: snapshot.hasMoreNewer,
				oldestCursor: snapshot.oldestSequence ?? undefined,
			},
		};
	});
});
$effect(() => {
	const sessionId = routeSessionId;
	const sequence = routeTurnSequence;
	if (
		!pageMounted ||
		routeView !== "session" ||
		!sessionId ||
		sessionId === "new" ||
		activeSessionId !== sessionId ||
		!sequence
	)
		return;
	const key = `${sessionId}:${sequence}`;
	if (appliedRouteTurnKey === key) return;
	appliedRouteTurnKey = key;
	void jumpToTurn(sequence);
});
$effect(() => {
	if (routeView === "session" && routeSessionId && routeSessionId !== "new")
		return;
	appliedRouteTurnKey = null;
});
$effect(() => {
	if (!isNewSessionRoute) resolvedNewSessionId = null;
});
$effect(() => {
	if (routeView === "session" && activeSessionId) return;
	showTurnBottomSheet = false;
});
$effect(() => {
	const sessionId = activeSessionId;
	if (!sessionId) return;
	untrack(() => {
		void loadTurnIndex(sessionId);
	});
});
$effect(() => {
	if (!listEl || timeline.length === 0) {
		sessionScroll.turnMarkerPositions = {};
		sessionScroll.turnMarkerHeights = {};
		return;
	}
	void tick().then(() => {
		updateCurrentTurnSequence();
		scheduleTurnMarkerMeasure();
	});
});
$effect(() => {
	const el = listEl;
	if (!el) return;
	const observer = new ResizeObserver(() => scheduleTurnMarkerMeasure());
	observer.observe(el);
	for (const child of Array.from(el.children)) observer.observe(child);
	scheduleTurnMarkerMeasure();
	return () => observer.disconnect();
});
$effect(() => {
	const sessionId = activeSessionId;
	const loadedCount = activeSessionState?.turns.length ?? 0;
	const indexedCount = activeTurnIndex.length;
	if (!sessionId || loadedCount < 2 || indexedCount >= loadedCount) return;
	const key = `${sessionId}:${loadedCount}:${indexedCount}`;
	if (lastTurnIndexRefreshKey === key) return;
	lastTurnIndexRefreshKey = key;
	untrack(() => {
		void loadTurnIndex(sessionId, true);
	});
});
$effect(() => {
	if (
		routeView === "session" &&
		routeSessionId &&
		routeSessionId !== "new" &&
		routeSessionId !== activeSessionId
	) {
		prepareRouteSession(routeSessionId);
		const state = sessionStateById[routeSessionId];
		unreadTracker.markViewed(
			routeSessionId,
			state?.session?.lastMessageId ?? null,
		);
		untrack(() => {
			void loadSessionState(routeSessionId);
			void loadTurnIndex(routeSessionId);
		});
		return;
	}
	if (
		(routeView !== "session" || (isDraftNewSessionRoute && activeSessionId)) &&
		activeSessionId
	) {
		sessionWorkspace.activeSessionId = null;
		sessionScroll.pendingRestoreSessionId = null;
		sessionScroll.activeAnchorRestore = null;
		sessionScroll.anchorRestoreWaitingForMarkdown = false;
		userScrollActive = false;
		programmaticScrollActive = false;
		programmaticScrollTarget = null;
		currentTurnSequence = null;
		showTurnBottomSheet = false;
	}
});
$effect(() => {
	const el = listEl;
	if (!el) return;
	const container = el as HTMLDivElement;
	function handleScrollTrack() {
		const isProgrammatic =
			programmaticScrollActive ||
			(programmaticScrollTarget != null &&
				Math.abs(container.scrollTop - programmaticScrollTarget) <= 1);
		if (isProgrammatic) {
			programmaticScrollActive = false;
			programmaticScrollTarget = null;
			updateTimelineScrollMetrics();
			updateAutoFollow();
			updateCurrentTurnSequence();
			scheduleTurnMarkerMeasure();
			return;
		}
		updateTimelineScrollMetrics();
		if (activeSessionId && userScrollActive) {
			captureCurrentScrollAnchor(activeSessionId);
		}
		updateAutoFollow();
		updateCurrentTurnSequence();
		scheduleTurnMarkerMeasure();
	}
	container.addEventListener("wheel", beginUserScroll, { passive: true });
	container.addEventListener("touchstart", beginUserScroll, { passive: true });
	container.addEventListener("touchmove", beginUserScroll, { passive: true });
	container.addEventListener("pointerdown", beginUserScroll, { passive: true });
	container.addEventListener("keydown", handleScrollKeydown);
	container.addEventListener("scroll", handleScrollTrack, { passive: true });
	return () => {
		container.removeEventListener("wheel", beginUserScroll);
		container.removeEventListener("touchstart", beginUserScroll);
		container.removeEventListener("touchmove", beginUserScroll);
		container.removeEventListener("pointerdown", beginUserScroll);
		container.removeEventListener("keydown", handleScrollKeydown);
		container.removeEventListener("scroll", handleScrollTrack);
	};
});
$effect(() => {
	if (!listEl) return;
	const targetId = pendingRestoreSessionId;
	if (!targetId || targetId !== activeSessionId) return;
	const state = sessionStateById[targetId];
	if (!state?.loaded) return;
	const anchor = getSessionScrollAnchor(targetId);
	const hasCachedAnchor =
		anchor &&
		state.turns.some((turn) => turn.sequence * 10 === anchor.sequence);
	const finishRestore = () => {
		sessionScroll.pendingRestoreSessionId = null;
		if (restoringBottomSessionId === targetId) {
			restoringBottomSessionId = null;
		}
		updateAutoFollow();
	};
	const finishAnchorRestore = () => {
		sessionScroll.pendingRestoreSessionId = null;
		if (restoringBottomSessionId === targetId) {
			restoringBottomSessionId = null;
		}
		updateAutoFollow();
		sessionScroll.anchorRestoreWaitingForMarkdown = true;
		requestAnimationFrame(() => {
			maybeCompleteAnchorRestore();
		});
	};
	const restoreToBottom = () => {
		sessionScroll.activeAnchorRestore = null;
		sessionScroll.anchorRestoreWaitingForMarkdown = false;
		restoringBottomSessionId = targetId;
		sessionScroll.shouldAutoFollow = true;
		requestAnimationFrame(() => {
			if (!listEl || activeSessionId !== targetId) {
				finishRestore();
				return;
			}
			scrollToBottomNow();
			finishRestore();
		});
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
			sessionScroll.activeAnchorRestore = {
				sessionId: targetId,
				sequence: anchor.sequence,
				offset: anchor.offset,
				updatedAt: anchor.updatedAt,
			};
			requestAnimationFrame(() => {
				if (!listEl || activeSessionId !== targetId) {
					finishAnchorRestore();
					return;
				}
				if (!applyActiveAnchorRestore(activeAnchorRestore)) {
					clearSessionScrollAnchor(targetId);
					restoreToBottom();
					return;
				}
				finishAnchorRestore();
			});
		});
	};
	void tick().then(() => restoreByAnchor());
});
$effect(() => {
	const sessionId = activeSessionId;
	if (!sessionId) return;
	const state = sessionStateById[sessionId];
	if (!state?.loaded && !state?.loading) {
		untrack(() => {
			void loadSessionState(sessionId);
		});
	}
});
$effect(() => {
	const filePath = routeView === "file" ? routeFilePath : null;
	const key = filePath ? `${spaceId}:${activeFsSourceKey}:${filePath}` : "";
	if (!key) {
		if (!appliedRouteFileKey) return;
		appliedRouteFileKey = "";
		untrack(() => fileWorkspace.clearRouteFile());
		return;
	}
	if (appliedRouteFileKey === key) return;
	appliedRouteFileKey = key;
	if (!filePath) return;
	const targetFilePath = filePath;
	untrack(() => {
		void openFileFromUrl(targetFilePath);
	});
});
$effect(() => {
	const sourceKey = activeFsSourceKey;
	if (sourceKey === appliedFsSourceKey) return;
	appliedFsSourceKey = sourceKey;
	untrack(() => {
		fileWorkspace.switchSource(sourceKey);
		canvasPreview.closeCanvas();
	});
});
$effect(() => {
	if (routeView === "checkpoint-new") {
	}
});
$effect(() => {
	if (routeView === "task" && routeTaskId) {
		if (taskRunDetail?.id !== routeTaskId) taskRunDetail = null;
		return;
	}
	taskRunDetail = null;
});
$effect(() => {
	const el = composerHostEl;
	if (!el) {
		sessionScroll.composerHeight = 0;
		return;
	}
	const updateComposerHeight = () => {
		sessionScroll.composerHeight = el.offsetHeight;
	};
	updateComposerHeight();
	const ro = new ResizeObserver(() => updateComposerHeight());
	ro.observe(el);
	return () => ro.disconnect();
});
$effect(() => {
	if (!listEl || !activeSessionId) return;
	requestAnimationFrame(() => {
		updateTimelineScrollMetrics();
		updateAutoFollow();
	});
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
			requestBottomFollow();
		}
		prevHeight = currentHeight;
		updateTimelineScrollMetrics();
		updateAutoFollow();
	});
	ro.observe(el);
	return () => ro.disconnect();
});
</script>

<svelte:head>
	<title>{browserTabTitle}</title>
</svelte:head>

{#snippet FileHeaderCoreActions(path: string)}
	<div class="relative shrink-0" data-resource-actions>
		<button
			type="button"
			class="icon-btn"
			onclick={(event) => {
				event.stopPropagation();
				fileWorkspace.fileActionMenuOpenPath = fileWorkspace.fileActionMenuOpenPath === path ? null : path;
			}}
			title="More actions"
			aria-haspopup="menu"
			aria-expanded={fileWorkspace.fileActionMenuOpenPath === path}
		>
			<MoreHorizontal class="w-4 h-4" />
		</button>
		{#if fileWorkspace.fileActionMenuOpenPath === path}
			<div
				class="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-md border border-border-subtle bg-bg-primary py-1 shadow-lg"
				role="menu"
			>
				<button
					type="button"
					class="menu-item"
					onclick={() => {
						void editResourceLabels("file", path);
						fileWorkspace.fileActionMenuOpenPath = null;
					}}
					role="menuitem"
				>
					<ListTree class="w-3.5 h-3.5" />
					<span>Label as…</span>
				</button>
				<button
					type="button"
					class="menu-item"
					onclick={() => {
						insertFilePathReference(path);
						fileWorkspace.fileActionMenuOpenPath = null;
					}}
					role="menuitem"
				>
					<TextCursorInput class="w-3.5 h-3.5" />
					<span>Insert reference</span>
				</button>
				<button
					type="button"
					class="menu-item"
					onclick={() => {
						void handleDownloadNode(getFileActionNode(path));
						fileWorkspace.fileActionMenuOpenPath = null;
					}}
					role="menuitem"
				>
					<Download class="w-3.5 h-3.5" />
					<span>Download</span>
				</button>
				{#if canEditFiles && !activeFsReadonly}
					<button
						type="button"
						class="menu-item"
						onclick={() => {
							void handleRenameNode(getFileActionNode(path));
							fileWorkspace.fileActionMenuOpenPath = null;
						}}
						role="menuitem"
					>
						<Pencil class="w-3.5 h-3.5" />
						<span>Rename</span>
					</button>
					<button
						type="button"
						class="menu-item danger"
						onclick={() => {
							void handleDeleteNode(getFileActionNode(path));
							fileWorkspace.fileActionMenuOpenPath = null;
						}}
						role="menuitem"
					>
						<Trash2 class="w-3.5 h-3.5" />
						<span>Delete</span>
					</button>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet PreviewFocusButton()}
	{#if !isMobile}
		<button
			type="button"
			class="icon-btn"
			onclick={() => void togglePreviewFocusMode()}
			title={previewFocusMode ? "Exit preview focus" : "Focus preview"}
			aria-label={previewFocusMode ? "Exit preview focus" : "Focus preview"}
		>
			{#if previewFocusMode}
				<Minimize2 class="w-4 h-4" />
			{:else}
				<Maximize2 class="w-4 h-4" />
			{/if}
		</button>
	{/if}
{/snippet}

{#snippet PanelLoadingState(label: string, compact = false)}
	<CenteredLoading label={label} size={compact ? "compact" : "panel"} />
{/snippet}

{#snippet UserMetaItem(profile: UserProfile | null | undefined, userUuid: string | null | undefined)}
	{#if userUuid}
		<span class="inline-flex min-w-0 max-w-full items-center gap-1.5 text-[11px] text-text-tertiary" title={userTitle(profile, userUuid)}>
			<UserAvatar name={displayUserName(profile, userUuid)} avatarUrl={profile?.avatarUrl} size="xxs" class="border-0 bg-bg-elevated" />
			<span class="min-w-0 truncate">{displayUserName(profile, userUuid)}</span>
		</span>
	{/if}
{/snippet}

{#snippet CopyIdMetaItem(id: string, copied: boolean, onCopy: () => void, label = "Copy ID")}
	<button
		type="button"
		class="inline-flex min-h-6 min-w-0 max-w-full items-center gap-1.5 font-mono text-[11px] text-text-placeholder transition-colors hover:text-text-secondary"
		onclick={onCopy}
		title={label}
	>
		<span class="truncate">{id}</span>
		{#if copied}
			<Check class="h-3 w-3 shrink-0 text-success-soft" />
		{:else}
			<Copy class="h-3 w-3 shrink-0" />
		{/if}
	</button>
{/snippet}

{#snippet NewChatSpaceProfile()}
	{@const spaceName = space?.name || space?.title || "Untitled space"}
	{@const owner = space?.ownerProfile ?? null}
	{@const sortedMembers = sortedSpaceMembersForProfile()}
	<section class="new-chat-profile-panel pointer-events-auto mx-auto w-full max-w-4xl px-4 pt-[clamp(1.25rem,5dvh,2.5rem)] pb-4 sm:px-6 sm:pt-[clamp(2.25rem,7dvh,4.5rem)] sm:pb-6" class:expanded={newChatProfileExpanded} aria-label="Space profile">
		<div bind:this={newChatProfileContentEl} class="space-y-5 sm:space-y-7">
			<header class="new-chat-profile-fragment space-y-3.5 sm:space-y-4" style:animation-delay="20ms">
				<div class="flex items-start gap-3 sm:gap-4">
						<SpaceAvatar name={spaceName} profile={space?.publicProfile} size="lg" loading="eager" class="mt-0.5 h-10 w-10 rounded-[12px] sm:mt-1 sm:h-12 sm:w-12 sm:rounded-[14px]" />
						<div class="min-w-0 flex-1 pt-0.5">
							<div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
								<h1 class="min-w-0 max-w-full break-words text-[23px] font-semibold leading-[1.08] tracking-[-0.035em] text-text-primary sm:text-[34px]">{spaceName}</h1>
								{#if spaceSandboxLoadedFor === spaceId}
									<span class="sandbox-breathing-status" data-kind={sandboxStatusKind(spaceSandbox)} title={sandboxStatusLabel(spaceSandbox)} aria-label={sandboxStatusLabel(spaceSandbox)}></span>
								{/if}
							</div>
							{#if space?.createdAt}
								<div class="mt-2 font-mono text-[10px] text-text-placeholder sm:text-[11px]">Created {formatShortDateTime(space.createdAt)}</div>
							{/if}
						</div>
					</div>
			</header>

			<div
					bind:this={newChatProfileBodyEl}
					class="new-chat-profile-body new-chat-profile-fragment max-w-[68ch] text-[13px] leading-7 text-text-tertiary sm:text-[14px]"
					class:expanded={newChatProfileExpanded}
					style:animation-delay="55ms"
					style:max-height={newChatProfileExpanded ? undefined : `${newChatProfileBodyMaxHeight}px`}
				>
				{#if space?.description}
					<p class="mb-3 text-text-secondary sm:text-[15px]">
						{space.description}
					</p>
				{/if}
				{#if owner || space?.userUuid || sortedMembers.length > 0}
					<p class="mb-3">
							{#if owner || space?.userUuid}
								<span>Created by </span>
								<span class="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle text-text-secondary" title={userTitle(owner, space?.userUuid)}>
									<UserAvatar name={displayUserName(owner, space?.userUuid)} avatarUrl={owner?.avatarUrl} size="xs" class="h-[18px] w-[18px] border-0 bg-bg-elevated sm:h-5 sm:w-5" />
									<span class="min-w-0 max-w-[9rem] truncate font-medium text-text-primary sm:max-w-none">{displayUserName(owner, space?.userUuid)}</span>
								</span>
							{/if}
							{#if sortedMembers.length > 0}
								<span>{owner || space?.userUuid ? ' with ' : 'Members include '}</span>
								{#each sortedMembers as member, index (member.userId)}
									<span class="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle text-text-secondary" title={userTitle(member.profile, member.userId)}>
										<UserAvatar name={displayUserName(member.profile, member.userId)} avatarUrl={member.profile.avatarUrl} size="xs" class="h-[18px] w-[18px] border-0 bg-bg-elevated sm:h-5 sm:w-5" />
										<span class="min-w-0 max-w-[9rem] truncate font-medium sm:max-w-none">{displayUserName(member.profile, member.userId)}</span>
									</span>{#if index < sortedMembers.length - 1}<span class="inline-block w-1.5 sm:w-2" aria-hidden="true"></span>{:else}<span>. </span>{/if}
								{/each}
							{:else}<span>. </span>{/if}
						</p>
				{/if}
				{#if spaceUsage}
					<p>
						Over the last {spaceUsage.days} days, this Space used <span class="font-mono text-text-secondary">{formatTokenCount(spaceUsage.summary.totalTokens)}</span> tokens across <span class="font-mono text-text-secondary">{spaceUsage.summary.requestCount}</span> requests, totaling <span class="font-mono text-text-secondary">{formatUsageCost(spaceUsage.summary.costTotal)}</span>.
					</p>
				{/if}
			</div>
			{#if newChatProfileCanExpand}
				<button
					type="button"
					class="new-chat-profile-expand new-chat-profile-fragment mt-5 text-[12px] text-text-placeholder transition-colors hover:text-text-secondary sm:hidden"
					style:animation-delay="120ms"
					onclick={() => {
						newChatProfileExpanded = !newChatProfileExpanded;
					}}
					aria-expanded={newChatProfileExpanded}
				>
					{newChatProfileExpanded ? 'Show less' : 'Show full profile'}
				</button>
			{/if}
		</div>
	</section>
{/snippet}

<PageHeader>
  {#snippet left()}
    <div class="flex items-center gap-1.5 min-w-0 overflow-hidden">
      {#if routeView === "session" && (activeSessionState?.session || isNewSessionRoute)}
        <button
          type="button"
          class="inline-flex shrink-0 items-center text-text-primary transition-colors hover:text-text-secondary lg:hidden"
          title={space?.name || space?.title || spaceId}
          aria-label="Open space"
        >
          <SpaceAvatar name={space?.name || space?.title || spaceId} profile={space?.publicProfile} size="xs" />
        </button>
        <div class="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden">
          {#if sessionRenaming && activeSessionState?.session}
            <input
              bind:this={sessionRenameInputEl}
              bind:value={sessionRenameValue}
              type="text"
              class="min-w-0 flex-1 bg-bg-hover-strong text-[13px] text-text-primary outline-none rounded px-1 py-0.5 leading-tight max-w-[40vw]"
              placeholder="Session name"
              maxlength={80}
              disabled={sessionRenameSaving}
              onkeydown={(e) => {
                if (
                  e.key === "Enter" &&
                  !sessionRenameSaving &&
                  !isComposingKeyboardEvent(e)
                ) {
                  e.preventDefault();
                  void submitSessionRename();
                }
                if (e.key === "Escape" && !sessionRenameSaving) {
                  e.preventDefault();
                  cancelSessionRename();
                }
              }}
            />
            <button
              type="button"
              class="p-0.5 rounded text-status-running hover:bg-bg-hover transition-colors shrink-0"
              disabled={sessionRenameSaving}
              onclick={() => void submitSessionRename()}
              title="Save"
            >
              <Check class="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
              disabled={sessionRenameSaving}
              onclick={cancelSessionRename}
              title="Cancel"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          {:else}
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-[13px] text-text-secondary hover:text-text-primary transition-colors"
              onclick={activeSessionState?.session ? startSessionRename : undefined}
              title={activeSessionState?.session ? "Click to rename" : "New chat"}
            >
              {activeSessionState?.session ? getSessionTitle(activeSessionState.session) : "New chat"}
            </button>
            {#if activeSessionState?.loading && activeSessionState.loaded}
              <Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin text-text-placeholder" aria-label="Syncing" />
            {/if}
            {#if wsConnectionState === 'reconnecting'}
              <span class="inline-flex shrink-0 items-center text-[12px] text-warning">
                Reconnecting...
              </span>
            {/if}
          {/if}
        </div>
      {:else if routeView === "checkpoint" && checkpointDetail}
        <button
          type="button"
          class="inline-flex shrink-0 items-center text-text-primary transition-colors hover:text-text-secondary lg:hidden"
          title={space?.name || space?.title || spaceId}
          aria-label="Open space"
        ><SpaceAvatar name={space?.name || space?.title || spaceId} profile={space?.publicProfile} size="xs" /></button>
        <span class="min-w-0 truncate text-[13px] text-text-secondary">{checkpointDetail.description ? checkpointDetail.description.slice(0, 36) : 'Checkpoint'}</span>

      {:else if routeView === "checkpoint-new"}
        <button
          type="button"
          class="inline-flex shrink-0 items-center text-text-primary transition-colors hover:text-text-secondary lg:hidden"
          title={space?.name || space?.title || spaceId}
          aria-label="Open space"
        ><SpaceAvatar name={space?.name || space?.title || spaceId} profile={space?.publicProfile} size="xs" /></button>
        <span class="min-w-0 truncate text-[13px] text-text-secondary">New save</span>
      {:else if routeView === "cronjob" && cronjobDetail}
        <button
          type="button"
          class="inline-flex shrink-0 items-center text-text-primary transition-colors hover:text-text-secondary lg:hidden"
          title={space?.name || space?.title || spaceId}
          aria-label="Open space"
        ><SpaceAvatar name={space?.name || space?.title || spaceId} profile={space?.publicProfile} size="xs" /></button>
        <span class="min-w-0 truncate text-[13px] text-text-secondary">{cronjobDetail.title}</span>

      {:else if routeView === "cronjob-new"}
        <button
          type="button"
          class="inline-flex shrink-0 items-center text-text-primary transition-colors hover:text-text-secondary lg:hidden"
          title={space?.name || space?.title || spaceId}
          aria-label="Open space"
        ><SpaceAvatar name={space?.name || space?.title || spaceId} profile={space?.publicProfile} size="xs" /></button>
        <span class="min-w-0 truncate text-[13px] text-text-secondary">New cronjob</span>
      {:else if routeView === "task" && taskRunDetail}
        <button
          type="button"
          class="inline-flex shrink-0 items-center text-text-primary transition-colors hover:text-text-secondary lg:hidden"
          title={space?.name || space?.title || spaceId}
          aria-label="Open space"
        ><SpaceAvatar name={space?.name || space?.title || spaceId} profile={space?.publicProfile} size="xs" /></button>
        <span class="min-w-0 truncate text-[13px] text-text-secondary">{taskTypeLabel(taskRunDetail.taskType)}</span>
      {:else}
        <button
          type="button"
          class="inline-flex min-w-0 items-center gap-1.5 truncate text-left text-[13px] text-text-primary transition-colors hover:text-text-secondary"
        ><SpaceAvatar name={space?.name || space?.title || spaceId} profile={space?.publicProfile} size="xs" />{space?.name || space?.title || spaceId}</button>
      {/if}
    </div>
  {/snippet}
  {#snippet right()}
    <!-- Session Share -->
    {#if activeSessionId && canManageSessionAccess}
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
    {#if hasResourceActions()}
      <div class="relative" data-resource-actions>
        <button
          type="button"
          class="flex items-center justify-center w-8 h-8 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
          onclick={(event) => {
            event.stopPropagation();
            resourceActionMenuOpen = !resourceActionMenuOpen;
          }}
          title="More actions"
          aria-haspopup="menu"
          aria-expanded={resourceActionMenuOpen}
        >
          <MoreHorizontal class="w-4 h-4 shrink-0" />
        </button>
        {#if resourceActionMenuOpen}
          <div class="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-md border border-border-subtle bg-bg-primary py-1 shadow-lg" role="menu">
            <button
              type="button"
              class="menu-item"
              onclick={() => {
                const filePath = getHeaderFileActionPath();
                if (filePath) void editResourceLabels("file", filePath);
                else if (activeSessionState?.session) void editResourceLabels("session", activeSessionState.session.id);
                closeResourceActionMenu();
              }}
              role="menuitem"
            >
              <ListTree class="w-3.5 h-3.5" />
              <span>Label as…</span>
            </button>
            <button type="button" class="menu-item" onclick={insertHeaderReference} role="menuitem">
              <TextCursorInput class="w-3.5 h-3.5" />
              <span>Insert reference</span>
            </button>
          </div>
        {/if}
      </div>
    {/if}
    <!-- Toggle right sidebar -->
    {#if !spaceHasMinimalAccess}
      <div class="relative">
        <button
          type="button"
          class="flex items-center gap-1.5 px-2 h-8 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
          onclick={() => void toggleRightSidebar()}
          title={uiState.rightSidebarCollapsed ? "Show files" : "Hide files"}
        >
          {#if uiState.rightSidebarCollapsed}
            <PanelRightOpen class="w-4 h-4 shrink-0" />
          {:else}
            <PanelRightClose class="w-4 h-4 shrink-0" />
          {/if}
        </button>
      </div>
    {/if}
  {/snippet}
</PageHeader>
{#if portReadyToast}
	<PortReadyToastView
		port={portReadyToast.port}
		url={portReadyToast.url}
		onPreview={previewPortFromToast}
		onClose={closePortReadyToast}
	/>
{/if}
<div bind:this={workspaceBodyEl} class="relative flex-1 min-h-0 flex overflow-hidden bg-bg-content">
  <div class="flex-1 flex flex-col min-w-0 bg-bg-content">
    {#if routeView === 'checkpoint-new' || routeView === 'checkpoint'}
      <CheckpointView
        mode={routeView === 'checkpoint-new' ? 'create' : 'detail'}
        {spaceId}
        {space}
        {spaceLoadError}
        {spaceHasMinimalAccess}
        checkpointId={routeCheckpointId}
        onDetailLoaded={(checkpoint) => { checkpointDetail = checkpoint; }}
      />
    {:else if routeView === 'cronjob-new' || routeView === 'cronjob'}
      <CronjobView
        mode={routeView === 'cronjob-new' ? 'create' : 'detail'}
        {spaceId}
        spaceName={space?.name ?? space?.title ?? spaceId}
        {spaceLoadError}
        {spaceHasMinimalAccess}
        cronjobId={routeCronjobId}
        onDetailLoaded={(job) => { cronjobDetail = job; }}
      />
    {:else if routeView === 'work'}
      <WorkView
        {spaceId}
        {routeWorkId}
        ownerUsername={space?.ownerProfile?.username ?? (space?.userUuid === authStore.userUuid ? (authStore.profile?.username ?? null) : null)}
        spaceSlug={space?.slug ?? null}
        onDetailLoaded={(work) => { workDetail = work; }}
      />
    {:else if routeView === 'task'}
      <TaskRunView
        {spaceId}
        taskId={routeTaskId}
        onDetailLoaded={(run) => { taskRunDetail = run; }}
      />
    {:else if fileMode === 'file'}
      <FileWorkspace
        {routeFilePath}
        {openFileLoading}
        {openFileError}
        {openFileTooLarge}
        {openFile}
        {openFileDownloadUrl}
        {openFileDownloadName}
        {openFileIsText}
        {openFileHasRenderedPreview}
        {openFileIsMarkdown}
        {openFileIsHtml}
        {openFileIsImage}
        {openFileIsVideo}
        {openFileDataUrl}
        bind:openFileDraft={fileWorkspace.openFileDraft}
        {openFileExt}
        bind:fileEdit={fileWorkspace.fileEdit}
        {openFileCopied}
        {openFileSaving}
        {fileDirty}
        {canEditFiles}
        {activeFsReadonly}
        bind:fileActionMenuOpenPath={fileWorkspace.fileActionMenuOpenPath}
        bind:openFileZoom={fileWorkspace.openFileZoom}
        bind:openFilePanX={fileWorkspace.openFilePanX}
        bind:openFilePanY={fileWorkspace.openFilePanY}
        openFileDragging={fileWorkspace.openFileDragging}
        {openFilePanHandlers}
        onCloseFile={closeFile}
        onDownloadOpenFile={downloadOpenFile}
        onPublishOpenFile={publishOpenFile}
        onCopyFileContent={copyFileContent}
        onSaveOpenFile={saveOpenFile}
        onLabelFile={(path) => editResourceLabels('file', path)}
        onInsertFilePathReference={insertFilePathReference}
        onDownloadFilePath={(path) => handleDownloadNode(getFileActionNode(path))}
        onRenameFilePath={(path) => handleRenameNode(getFileActionNode(path))}
        onDeleteFilePath={(path) => handleDeleteNode(getFileActionNode(path))}
      />
    {:else}
      <SessionWorkspace
        {spaceId}
        {spaceLoadError}
        {spaceHasMinimalAccess}
        {createSessionError}
        {bootstrapping}
        {activeSessionState}
        {activeSessionInitialLoadingVisible}
        {isNewSessionRoute}
        {canCreateSession}
        {handleCreateNewSession}
        {shouldShowNewChatBackground}
        {newChatBackground}
        {shouldShowNewChatProfile}
        bind:newChatProfileViewportEl
        {newChatProfileExpanded}
        bind:chatTimelineRef={sessionScroll.chatTimelineRef}
        bind:listEl={sessionScroll.listEl}
        {timeline}
        {handleFirstVisible}
        {handleTimelineMarkdownRenderStart}
        {handleTimelineMarkdownRendered}
        {handleForkTurn}
        {forkingTurnId}
        {openInlineFile}
        {modelsCatalog}
        {sessionTaskNotices}
        {sessionTaskHasMore}
        {sessionTaskRecentLoading}
        {handleSessionTaskTrayExpand}
        {handleSessionTaskTrayLoadMore}
        {handleOpenGenerationTaskMedia}
        {followupQueue}
        {turnPreviewText}
        {pendingFollowupActionIds}
        {handleSteerFollowup}
        {handleCancelFollowup}
        {activeTurnRailItems}
        {turnMarkerPositions}
        {turnMarkerHeights}
        {timelineScrollTop}
        {timelineScrollHeight}
        {timelineClientHeight}
        {composerHeight}
        {unloadedOlderTurnCount}
        {unloadedNewerTurnCount}
        {currentTurnSequence}
        {loadingTurnSequence}
        {jumpToTurnAndUpdateUrl}
        {setProgrammaticScrollTop}
        {snapScrollToNearestTurn}
        {activeSessionId}
        {loadOlderTurns}
        {syncSessionNewer}
        {highlightedTurnSequence}
        {hasUnread}
        bind:shouldAutoFollow={sessionScroll.shouldAutoFollow}
        {forceScrollToBottom}
        bind:showTurnBottomSheet
        {loadTurnIndex}
        bind:composerHostEl
        bind:input={sessionComposer.input}
        {sending}
        {activeSessionIsRunning}
        {aborting}
        {composerNotice}
        {composerShowsBillingAction}
        {attachments}
        {activeSessionModel}
        {promptTemplates}
        {promptTemplatesLoaded}
        {handlePickAttachments}
        {handleRemoveAttachment}
        {handleSend}
        {handleAbort}
        {loadModelsCatalog}
        {loadGenerationModelsCatalog}
        bind:showModelSelector
      >
        {#snippet newChatProfile()}
          {@render NewChatSpaceProfile()}
        {/snippet}
      </SessionWorkspace>
    {/if}
  </div>
  {#if inlineFile}
    <InlineFilePanel
      {inlineFile}
      {inlineFileDownloadUrl}
      {inlineFileDownloadName}
      {inlineFileIsText}
      {inlineFileHasRenderedPreview}
      bind:inlineFileEdit={fileWorkspace.inlineFileEdit}
      {inlineFileIsMarkdown}
      {inlineFileIsHtml}
      {inlineFileDirty}
      {activeFsReadonly}
      {canEditFiles}
      {inlineFileCopied}
      {inlineFileExt}
      {inlineFileIsImage}
      {inlineFileIsVideo}
      {inlineFileDataUrl}
      {previewPanelWidth}
      {previewFocusMode}
      {isMobile}
      bind:fileActionMenuOpenPath={fileWorkspace.fileActionMenuOpenPath}
      bind:inlineFileZoom={fileWorkspace.inlineFileZoom}
      bind:inlineFilePanX={fileWorkspace.inlineFilePanX}
      bind:inlineFilePanY={fileWorkspace.inlineFilePanY}
      inlineFileDragging={fileWorkspace.inlineFileDragging}
      {inlineFilePanHandlers}
      onCloseInlineFile={closeInlineFile}
      onDownloadInlineFile={downloadInlineFile}
      onCopyInlineFileContent={copyInlineFileContent}
      onSaveInlineFile={saveInlineFile}
      onPublishInlineFile={publishInlineFile}
      onPreviewResizeStart={beginPreviewPanelResize}
      onTogglePreviewFocusMode={togglePreviewFocusMode}
      onLabelFile={(path) => editResourceLabels('file', path)}
      onInsertFilePathReference={insertFilePathReference}
      onDownloadFilePath={(path) => handleDownloadNode(getFileActionNode(path))}
      onRenameFilePath={(path) => handleRenameNode(getFileActionNode(path))}
      onDeleteFilePath={(path) => handleDeleteNode(getFileActionNode(path))}
    />
  {/if}
  {#if inlineCanvas}
    <CanvasPreviewPanel
      canvas={inlineCanvas}
      width={previewPanelWidth}
      focused={previewFocusMode}
      {isMobile}
      onResizeStart={beginPreviewPanelResize}
      onToggleFocus={togglePreviewFocusMode}
      onCommit={commitInlineCanvas}
      onClose={closeInlineCanvas}
    />
  {/if}
  {#if inlinePortPreview}
    <PortPreviewPanel
      port={inlinePortPreview.port}
      url={inlinePortEndpoint?.url ?? inlinePortPreview.url}
      status={inlinePortEndpoint?.status ?? "unknown"}
      observedAt={inlinePortEndpoint?.observedAt}
      width={previewPanelWidth}
      focused={previewFocusMode}
      {isMobile}
      onResizeStart={beginPreviewPanelResize}
      onToggleFocus={togglePreviewFocusMode}
      onPublish={() => openWorkPublish("port", inlinePortPreview!.port)}
      onClose={closeInlinePort}
    />
  {/if}
  <FilesSidebarPanel
    {spaceId}
    nodes={spaceHasMinimalAccess ? [] : fileTree}
    selectedPath={selectedFilePath}
    loading={!spaceHasMinimalAccess && fileTreeLoading}
    error={spaceHasMinimalAccess ? "Files are not available for this shared session." : fileTreeError}
    subtitle={activeFsSidebarSubtitle}
    activePort={spaceHasMinimalAccess ? null : (inlinePortPreview?.port ?? null)}
    canWrite={!spaceHasMinimalAccess && canEditFiles && !activeFsReadonly}
    showItemActions={!spaceHasMinimalAccess && !activeFsReadonly}
    draggable={!spaceHasMinimalAccess}
    previewEndpoints={spaceHasMinimalAccess ? {} : previewEndpoints}
    desktopCollapsed={uiState.rightSidebarCollapsed}
    desktopWidth={uiState.rightSidebarWidth}
    rightDragOffsetPx={uiState.rightDragOffsetPx}
    rightIsDragging={uiState.rightIsDragging}
    isDrawerVisible={isRightDrawerVisible}
    uploadPaneVisible={fileWorkspace.uploadPaneVisible}
    uploadPaneTargetDir={fileWorkspace.uploadPaneTargetDir}
    pendingUploadFiles={fileWorkspace.pendingUploadFiles}
    pendingUploadEntries={fileWorkspace.pendingUploadEntries}
    onToggle={expandDirectory}
    onSelect={(node, options) => {
      if (node.type === "file") {
        if (isCovasFile(node.path)) void openInlineCanvas(node.path);
        else void openInlineFile(node.path);
        if (options.mobile) uiState.mobileRightDrawerOpen = false;
      }
    }}
    onRefresh={refreshFileTree}
    onCreateFile={handleCreateFile}
    onCreateCanvas={handleCreateCanvas}
    onCreateDir={handleCreateDir}
    onRename={handleRenameNode}
    onDelete={handleDeleteNode}
    onDownload={handleDownloadNode}
    onUpload={handleUploadFiles}
    onInsertReference={insertPathReference}
    onPublishDirectory={(path, options) => {
      openWorkPublish("directory", path);
      if (options.mobile) uiState.mobileRightDrawerOpen = false;
    }}
    onOpenPort={(port, url, options) => {
      openInlinePort(port, url);
      if (options.mobile) uiState.mobileRightDrawerOpen = false;
    }}
    onUploadPaneClose={() => { fileWorkspace.uploadPaneVisible = false; }}
    onUploadComplete={fileWorkspace.handleUploadComplete}
    onResizeStart={beginRightSidebarResize}
  />
  <WorkPublishDialog
    open={Boolean(workPublishTarget)}
    {spaceId}
    ownerUsername={space?.ownerProfile?.username ?? (space?.userUuid === authStore.userUuid ? (authStore.profile?.username ?? null) : null)}
    spaceSlug={space?.slug ?? null}
    targetType={workPublishTarget?.targetType ?? "file"}
    targetRef={workPublishTarget?.targetRef ?? ""}
    onSpaceUpdated={(nextSpace) => {
      space = nextSpace;
      cacheSpaceRecordSoon(nextSpace);
      patchCachedSpaceList((items) => items.map((item) => item.id === spaceId ? nextSpace : item));
    }}
    onClose={() => workPublishTarget = null}
  />
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
    generationModels={generationModelsCatalog ?? []}
    {generationPolicyMode}
    {selectedGenerationModels}
    {generationEnumSelections}
    {generationNumericConstraints}
    {generationBooleanConstraints}
    onGenerationTabOpen={() => { void loadGenerationModelsCatalog(); }}
    onGenerationPolicyModeChange={setGenerationPolicyMode}
    onGenerationModelToggle={setGenerationModelSelected}
    onGenerationEnumValueToggle={setGenerationEnumValueSelected}
    onGenerationNumericConstraintChange={setGenerationNumericConstraint}
    onGenerationBooleanConstraintChange={setGenerationBooleanConstraint}
  />
</div>

{#if labelPickerResource}
	<ResourceLabelPicker
		{spaceId}
		resourceType={labelPickerResource.type}
		resourceRef={labelPickerResource.ref}
		onClose={() => { labelPickerResource = null; }}
	/>
{/if}

<style>
  @keyframes new-chat-profile-fragment-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .new-chat-profile-fragment {
    animation: new-chat-profile-fragment-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  .sandbox-breathing-status {
    display: inline-flex;
    width: 0.48rem;
    height: 0.48rem;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--text-placeholder);
    opacity: 0.72;
    transform: translateY(0.02rem);
  }

  .sandbox-breathing-status[data-kind="running"] {
    background: var(--success-soft);
    animation: sandbox-status-breathe 2.4s ease-in-out infinite;
  }

  .sandbox-breathing-status[data-kind="waking"] {
    background: var(--brand);
    animation: sandbox-status-breathe 1.4s ease-in-out infinite;
  }

  .sandbox-breathing-status[data-kind="sleeping"],
  .sandbox-breathing-status[data-kind="unknown"] {
    background: var(--text-placeholder);
    opacity: 0.5;
  }

  .sandbox-breathing-status[data-kind="error"] {
    background: var(--error-soft);
    opacity: 0.86;
  }

  @keyframes sandbox-status-breathe {
    0%,
    100% {
      opacity: 0.55;
      transform: translateY(0.02rem) scale(0.92);
    }
    50% {
      opacity: 1;
      transform: translateY(0.02rem) scale(1.08);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .new-chat-profile-fragment,
    .sandbox-breathing-status {
      animation: none;
    }
  }

  @media (max-width: 639px) {
    .new-chat-profile-panel {
      max-height: 100%;
      overflow: hidden;
    }

    .new-chat-profile-body {
      overflow: hidden;
      transition: max-height 180ms cubic-bezier(0.22, 1, 0.36, 1);
    }
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
  :global(.right-sidebar-resize-handle) {
    position: absolute;
    top: 0;
    left: -4px;
    width: 8px;
    height: 100%;
    border: none;
    padding: 0;
    cursor: col-resize;
    background: transparent;
    touch-action: none;
    z-index: 10;
  }
  :global(.right-sidebar-resize-handle)::after {
    content: "";
    position: absolute;
    left: 3px;
    top: 0;
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background-color 120ms ease;
  }
  :global(.right-sidebar-resize-handle:hover)::after,
  :global(body.sidebar-resizing .right-sidebar-resize-handle::after) {
    background: var(--border-subtle);
  }
  :global(.inline-panel-resize-handle) {
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
  :global(.inline-panel-resize-handle)::after {
    content: "";
    position: absolute;
    left: 3px;
    top: 0;
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background-color 120ms ease;
  }
  :global(.inline-panel-resize-handle:hover)::after,
  :global(body.sidebar-resizing .inline-panel-resize-handle::after) {
    background: var(--border-subtle);
  }
  :global(.port-ready-toast) {
    position: fixed;
    left: 50%;
    top: 58px;
    z-index: 80;
    display: flex;
    max-width: min(680px, calc(100vw - 24px));
    min-width: min(520px, calc(100vw - 24px));
    transform: translateX(-50%);
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    border-radius: 10px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    padding: 9px 10px 9px 12px;
    box-shadow: 0 10px 30px color-mix(in srgb, var(--overlay-scrim-strong) 18%, transparent);
  }
  :global(.port-ready-action) {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: transparent;
    padding: 0 8px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
    transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
  }
  :global(.port-ready-action:hover) {
    border-color: var(--border-strong);
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  :global(.port-ready-action.primary) {
    border-color: color-mix(in srgb, var(--brand) 35%, var(--border-subtle));
    background: color-mix(in srgb, var(--brand) 12%, transparent);
    color: var(--brand);
  }
  :global(.port-ready-action.primary:hover) {
    border-color: color-mix(in srgb, var(--brand) 55%, var(--border-subtle));
    background: color-mix(in srgb, var(--brand) 18%, transparent);
  }
  :global(.port-ready-close) {
    display: inline-flex;
    height: 28px;
    width: 28px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }
  :global(.port-ready-close:hover) {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
  @media (max-width: 640px) {
    :global(.port-ready-toast) {
      left: 12px;
      right: 12px;
      top: 52px;
      min-width: 0;
      max-width: none;
      transform: none;
      align-items: stretch;
      flex-direction: column;
      gap: 8px;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    :global(.port-ready-toast) {
      animation: port-ready-toast-enter 140ms ease-out;
    }
  }
  @keyframes port-ready-toast-enter {
    from {
      opacity: 0;
      transform: translate(-50%, -4px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
  @media (max-width: 640px) and (prefers-reduced-motion: no-preference) {
    @keyframes port-ready-toast-enter {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  }
  /* File viewer */
  :global(.icon-btn) {
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
  :global(.icon-btn:hover) { background: var(--bg-hover); color: var(--text-secondary); }
  :global(.action-btn) {
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
  :global(.action-btn:disabled) { opacity: 0.5; cursor: not-allowed; }
  :global(.action-btn.primary) {
    background: var(--brand);
    border-color: var(--brand);
    color: var(--brand-contrast-fg);
  }
  :global(.action-btn.primary:hover) { opacity: 0.9; }
  :global(.menu-item) {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  :global(.menu-item:hover) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  :global(.menu-item.danger) {
    color: var(--error-soft);
  }
  :global(.menu-item.danger:hover) {
    background: var(--error-bg);
    color: var(--error-soft);
  }
  :global(.toggle-btn) {
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
  :global(.toggle-btn:hover) { background: var(--bg-hover); color: var(--text-secondary); }
  :global(.toggle-btn.active) {
    border-color: var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  :global(.segmented-btn) {
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
  :global(.segmented-btn:hover) { color: var(--text-secondary); }
  :global(.segmented-btn.active) {
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 1px rgba(0,0,0,0.04);
  }
  :global(.zoom-btn) {
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
  :global(.zoom-btn:hover) { background: var(--bg-hover); color: var(--text-secondary); }
</style>
