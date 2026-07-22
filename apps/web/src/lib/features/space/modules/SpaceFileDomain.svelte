<script lang="ts">
import type {
	SpacePublicEndpoint,
	SpacePublicEndpoints,
} from "@cohub/protocol/ports";
import type {
	CanvasSemanticOp,
	SpacePendingDiffFileResponse,
	SpaceRecord,
	WorkRecord,
} from "@neta-art/cohub";
import { isCovasFile } from "$lib/canvas/canvas-file";
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import type { FileViewMode } from "$lib/components/file-diff-view";
import PreviewExpandMenu from "$lib/components/PreviewExpandMenu.svelte";
import WorkPublishDialog from "$lib/components/WorkPublishDialog.svelte";
import WorkspacePreviewPane from "$lib/components/WorkspacePreviewPane.svelte";
import type { SpaceFsNode } from "$lib/space-fs";
import { patchCachedSpaceList } from "$lib/stores/space-list-cache";
import { cacheSpaceRecordSoon } from "$lib/stores/space-record-cache";
import type { LocalUploadEntry } from "$lib/upload-entries";
import type { WorkspaceFileLinkTarget } from "$lib/workspace-file-links";
import CanvasPreviewPanel from "./CanvasPreviewPanel.svelte";
import type { InlineCanvasPanelState } from "./canvas-preview-controller.svelte";
import FilesSidebarPanel from "./FilesSidebarPanel.svelte";
import type { FileWorkspaceInlineFile } from "./file-workspace-controller.svelte";
import InlineFilePanel from "./InlineFilePanel.svelte";
import PortPreviewPanel from "./PortPreviewPanel.svelte";
import PreviewTabs from "./PreviewTabs.svelte";

type PanHandlers = {
	start: (event: MouseEvent) => void;
};

type PublishTarget = {
	targetType: "file" | "directory" | "port";
	targetRef: string;
} | null;

export type SpaceFileDomainProps = {
	spaceId: string;
	spaceOwnerUsername: string | null;
	spaceSlug: string | null;
	spaceHasMinimalAccess: boolean;
	activeFsReadonly: boolean;
	canEditFiles: boolean;
	activeFsSidebarSubtitle: string;
	isMobile: boolean;
	isRightDrawerVisible: boolean;
	previewPanelWidth: number;
	previewFocusMode: boolean;
	previewImmersiveMode: boolean;
	immersiveChatVisible: boolean;
	rightSidebarCollapsed: boolean;
	rightSidebarWidth: number;
	rightDragOffsetPx: number;
	rightIsDragging: boolean;
	fileTree: SpaceFsNode[];
	fileTreeLoading: boolean;
	fileTreeError: string | null;
	selectedFilePath: string;
	inlineFile: FileWorkspaceInlineFile | null;
	inlineFileTabs: FileWorkspaceInlineFile[];
	activeInlineFilePath: string | null;
	inlineFileCanGoBack: boolean;
	inlineCanvas: InlineCanvasPanelState | null;
	inlineCanvasTabs: InlineCanvasPanelState[];
	activeInlineCanvasPath: string | null;
	inlinePortPreview: { port: string; url: string } | null;
	inlinePortTabs: { port: string; url: string }[];
	activeInlinePort: string | null;
	activePreviewKind: "file" | "canvas" | "port" | null;
	inlinePortEndpoint: SpacePublicEndpoint | null;
	previewEndpoints: SpacePublicEndpoints;
	inlineFileDownloadUrl: string;
	inlineFileDownloadName: string;
	inlineFileIsText: boolean;
	inlineFileHasRenderedPreview: boolean;
	inlineFileViewMode: FileViewMode;
	inlineFileDiff: SpacePendingDiffFileResponse | null;
	inlineFileDiffLoading: boolean;
	inlineFileDiffError: string | null;
	inlineFileIsMarkdown: boolean;
	inlineFileIsHtml: boolean;
	inlineFileCopied: boolean;
	inlineFileExt: string;
	inlineFileIsImage: boolean;
	inlineFileIsVideo: boolean;
	inlineFileDataUrl: string | null;
	inlineFileWork: WorkRecord | null;
	fileActionMenuOpenPath: string | null;
	inlineFileZoom: number;
	inlineFilePanX: number;
	inlineFilePanY: number;
	inlineFileDragging: boolean;
	inlineFilePanHandlers: PanHandlers;
	uploadPaneVisible: boolean;
	uploadPaneTargetDir: string;
	pendingUploadFiles: File[];
	pendingUploadEntries: LocalUploadEntry[];
	workPublishTarget: PublishTarget;
	onSpaceUpdated: (space: SpaceRecord) => void;
	onMobileRightDrawerClose: () => void;
	onSetUploadPaneVisible: (visible: boolean) => void;
	onToggleDirectory: (node: SpaceFsNode) => void | Promise<void>;
	onRefreshFileTree: () => void | Promise<void>;
	onCreateFile: (parentPath: string) => void | Promise<void>;
	onCreateCanvas: (parentPath: string) => void | Promise<void>;
	onCreateDir: (parentPath: string) => void | Promise<void>;
	onRenameNode: (node: SpaceFsNode) => void | Promise<void>;
	onMoveNode: (node: SpaceFsNode, targetDir: string) => void | Promise<void>;
	onDeleteNode: (node: SpaceFsNode) => void | Promise<void>;
	onDownloadNode: (node: SpaceFsNode) => void | Promise<void>;
	onUploadFiles: (
		files: File[] | LocalUploadEntry[],
		targetDir: string,
	) => void;
	onInsertPathReference: (path: string) => void;
	onOpenInlineFile: (path: string) => void | Promise<void>;
	onOpenLinkedInlineFile: (
		target: string | WorkspaceFileLinkTarget,
	) => void | Promise<void>;
	onOpenInlineCanvas: (path: string) => void | Promise<void>;
	onCloseInlineFile: () => void;
	onActivateInlineFile: (path: string) => void;
	onCloseInlineFileTab: (path: string) => void;
	onActivateInlineCanvas: (path: string) => void;
	onCloseInlineCanvasTab: (path: string) => void;
	onActivateInlinePort: (port: string) => void;
	onCloseInlinePortTab: (port: string) => void;
	onBackInlineFile: () => void | Promise<void>;
	onDownloadInlineFile: () => void | Promise<void>;
	onRetryInlineFile?: () => void | Promise<void>;
	onCopyInlineFileContent: () => void | Promise<void>;
	onUpdateInlineFileDraft: (path: string, draft: string) => void;
	onRetryInlineFileSave: () => void | Promise<void>;
	onOverwriteInlineFile: () => void | Promise<void>;
	onReloadInlineFile: () => void | Promise<void>;
	onOpenInlinePort: (port: string, url: string) => void;
	onCommitInlineCanvas: (
		document: CovasDocument,
		ops: CanvasSemanticOp[],
	) => void | Promise<void>;
	onRetryInlineCanvasSave: () => void | Promise<void>;
	onBeginPreviewPanelResize: (event: PointerEvent) => void;
	onTogglePreviewFocusMode: () => void | Promise<void>;
	onTogglePreviewImmersiveMode: () => void | Promise<void>;
	onToggleImmersiveChat: () => void;
	onBeginRightSidebarResize: (event: PointerEvent) => void;
	treeVisible?: boolean;
	onToggleTree?: () => void;
	onEditResourceLabels: (
		type: "file",
		path: string,
		anchorEl?: HTMLElement | null,
	) => void | Promise<void>;
	onInsertFilePathReference: (path: string) => void;
	onGetFileActionNode: (path: string) => SpaceFsNode;
	onUploadComplete: () => void | Promise<void>;
	onOpenWorkPublish: (type: "file" | "directory" | "port", ref: string) => void;
	onCloseWorkPublish: () => void;
	onVisibleLinesChange?: (
		path: string,
		range: { start: number; end: number } | null,
	) => void;
	onCanvasViewStateChange?: (state: {
		path: string;
		camera: CovasDocument["viewport"];
		visibleRect: {
			x: number;
			y: number;
			width: number;
			height: number;
		} | null;
		selectedNodes: Array<{ id: string; type: string; title?: string }>;
	}) => void;
};

let {
	spaceId,
	spaceOwnerUsername,
	spaceSlug,
	spaceHasMinimalAccess,
	activeFsReadonly,
	canEditFiles,
	activeFsSidebarSubtitle,
	isMobile,
	isRightDrawerVisible,
	previewPanelWidth,
	previewFocusMode,
	previewImmersiveMode,
	immersiveChatVisible,
	rightSidebarCollapsed,
	rightSidebarWidth,
	rightDragOffsetPx,
	rightIsDragging,
	fileTree,
	fileTreeLoading,
	fileTreeError,
	selectedFilePath,
	inlineFile,
	inlineFileTabs,
	activeInlineFilePath,
	inlineFileCanGoBack,
	inlineCanvas,
	inlineCanvasTabs,
	activeInlineCanvasPath,
	inlinePortPreview,
	inlinePortTabs,
	activeInlinePort,
	activePreviewKind,
	inlinePortEndpoint,
	previewEndpoints,
	inlineFileDownloadUrl,
	inlineFileDownloadName,
	inlineFileIsText,
	inlineFileHasRenderedPreview,
	inlineFileViewMode = $bindable(),
	inlineFileDiff,
	inlineFileDiffLoading,
	inlineFileDiffError,
	inlineFileIsMarkdown,
	inlineFileIsHtml,
	inlineFileCopied,
	inlineFileExt,
	inlineFileIsImage,
	inlineFileIsVideo,
	inlineFileDataUrl,
	inlineFileWork,
	fileActionMenuOpenPath = $bindable(),
	inlineFileZoom = $bindable(),
	inlineFilePanX = $bindable(),
	inlineFilePanY = $bindable(),
	inlineFileDragging,
	inlineFilePanHandlers,
	uploadPaneVisible,
	uploadPaneTargetDir,
	pendingUploadFiles,
	pendingUploadEntries,
	workPublishTarget = $bindable(),
	onSpaceUpdated,
	onMobileRightDrawerClose,
	onSetUploadPaneVisible,
	onToggleDirectory,
	onRefreshFileTree,
	onCreateFile,
	onCreateCanvas,
	onCreateDir,
	onRenameNode,
	onMoveNode,
	onDeleteNode,
	onDownloadNode,
	onUploadFiles,
	onInsertPathReference,
	onOpenInlineFile,
	onOpenLinkedInlineFile,
	onOpenInlineCanvas,
	onCloseInlineFile,
	onActivateInlineFile,
	onCloseInlineFileTab,
	onActivateInlineCanvas,
	onCloseInlineCanvasTab,
	onActivateInlinePort,
	onCloseInlinePortTab,
	onBackInlineFile,
	onDownloadInlineFile,
	onRetryInlineFile,
	onCopyInlineFileContent,
	onUpdateInlineFileDraft,
	onRetryInlineFileSave,
	onOverwriteInlineFile,
	onReloadInlineFile,
	onOpenInlinePort,
	onCommitInlineCanvas,
	onRetryInlineCanvasSave,
	onBeginPreviewPanelResize,
	onTogglePreviewFocusMode,
	onTogglePreviewImmersiveMode,
	onToggleImmersiveChat,
	onBeginRightSidebarResize,
	treeVisible = true,
	onToggleTree,
	onEditResourceLabels,
	onInsertFilePathReference,
	onGetFileActionNode,
	onUploadComplete,
	onOpenWorkPublish,
	onCloseWorkPublish,
	onVisibleLinesChange,
	onCanvasViewStateChange,
}: SpaceFileDomainProps = $props();

function closeMobileDrawerIfNeeded(mobile: boolean) {
	if (mobile) onMobileRightDrawerClose();
}

function publishInlineFile() {
	if (inlineFile?.response) onOpenWorkPublish("file", inlineFile.response.path);
}

function handleSpaceUpdated(nextSpace: SpaceRecord) {
	onSpaceUpdated(nextSpace);
	cacheSpaceRecordSoon(nextSpace);
	patchCachedSpaceList((items) =>
		items.map((item) => (item.id === spaceId ? nextSpace : item)),
	);
}
const previewTabs = $derived([
	...inlineFileTabs.map((tab) => ({
		kind: "file" as const,
		key: tab.path,
		label: tab.response?.name ?? tab.path.split("/").pop() ?? tab.path,
		title: tab.path,
		syncStatus: tab.syncStatus,
		active: activePreviewKind === "file" && tab.path === activeInlineFilePath,
	})),
	...inlineCanvasTabs.map((tab) => ({
		kind: "canvas" as const,
		key: tab.path,
		label: tab.path.split("/").pop() ?? tab.path,
		title: tab.path,
		syncStatus: tab.saveError
			? ("error" as const)
			: tab.saving
				? ("saving" as const)
				: ("idle" as const),
		active:
			activePreviewKind === "canvas" && tab.path === activeInlineCanvasPath,
	})),
	...inlinePortTabs.map((tab) => ({
		kind: "port" as const,
		key: tab.port,
		label: `:${tab.port}`,
		title: tab.url,
		syncStatus: "idle" as const,
		active: activePreviewKind === "port" && tab.port === activeInlinePort,
	})),
]);

function activatePreviewTab(kind: "file" | "canvas" | "port", key: string) {
	if (kind === "file") onActivateInlineFile(key);
	else if (kind === "canvas") onActivateInlineCanvas(key);
	else onActivateInlinePort(key);
}

function closePreviewTab(kind: "file" | "canvas" | "port", key: string) {
	if (kind === "file") onCloseInlineFileTab(key);
	else if (kind === "canvas") onCloseInlineCanvasTab(key);
	else onCloseInlinePortTab(key);
}
</script>

{#if activePreviewKind}
	<WorkspacePreviewPane
		width={previewPanelWidth}
		ariaLabel="Workspace preview"
		onResizeStart={onBeginPreviewPanelResize}
		immersive={previewImmersiveMode}
	>
		<div class="relative flex h-full min-w-0 flex-col overflow-hidden">
			{#if !isMobile && !previewImmersiveMode}
				<PreviewTabs
					tabs={previewTabs}
					onActivate={activatePreviewTab}
					onClose={closePreviewTab}
					{treeVisible}
					{onToggleTree}
				>
					{#snippet trailing()}
						<PreviewExpandMenu
							focused={previewFocusMode}
							immersive={previewImmersiveMode}
							size="sm"
							onToggleFocus={onTogglePreviewFocusMode}
							onToggleImmersive={onTogglePreviewImmersiveMode}
						/>
					{/snippet}
				</PreviewTabs>
			{/if}
			<div class="relative min-h-0 flex-1">
{#if activePreviewKind === "file" && inlineFile}
		<InlineFilePanel
		{inlineFile}
		{previewTabs}
		{treeVisible}
		{onToggleTree}
		onActivatePreviewTab={activatePreviewTab}
		onClosePreviewTab={closePreviewTab}
		{inlineFileCanGoBack}
		{inlineFileDownloadUrl}
		{inlineFileDownloadName}
		{inlineFileIsText}
		{inlineFileHasRenderedPreview}
		bind:inlineFileViewMode
		{inlineFileDiff}
		{inlineFileDiffLoading}
		{inlineFileDiffError}
		{inlineFileIsMarkdown}
		{inlineFileIsHtml}
		{activeFsReadonly}
		{canEditFiles}
		{inlineFileCopied}
		{inlineFileExt}
		{inlineFileIsImage}
		{inlineFileIsVideo}
		{inlineFileDataUrl}
		inlineFileSpaceId={spaceId}
		{inlineFileWork}
		previewImmersiveMode={previewImmersiveMode}
		{immersiveChatVisible}
		onToggleImmersiveChat={onToggleImmersiveChat}
		{isMobile}
		bind:fileActionMenuOpenPath
		bind:inlineFileZoom
		bind:inlineFilePanX
		bind:inlineFilePanY
		{inlineFileDragging}
		{inlineFilePanHandlers}
		onCloseInlineFile={onCloseInlineFile}
		onBackInlineFile={onBackInlineFile}
		onOpenLinkedInlineFile={onOpenLinkedInlineFile}
		onDownloadInlineFile={onDownloadInlineFile}
		onRetryInlineFile={onRetryInlineFile}
		onCopyInlineFileContent={onCopyInlineFileContent}
		onUpdateInlineFileDraft={onUpdateInlineFileDraft}
		onRetryInlineFileSave={onRetryInlineFileSave}
		onOverwriteInlineFile={onOverwriteInlineFile}
		onReloadInlineFile={onReloadInlineFile}
		onPublishInlineFile={publishInlineFile}
		onTogglePreviewImmersiveMode={onTogglePreviewImmersiveMode}
		onLabelFile={(path: string, anchorEl?: HTMLElement | null) =>
			onEditResourceLabels("file", path, anchorEl)}
		onInsertFilePathReference={onInsertFilePathReference}
		onDownloadFilePath={(path: string) => onDownloadNode(onGetFileActionNode(path))}
		onRenameFilePath={(path: string) => onRenameNode(onGetFileActionNode(path))}
		onDeleteFilePath={(path: string) => onDeleteNode(onGetFileActionNode(path))}
		onVisibleLinesChange={onVisibleLinesChange}
		/>
{/if}

{#if activePreviewKind === "canvas" && inlineCanvas}
		<CanvasPreviewPanel
		canvas={inlineCanvas}
		previewTabs={previewTabs}
		spaceId={spaceId}
		{treeVisible}
		{onToggleTree}
		onActivatePreviewTab={activatePreviewTab}
		onClosePreviewTab={closePreviewTab}
		immersive={previewImmersiveMode}
		{immersiveChatVisible}
		{isMobile}
		onToggleImmersiveChat={onToggleImmersiveChat}
		onToggleImmersive={onTogglePreviewImmersiveMode}
		onCommit={onCommitInlineCanvas}
		onRetrySave={onRetryInlineCanvasSave}
		onViewStateChange={onCanvasViewStateChange}
		/>
{/if}

{#if activePreviewKind === "port" && inlinePortPreview}
		<PortPreviewPanel
		previewTabs={previewTabs}
		{treeVisible}
		{onToggleTree}
		onActivatePreviewTab={activatePreviewTab}
		onClosePreviewTab={closePreviewTab}
		port={inlinePortPreview.port}
		url={inlinePortEndpoint?.url ?? inlinePortPreview.url}
		status={inlinePortEndpoint?.status ?? "unknown"}
		observedAt={inlinePortEndpoint?.observedAt}
		immersive={previewImmersiveMode}
		{immersiveChatVisible}
		{isMobile}
		onToggleImmersiveChat={onToggleImmersiveChat}
		onToggleImmersive={onTogglePreviewImmersiveMode}
		onPublish={() => onOpenWorkPublish("port", inlinePortPreview!.port)}
		/>
{/if}
			</div>
		</div>
	</WorkspacePreviewPane>
{/if}

<FilesSidebarPanel
	{spaceId}
	nodes={spaceHasMinimalAccess ? [] : fileTree}
	selectedPath={selectedFilePath}
	loading={!spaceHasMinimalAccess && fileTreeLoading}
	error={spaceHasMinimalAccess
		? "Files are not available for this shared session."
		: fileTreeError}
	subtitle={activeFsSidebarSubtitle}
	activePort={spaceHasMinimalAccess || activePreviewKind !== "port"
		? null
		: activeInlinePort}
	canWrite={!spaceHasMinimalAccess && canEditFiles && !activeFsReadonly}
	showItemActions={!spaceHasMinimalAccess && !activeFsReadonly}
	draggable={!spaceHasMinimalAccess}
	previewEndpoints={spaceHasMinimalAccess ? {} : previewEndpoints}
	desktopCollapsed={rightSidebarCollapsed}
	desktopFloating={previewImmersiveMode}
	desktopWidth={rightSidebarWidth}
	{rightDragOffsetPx}
	{rightIsDragging}
	isDrawerVisible={isRightDrawerVisible}
	{uploadPaneVisible}
	{uploadPaneTargetDir}
	{pendingUploadFiles}
	{pendingUploadEntries}
	onToggle={onToggleDirectory}
	onSelect={(node, options) => {
		if (node.type !== "file") return;
		if (isCovasFile(node.path) && !activeFsReadonly) void onOpenInlineCanvas(node.path);
		else void onOpenInlineFile(node.path);
		closeMobileDrawerIfNeeded(options.mobile);
	}}
	onRefresh={onRefreshFileTree}
	onCreateFile={onCreateFile}
	onCreateCanvas={onCreateCanvas}
	onCreateDir={onCreateDir}
	onRename={onRenameNode}
	onMove={onMoveNode}
	onDelete={onDeleteNode}
	onDownload={onDownloadNode}
	onUpload={onUploadFiles}
	onInsertReference={onInsertPathReference}
	onPublishDirectory={(path, options) => {
		onOpenWorkPublish("directory", path);
		closeMobileDrawerIfNeeded(options.mobile);
	}}
	onOpenPort={(port, url, options) => {
		onOpenInlinePort(port, url);
		closeMobileDrawerIfNeeded(options.mobile);
	}}
	onUploadPaneClose={() => onSetUploadPaneVisible(false)}
	onUploadComplete={onUploadComplete}
	onResizeStart={onBeginRightSidebarResize}
/>

<WorkPublishDialog
	open={Boolean(workPublishTarget)}
	{spaceId}
	ownerUsername={spaceOwnerUsername}
	{spaceSlug}
	targetType={workPublishTarget?.targetType ?? "file"}
	targetRef={workPublishTarget?.targetRef ?? ""}
	onSpaceUpdated={handleSpaceUpdated}
	onClose={onCloseWorkPublish}
/>
