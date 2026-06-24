<script lang="ts">
import type { SpacePublicEndpoints } from "@cohub/protocol/ports";
import FileUploadPane from "$lib/components/FileUploadPane.svelte";
import MobileRightDrawer from "$lib/components/MobileRightDrawer.svelte";
import SpaceFileSidebar from "$lib/components/SpaceFileSidebar.svelte";
import type { SpaceFsNode } from "$lib/space-fs";
import type { LocalUploadEntry } from "$lib/upload-entries";

type Props = {
	spaceId: string;
	nodes: SpaceFsNode[];
	selectedPath: string;
	loading: boolean;
	error: string | null;
	subtitle: string;
	activePort: string | null;
	canWrite: boolean;
	showItemActions: boolean;
	draggable: boolean;
	previewEndpoints: SpacePublicEndpoints;
	desktopCollapsed: boolean;
	desktopFloating: boolean;
	desktopWidth: number;
	rightDragOffsetPx: number;
	rightIsDragging: boolean;
	isDrawerVisible: boolean;
	uploadPaneVisible: boolean;
	uploadPaneTargetDir: string;
	pendingUploadFiles: File[];
	pendingUploadEntries: LocalUploadEntry[];
	onToggle: (node: SpaceFsNode) => void | Promise<void>;
	onSelect: (node: SpaceFsNode, options: { mobile: boolean }) => void;
	onRefresh: () => void | Promise<void>;
	onCreateFile: (parentPath: string) => void | Promise<void>;
	onCreateCanvas: (parentPath: string) => void | Promise<void>;
	onCreateDir: (parentPath: string) => void | Promise<void>;
	onRename: (node: SpaceFsNode) => void | Promise<void>;
	onDelete: (node: SpaceFsNode) => void | Promise<void>;
	onDownload: (node: SpaceFsNode) => void | Promise<void>;
	onUpload: (files: File[] | LocalUploadEntry[], targetDir: string) => void;
	onInsertReference: (path: string) => void;
	onPublishDirectory: (path: string, options: { mobile: boolean }) => void;
	onOpenPort: (port: string, url: string, options: { mobile: boolean }) => void;
	onUploadPaneClose: () => void;
	onUploadComplete: () => void | Promise<void>;
	onResizeStart: (event: PointerEvent) => void;
};

let {
	spaceId,
	nodes,
	selectedPath,
	loading,
	error,
	subtitle,
	activePort,
	canWrite,
	showItemActions,
	draggable,
	previewEndpoints,
	desktopCollapsed,
	desktopFloating,
	desktopWidth,
	rightDragOffsetPx,
	rightIsDragging,
	isDrawerVisible,
	uploadPaneVisible,
	uploadPaneTargetDir,
	pendingUploadFiles,
	pendingUploadEntries,
	onToggle,
	onSelect,
	onRefresh,
	onCreateFile,
	onCreateCanvas,
	onCreateDir,
	onRename,
	onDelete,
	onDownload,
	onUpload,
	onInsertReference,
	onPublishDirectory,
	onOpenPort,
	onUploadPaneClose,
	onUploadComplete,
	onResizeStart,
}: Props = $props();
</script>

{#if !desktopCollapsed}
	<div
		class="files-sidebar-shell hidden shrink-0 lg:flex border-l border-border-subtle"
		class:files-sidebar-shell--floating={desktopFloating}
		style={`width: ${desktopWidth}px; --files-sidebar-width: ${desktopWidth}px`}
	>
		<div class="w-full relative">
			<SpaceFileSidebar
				{nodes}
				{selectedPath}
				{loading}
				{error}
				{subtitle}
				onToggle={onToggle}
				onSelect={(node) => onSelect(node, { mobile: false })}
				onRefresh={onRefresh}
				onCreateFile={onCreateFile}
				onCreateCanvas={onCreateCanvas}
				onCreateDir={onCreateDir}
				onRename={onRename}
				onDelete={onDelete}
				onDownload={onDownload}
				onUpload={onUpload}
				onInsertReference={onInsertReference}
				onPublishDirectory={(path) => onPublishDirectory(path, { mobile: false })}
				onOpenPort={(port, url) => onOpenPort(port, url, { mobile: false })}
				{activePort}
				{draggable}
				{showItemActions}
				{canWrite}
				{previewEndpoints}
			/>
			<FileUploadPane
				{spaceId}
				targetDir={uploadPaneTargetDir}
				files={pendingUploadFiles}
				entries={pendingUploadEntries}
				open={uploadPaneVisible}
				onClose={onUploadPaneClose}
				onComplete={onUploadComplete}
			/>
			{#if !desktopFloating}
				<button
					type="button"
					class="right-sidebar-resize-handle"
					aria-label="Resize files sidebar"
					title="Resize files sidebar"
					onpointerdown={onResizeStart}
				></button>
			{/if}
		</div>
	</div>
{/if}

<MobileRightDrawer
	dragOffsetPx={rightDragOffsetPx}
	isDragging={rightIsDragging}
	{isDrawerVisible}
>
	<SpaceFileSidebar
		{nodes}
		{selectedPath}
		{loading}
		{error}
		{subtitle}
		onToggle={onToggle}
		onSelect={(node) => onSelect(node, { mobile: true })}
		onRefresh={onRefresh}
		onCreateFile={onCreateFile}
		onCreateCanvas={onCreateCanvas}
		onCreateDir={onCreateDir}
		onRename={onRename}
		onDelete={onDelete}
		onDownload={onDownload}
		onUpload={onUpload}
		onInsertReference={onInsertReference}
		onPublishDirectory={(path) => onPublishDirectory(path, { mobile: true })}
		onOpenPort={(port, url) => onOpenPort(port, url, { mobile: true })}
		{activePort}
		draggable={false}
		showItemActions={false}
		{canWrite}
		{previewEndpoints}
	/>
	<FileUploadPane
		{spaceId}
		targetDir={uploadPaneTargetDir}
		files={pendingUploadFiles}
		entries={pendingUploadEntries}
		open={uploadPaneVisible}
		onClose={onUploadPaneClose}
		onComplete={onUploadComplete}
	/>
</MobileRightDrawer>

<style>
	@media (min-width: 960px) {
		.files-sidebar-shell--floating {
			position: absolute;
			top: 12px;
			right: 12px;
			bottom: 12px;
			z-index: 30;
			width: var(--files-sidebar-width);
			overflow: hidden;
			border: 1px solid var(--border-subtle);
			border-radius: 12px;
			background: var(--bg-elevated);
			box-shadow: 0 18px 48px color-mix(in srgb, var(--overlay-scrim-strong) 18%, transparent);
		}
	}
</style>
