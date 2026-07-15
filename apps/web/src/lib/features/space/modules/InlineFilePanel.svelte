<script lang="ts">
import type {
	SpaceFsFileResponse,
	SpacePendingDiffFileResponse,
	WorkRecord,
} from "@neta-art/cohub";
import {
	ArrowLeft,
	Check,
	Copy,
	Download,
	ListTree,
	MoreHorizontal,
	Pencil,
	Rocket,
	Save,
	TextCursorInput,
	Trash2,
	X,
} from "lucide-svelte";
import { floatNear } from "$lib/actions/portal";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import type { FileViewMode } from "$lib/components/file-diff-view";
import MarkdownView from "$lib/components/MarkdownView.svelte";
import PreviewExpandMenu from "$lib/components/PreviewExpandMenu.svelte";
import WorkspacePreviewPane from "$lib/components/WorkspacePreviewPane.svelte";
import type { PreviewCaptureTarget } from "$lib/features/preview-mark";
import PreviewMarkHost from "$lib/features/preview-mark/ui/PreviewMarkHost.svelte";
import { createLazyModuleLoader } from "$lib/lazy-module";
import type {
	OpenWorkspaceFileTarget,
	WorkspaceFilePosition,
} from "$lib/workspace-file-links";
import { formatFileSize } from "../space-utils";
import PreviewTabs from "./PreviewTabs.svelte";

type InlineFilePanelState = {
	response: SpaceFsFileResponse | null;
	draft: string;
	path: string;
	position: WorkspaceFilePosition | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
	tooLarge: boolean;
};

type PanHandlers = {
	start: (event: MouseEvent) => void;
};

type PreviewTab = {
	kind: "file" | "canvas" | "port";
	key: string;
	label: string;
	title: string;
	dirty?: boolean;
	active: boolean;
};

type Props = {
	inlineFile: InlineFilePanelState;
	previewTabs: PreviewTab[];
	inlineFileCanGoBack: boolean;
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
	inlineFileDirty: boolean;
	activeFsReadonly: boolean;
	canEditFiles: boolean;
	inlineFileCopied: boolean;
	inlineFileExt: string;
	inlineFileIsImage: boolean;
	inlineFileIsVideo: boolean;
	inlineFileDataUrl: string | null;
	inlineFileSpaceId: string;
	inlineFileWork: WorkRecord | null;
	previewPanelWidth: number;
	previewFocusMode: boolean;
	previewImmersiveMode: boolean;
	treeVisible?: boolean;
	onToggleTree?: () => void;
	isMobile: boolean;
	animateShell?: boolean;
	fileActionMenuOpenPath: string | null;
	inlineFileZoom: number;
	inlineFilePanX: number;
	inlineFilePanY: number;
	inlineFileDragging: boolean;
	inlineFilePanHandlers: PanHandlers;
	onCloseInlineFile: () => void;
	onActivatePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onClosePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onBackInlineFile: () => void | Promise<void>;
	onOpenLinkedInlineFile: (
		target: OpenWorkspaceFileTarget,
	) => void | Promise<void>;
	onDownloadInlineFile: () => void | Promise<void>;
	onCopyInlineFileContent: () => void | Promise<void>;
	onSaveInlineFile: () => void | Promise<void>;
	onPublishInlineFile: () => void;
	onPreviewResizeStart: (event: PointerEvent) => void;
	onTogglePreviewFocusMode: () => void | Promise<void>;
	onTogglePreviewImmersiveMode: () => void | Promise<void>;
	onLabelFile: (
		path: string,
		anchorEl?: HTMLElement | null,
	) => void | Promise<void>;
	onInsertFilePathReference: (path: string) => void;
	onDownloadFilePath: (path: string) => void | Promise<void>;
	onRenameFilePath: (path: string) => void | Promise<void>;
	onDeleteFilePath: (path: string) => void | Promise<void>;
	onVisibleLinesChange?: (
		path: string,
		range: { start: number; end: number } | null,
	) => void;
};

let {
	inlineFile,
	previewTabs,
	inlineFileCanGoBack,
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
	inlineFileDirty,
	activeFsReadonly,
	canEditFiles,
	inlineFileCopied,
	inlineFileExt,
	inlineFileIsImage,
	inlineFileIsVideo,
	inlineFileDataUrl,
	inlineFileSpaceId,
	inlineFileWork,
	previewPanelWidth,
	previewFocusMode,
	previewImmersiveMode,
	treeVisible = true,
	onToggleTree,
	isMobile,
	animateShell = true,
	fileActionMenuOpenPath = $bindable(),
	inlineFileZoom = $bindable(),
	inlineFilePanX = $bindable(),
	inlineFilePanY = $bindable(),
	inlineFileDragging,
	inlineFilePanHandlers,
	onCloseInlineFile,
	onActivatePreviewTab,
	onClosePreviewTab,
	onBackInlineFile,
	onOpenLinkedInlineFile,
	onDownloadInlineFile,
	onCopyInlineFileContent,
	onSaveInlineFile,
	onPublishInlineFile,
	onPreviewResizeStart,
	onTogglePreviewFocusMode,
	onTogglePreviewImmersiveMode,
	onLabelFile,
	onInsertFilePathReference,
	onDownloadFilePath,
	onRenameFilePath,
	onDeleteFilePath,
	onVisibleLinesChange,
}: Props = $props();

const loadCodeEditorModule = createLazyModuleLoader(
	() => import("$lib/components/CodeEditor.svelte"),
);
const loadRenderedFilePreviewModule = createLazyModuleLoader(
	() => import("$lib/components/RenderedFilePreview.svelte"),
);
const loadFileDiffViewModule = createLazyModuleLoader(
	() => import("$lib/components/FileDiffView.svelte"),
);

const showDiffMode = $derived(!activeFsReadonly && inlineFileIsText);
// Bump to force #await to re-subscribe after a cleared lazy-import failure.
let codeEditorLoadAttempt = $state(0);
let htmlPreviewLoadAttempt = $state(0);
let fileDiffLoadAttempt = $state(0);
const codeEditorModulePromise = $derived.by(() => {
	codeEditorLoadAttempt;
	return loadCodeEditorModule();
});
const htmlPreviewModulePromise = $derived.by(() => {
	htmlPreviewLoadAttempt;
	return loadRenderedFilePreviewModule();
});
const fileDiffModulePromise = $derived.by(() => {
	fileDiffLoadAttempt;
	return loadFileDiffViewModule();
});
// Always the button that opened the menu (avoids dual mobile/desktop bind:this races).
let fileActionMenuAnchorEl: HTMLElement | null = $state(null);
let imageMarkOpenMobile = $state(false);
let imageMarkOpenDesktop = $state(false);
let htmlMarkOpenMobile = $state(false);
let htmlMarkOpenDesktop = $state(false);
let mobileImageRootEl: HTMLElement | null = $state(null);
let desktopImageRootEl: HTMLElement | null = $state(null);
// Mobile + desktop panels both mount; keep mark context separate like images.
let htmlMarkTargetMobile: PreviewCaptureTarget | null = $state(null);
let htmlMarkSurfaceMobile: HTMLElement | null = $state(null);
let htmlMarkTargetDesktop: PreviewCaptureTarget | null = $state(null);
let htmlMarkSurfaceDesktop: HTMLElement | null = $state(null);

const imageMarkTarget = $derived.by((): PreviewCaptureTarget | null => {
	if (!inlineFileIsImage || !inlineFileDataUrl || !inlineFile.path) return null;
	return {
		kind: "image",
		src: inlineFileDataUrl,
		path: inlineFile.path,
	};
});
const showHtmlMark = $derived(
	inlineFileIsHtml &&
		inlineFileViewMode === "preview" &&
		inlineFileHasRenderedPreview,
);

$effect(() => {
	if (showHtmlMark) return;
	htmlMarkOpenMobile = false;
	htmlMarkOpenDesktop = false;
});
</script>

{#snippet FileHeaderCoreActions(path: string)}
	<div class="relative shrink-0" data-resource-actions>
		<button
			type="button"
			class="icon-btn"
			onclick={(event) => {
				event.stopPropagation();
				const nextOpen = fileActionMenuOpenPath !== path;
				fileActionMenuAnchorEl = nextOpen ? event.currentTarget : null;
				fileActionMenuOpenPath = nextOpen ? path : null;
			}}
			title="More actions"
			aria-haspopup="menu"
			aria-expanded={fileActionMenuOpenPath === path}
		>
			<MoreHorizontal class="w-4 h-4" />
		</button>
		{#if fileActionMenuOpenPath === path && fileActionMenuAnchorEl}
			<div
				class="w-44 overflow-hidden rounded-md border border-border-subtle bg-bg-primary py-1 shadow-lg"
				role="menu"
				data-resource-actions
				use:floatNear={{
					getAnchor: () => fileActionMenuAnchorEl,
					placement: "bottom-end",
					gap: 4,
					width: 176,
					zIndex: 120,
				}}
			>
				<button type="button" class="menu-item" onclick={() => { void onLabelFile(path, fileActionMenuAnchorEl); fileActionMenuOpenPath = null; fileActionMenuAnchorEl = null; }} role="menuitem"><ListTree class="w-3.5 h-3.5" /><span>Label as…</span></button>
				<button type="button" class="menu-item" onclick={() => { onInsertFilePathReference(path); fileActionMenuOpenPath = null; fileActionMenuAnchorEl = null; }} role="menuitem"><TextCursorInput class="w-3.5 h-3.5" /><span>Insert reference</span></button>
				<button type="button" class="menu-item" onclick={() => { void onDownloadFilePath(path); fileActionMenuOpenPath = null; fileActionMenuAnchorEl = null; }} role="menuitem"><Download class="w-3.5 h-3.5" /><span>Download</span></button>
				{#if canEditFiles && !activeFsReadonly}
					<button type="button" class="menu-item" onclick={() => { void onRenameFilePath(path); fileActionMenuOpenPath = null; fileActionMenuAnchorEl = null; }} role="menuitem"><Pencil class="w-3.5 h-3.5" /><span>Rename</span></button>
					<button type="button" class="menu-item danger" onclick={() => { void onDeleteFilePath(path); fileActionMenuOpenPath = null; fileActionMenuAnchorEl = null; }} role="menuitem"><Trash2 class="w-3.5 h-3.5" /><span>Delete</span></button>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet PreviewFocusButton()}
	{#if !isMobile}
		<PreviewExpandMenu
			focused={previewFocusMode}
			immersive={previewImmersiveMode}
			onToggleFocus={onTogglePreviewFocusMode}
			onToggleImmersive={onTogglePreviewImmersiveMode}
		/>
	{/if}
{/snippet}

{#snippet LazyLoadError(label: string, onRetry: () => void)}
	<div class="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
		<div class="text-[12px] text-error-soft">{label}</div>
		<button type="button" class="action-btn" onclick={onRetry}>Retry</button>
	</div>
{/snippet}

{#snippet MarkdownFilePreview()}
	{#if inlineFile.response}
		<MarkdownView
			source={inlineFile.draft}
			variant="document"
			baseFilePath={inlineFile.response.path}
			onOpenFile={onOpenLinkedInlineFile}
		/>
	{/if}
{/snippet}

{#snippet HtmlFilePreview(layout: "mobile" | "desktop")}
	{#if inlineFile.response}
		{#await htmlPreviewModulePromise then previewModule}
			{@const LazyRenderedFilePreview = previewModule.default}
			{@const hostWork =
				(layout === "mobile") === isMobile ? inlineFileWork : null}
			{#if layout === "mobile"}
				<LazyRenderedFilePreview
					name={inlineFile.response.name}
					source={inlineFile.draft}
					type="html"
					path={inlineFile.response.path}
					spaceId={inlineFileSpaceId}
					readonly={activeFsReadonly}
					work={hostWork}
					bind:markTarget={htmlMarkTargetMobile}
					bind:markSurface={htmlMarkSurfaceMobile}
					onOpenFile={onOpenLinkedInlineFile}
				/>
			{:else}
				<LazyRenderedFilePreview
					name={inlineFile.response.name}
					source={inlineFile.draft}
					type="html"
					path={inlineFile.response.path}
					spaceId={inlineFileSpaceId}
					readonly={activeFsReadonly}
					work={hostWork}
					bind:markTarget={htmlMarkTargetDesktop}
					bind:markSurface={htmlMarkSurfaceDesktop}
					onOpenFile={onOpenLinkedInlineFile}
				/>
			{/if}
		{:catch}
			{@render LazyLoadError("Preview failed to load.", () => {
				htmlPreviewLoadAttempt += 1;
			})}
		{/await}
	{/if}
{/snippet}

{#snippet TextFileBody(layout: "mobile" | "desktop")}
	{#if inlineFileViewMode === "diff" && showDiffMode}
		{#await fileDiffModulePromise then diffModule}
			{@const LazyFileDiffView = diffModule.default}
			<LazyFileDiffView
				patch={inlineFileDiff}
				loading={inlineFileDiffLoading}
				error={inlineFileDiffError}
			/>
		{:catch}
			{@render LazyLoadError("Diff failed to load.", () => {
				fileDiffLoadAttempt += 1;
			})}
		{/await}
	{:else if inlineFileViewMode === "preview" && inlineFileHasRenderedPreview}
		{#if inlineFileIsMarkdown}
			{@render MarkdownFilePreview()}
		{:else}
			{@render HtmlFilePreview(layout)}
		{/if}
	{:else}
		{#await codeEditorModulePromise then editorModule}
			{@const LazyCodeEditor = editorModule.default}
			{@const editorPath = inlineFile.path}
			<LazyCodeEditor
				value={inlineFile.draft}
				language={inlineFileExt}
				initialPosition={inlineFile.position}
				onInput={(v) => {
					if (inlineFile) inlineFile.draft = v;
				}}
				onVisibleLinesChange={(range) =>
					onVisibleLinesChange?.(editorPath, range)}
				readonly={!canEditFiles || activeFsReadonly}
			/>
		{:catch}
			{@render LazyLoadError("Editor failed to load.", () => {
				codeEditorLoadAttempt += 1;
			})}
		{/await}
	{/if}
{/snippet}

  <!-- Inline file panel — desktop: side panel, mobile: full-screen overlay -->
  {#if inlineFile}
    <!-- Mobile full-screen overlay -->
    <div class="lg:hidden fixed inset-0 z-50 flex flex-col bg-bg-content">
      <!-- Single mobile chrome row: close + tabs/title + more -->
      <div class="flex h-11 shrink-0 items-center gap-1 border-b border-border-subtle bg-bg-surface px-2">
        <button type="button" class="icon-btn" onclick={onCloseInlineFile} title="Close file" aria-label="Close file">
          <X class="w-5 h-5" />
        </button>
        {#if inlineFileCanGoBack}
          <button type="button" class="icon-btn" onclick={() => void onBackInlineFile()} title="Back" aria-label="Back">
            <ArrowLeft class="w-5 h-5" />
          </button>
        {/if}
        {#if previewTabs.length > 1}
          <div class="min-w-0 flex-1 overflow-hidden">
            <PreviewTabs tabs={previewTabs} onActivate={onActivatePreviewTab} onClose={onClosePreviewTab} embedded treeVisible={treeVisible} onToggleTree={onToggleTree} />
          </div>
        {:else}
          <div class="min-w-0 flex-1 truncate px-1 text-[13px] text-text-secondary" title={inlineFile.response?.path ?? inlineFile.path}>
            {inlineFile.response?.name ?? inlineFile.path.split("/").pop() ?? inlineFile.path}
          </div>
        {/if}
        {@render FileHeaderCoreActions(inlineFile.path)}
      </div>
      {#if inlineFile.loading}
        <CenteredLoading label="Loading file…" size="panel" />
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
            <a href={inlineFileDownloadUrl} download={inlineFileDownloadName} class="action-btn primary" onclick={(e) => { e.preventDefault(); void onDownloadInlineFile(); }}>
              <Download class="w-3.5 h-3.5" />
              Download file
            </a>
          </div>
        </div>
      {:else if inlineFile.response}
        {#if inlineFileIsText}
          <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-surface px-3">
            {#if inlineFileHasRenderedPreview || showDiffMode}
              <div class="flex items-center gap-0 rounded-md border border-border-subtle bg-bg-input p-[2px]">
                <button type="button" class="segmented-btn" class:active={inlineFileViewMode === "source"} onclick={() => inlineFileViewMode = "source"} title="Edit source">Source</button>
                {#if inlineFileHasRenderedPreview}
                  <button type="button" class="segmented-btn" class:active={inlineFileViewMode === "preview"} onclick={() => inlineFileViewMode = "preview"} title={inlineFileIsMarkdown ? "Preview markdown" : "Preview HTML"}>Preview</button>
                {/if}
                {#if showDiffMode}
                  <button type="button" class="segmented-btn" class:active={inlineFileViewMode === "diff"} onclick={() => inlineFileViewMode = "diff"} title="Diff since last save">Diff</button>
                {/if}
              </div>
            {/if}
            <div class="flex-1"></div>
            {#if showHtmlMark}
              <PreviewMarkHost
                bind:open={htmlMarkOpenMobile}
                target={htmlMarkTargetMobile}
                surface={htmlMarkSurfaceMobile}
                buttonClass="icon-btn"
              />
            {/if}
            <button type="button" class="icon-btn" onclick={() => void onCopyInlineFileContent()} title="Copy content">
              {#if inlineFileCopied}<Check class="w-4 h-4 text-success-soft" />{:else}<Copy class="w-4 h-4" />{/if}
            </button>
            {#if !activeFsReadonly}
              <button type="button" class="action-btn" onclick={() => void onSaveInlineFile()} disabled={inlineFile.saving || !inlineFileDirty || !canEditFiles} title="Save">
                <Save class="w-4 h-4 shrink-0" />
              </button>
            {:else}
              <span class="rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-tertiary">Read-only snapshot</span>
            {/if}
          </div>
          <div class="flex-1 min-h-0">
            {@render TextFileBody("mobile")}
          </div>
        {:else if inlineFileIsImage && inlineFileDataUrl}
          <div class="relative flex flex-1 items-center justify-center overflow-hidden p-4" bind:this={mobileImageRootEl}>
            {#if imageMarkTarget}
              <div class="pointer-events-none absolute top-2 right-2 z-20">
                <div class="pointer-events-auto rounded-md border border-border-subtle bg-bg-surface/95 shadow-sm backdrop-blur-sm">
                  <PreviewMarkHost bind:open={imageMarkOpenMobile} target={imageMarkTarget} surface={mobileImageRootEl} buttonClass="icon-btn" />
                </div>
              </div>
            {/if}
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
              <a href={inlineFileDownloadUrl} download={inlineFileDownloadName} class="action-btn primary" onclick={(e) => { e.preventDefault(); void onDownloadInlineFile(); }}>
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
    <WorkspacePreviewPane
      desktopOnly={true}
      width={previewPanelWidth}
      ariaLabel="File preview"
      onResizeStart={onPreviewResizeStart}
      immersive={previewImmersiveMode}
      animate={animateShell}
    >
      <div class="inline-file-preview flex h-full min-w-0 flex-col bg-bg-content" class:inline-file-preview--immersive={previewImmersiveMode}>
        <PreviewTabs tabs={previewTabs} onActivate={onActivatePreviewTab} onClose={onClosePreviewTab} treeVisible={treeVisible} onToggleTree={onToggleTree} />
        {#if inlineFile.loading}
          <div class="preview-chrome flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
            <span class="preview-chrome-path flex-1 truncate text-xs text-text-secondary">{inlineFile.path}</span>
            {@render FileHeaderCoreActions(inlineFile.path)}
            {@render PreviewFocusButton()}
            <button type="button" class="icon-btn" onclick={onCloseInlineFile} title="Close file">
              <X class="w-4 h-4" />
            </button>
          </div>
          <CenteredLoading label="Loading file…" size="panel" />
        {:else if inlineFile.error}
          <div class="preview-chrome flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
            <span class="preview-chrome-path flex-1 truncate text-xs text-text-secondary">{inlineFile.path}</span>
            {@render FileHeaderCoreActions(inlineFile.path)}
            {@render PreviewFocusButton()}
            <button type="button" class="icon-btn" onclick={onCloseInlineFile} title="Close file">
              <X class="w-4 h-4" />
            </button>
          </div>
          <div class="m-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-xs text-error-soft">
            {inlineFile.error}
          </div>
        {:else if inlineFile.tooLarge}
          <div class="preview-chrome flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
            <span class="preview-chrome-path flex-1 truncate text-xs text-text-secondary">{inlineFile.path}</span>
            {@render FileHeaderCoreActions(inlineFile.path)}
            {@render PreviewFocusButton()}
            <button type="button" class="icon-btn" onclick={onCloseInlineFile} title="Close file">
              <X class="w-4 h-4" />
            </button>
          </div>
          <div class="flex flex-1 items-center justify-center">
            <div class="m-4 rounded-lg border border-warning-soft/30 bg-warning-bg p-6 text-center max-w-sm">
              <div class="text-4xl mb-3">📦</div>
              <div class="text-sm font-semibold text-text-primary mb-1">File too large to preview</div>
              <div class="text-xs text-text-secondary mb-4">This file exceeds 10MB and cannot be opened in the web editor.</div>
              <a href={inlineFileDownloadUrl} download={inlineFileDownloadName} class="action-btn primary" onclick={(e) => { e.preventDefault(); void onDownloadInlineFile(); }}>
                <Download class="w-3.5 h-3.5" />
                Download file
              </a>
            </div>
          </div>
        {:else if inlineFile.response}
          {#if inlineFileIsText}
            <div class="preview-chrome flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
              {#if inlineFileCanGoBack}
                <button type="button" class="icon-btn" onclick={() => void onBackInlineFile()} title="Back">
                  <ArrowLeft class="w-4 h-4" />
                </button>
              {/if}
              <div class="preview-chrome-path min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
                {inlineFile.response.path}
              </div>
              {@render FileHeaderCoreActions(inlineFile.response.path)}
              {#if inlineFileIsHtml && inlineFileViewMode === "preview"}
                <button type="button" class="action-btn" onclick={onPublishInlineFile} title="Publish work">
                  <Rocket class="w-3.5 h-3.5 shrink-0" />
                  <span class="hidden sm:inline">Publish</span>
                </button>
              {/if}
              {#if inlineFileHasRenderedPreview || showDiffMode}
                <div class="flex items-center gap-0 rounded-md border border-border-subtle bg-bg-input p-[2px]">
                  <button
                    type="button"
                    class="segmented-btn"
                    class:active={inlineFileViewMode === "source"}
                    onclick={() => inlineFileViewMode = "source"}
                    title="Edit source"
                  >
                    Source
                  </button>
                  {#if inlineFileHasRenderedPreview}
                    <button
                      type="button"
                      class="segmented-btn"
                      class:active={inlineFileViewMode === "preview"}
                      onclick={() => inlineFileViewMode = "preview"}
                      title={inlineFileIsMarkdown ? "Preview markdown" : "Preview HTML"}
                    >
                      Preview
                    </button>
                  {/if}
                  {#if showDiffMode}
                    <button
                      type="button"
                      class="segmented-btn"
                      class:active={inlineFileViewMode === "diff"}
                      onclick={() => inlineFileViewMode = "diff"}
                      title="Diff since last save"
                    >
                      Diff
                    </button>
                  {/if}
                </div>
              {/if}
              {#if showHtmlMark}
                <PreviewMarkHost
                  bind:open={htmlMarkOpenDesktop}
                  target={htmlMarkTargetDesktop}
                  surface={htmlMarkSurfaceDesktop}
                  buttonClass="icon-btn"
                />
              {/if}
              <button type="button" class="icon-btn" onclick={() => void onCopyInlineFileContent()} title="Copy content">
                {#if inlineFileCopied}
                  <Check class="w-4 h-4 text-success-soft" />
                {:else}
                  <Copy class="w-4 h-4" />
                {/if}
              </button>
              {#if activeFsReadonly}
                <span class="rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-tertiary">Read-only snapshot</span>
              {:else}
                <button
                  type="button"
                  class="action-btn"
                  onclick={() => void onSaveInlineFile()}
                  disabled={inlineFile.saving || !inlineFileDirty || !canEditFiles}
                  title="Save (Ctrl+S)"
                >
                  <Save class="w-3.5 h-3.5 shrink-0" />
                  <span class="hidden sm:inline">Save</span>
                </button>
              {/if}
              {@render PreviewFocusButton()}
              <button type="button" class="icon-btn" onclick={onCloseInlineFile} title="Close file">
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="flex-1 min-h-0">
              {@render TextFileBody("desktop")}
            </div>
          {:else if inlineFileIsImage && inlineFileDataUrl}
            <div class="relative flex min-h-0 flex-1 flex-col" bind:this={desktopImageRootEl}>
              <div class="preview-chrome flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
                <div class="preview-chrome-path min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
                  {inlineFile.response.path}
                </div>
                <div class="text-xs text-text-tertiary hidden sm:inline">{formatFileSize(inlineFile.response.size)}</div>
                {@render FileHeaderCoreActions(inlineFile.response.path)}
                {#if imageMarkTarget}
                  <PreviewMarkHost bind:open={imageMarkOpenDesktop} target={imageMarkTarget} surface={desktopImageRootEl} buttonClass="icon-btn" />
                {/if}
                <button type="button" class="zoom-btn" onclick={() => { inlineFileZoom = Math.max(0.25, inlineFileZoom - 0.25); inlineFilePanX = 0; inlineFilePanY = 0; }} title="Zoom out">
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="7" y1="11" x2="15" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
                <span class="text-xs text-text-tertiary tabular-nums w-10 text-center">{Math.round(inlineFileZoom * 100)}%</span>
                <button type="button" class="zoom-btn" onclick={() => { inlineFileZoom = Math.min(4, inlineFileZoom + 0.25); inlineFilePanX = 0; inlineFilePanY = 0; }} title="Zoom in">
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="11" y1="7" x2="11" y2="15"/><line x1="7" y1="11" x2="15" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
                {@render PreviewFocusButton()}
                <button type="button" class="icon-btn" onclick={onCloseInlineFile} title="Close file">
                  <X class="w-4 h-4" />
                </button>
              </div>
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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
            </div>
          {:else if inlineFileIsVideo && inlineFileDataUrl}
            <div class="preview-chrome flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
              <div class="preview-chrome-path min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
                {inlineFile.response.path}
              </div>
              <div class="text-xs text-text-tertiary hidden sm:inline">{formatFileSize(inlineFile.response.size)}</div>
              {@render FileHeaderCoreActions(inlineFile.response.path)}
              {@render PreviewFocusButton()}
              <button type="button" class="icon-btn" onclick={onCloseInlineFile} title="Close file">
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="flex flex-1 items-center justify-center p-4">
              <video src={inlineFileDataUrl} controls class="max-h-full max-w-full rounded-md">
                <track kind="captions" />
              </video>
            </div>
          {:else}
            <div class="preview-chrome flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
              <div class="preview-chrome-path min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
                {inlineFile.response.path}
              </div>
              <div class="text-xs text-text-tertiary hidden sm:inline">{formatFileSize(inlineFile.response.size)}</div>
              {@render FileHeaderCoreActions(inlineFile.response.path)}
              {@render PreviewFocusButton()}
              <button type="button" class="icon-btn" onclick={onCloseInlineFile} title="Close file">
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
    </WorkspacePreviewPane>
  {/if}

<style>
  /* Float mode: content fills stage; chrome becomes a compact floating pill. */
  .inline-file-preview--immersive {
    position: relative;
  }

  /* Hide tab strip — tabs are not useful full-bleed in float mode. */
  .inline-file-preview--immersive > :global(:first-child) {
    display: none;
  }

  .inline-file-preview--immersive :global(.preview-chrome) {
    position: absolute;
    top: 12px;
    right: 12px;
    left: auto;
    z-index: 25;
    width: auto;
    max-width: min(520px, calc(100% - 24px));
    height: auto;
    min-height: 40px;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    border-bottom: 1px solid var(--border-subtle);
    background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
    padding: 6px 8px;
    box-shadow: 0 12px 28px color-mix(in srgb, var(--overlay-scrim-strong) 16%, transparent);
    backdrop-filter: blur(14px);
  }

  /* Long path wastes space in the pill — keep actions only. */
  .inline-file-preview--immersive :global(.preview-chrome-path) {
    display: none;
  }

  /* Body fills the stage under the floating chrome. */
  .inline-file-preview--immersive > :global(.preview-chrome + *) {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>
