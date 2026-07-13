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
import PreviewExpandMenu from "$lib/components/PreviewExpandMenu.svelte";
import WorkspacePreviewPane from "$lib/components/WorkspacePreviewPane.svelte";
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
	inlineFileDebugWork: WorkRecord | null;
	previewPanelWidth: number;
	previewFocusMode: boolean;
	previewImmersiveMode: boolean;
	isMobile: boolean;
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
	onLabelFile: (path: string) => void | Promise<void>;
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
	inlineFileDebugWork,
	previewPanelWidth,
	previewFocusMode,
	previewImmersiveMode,
	isMobile,
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
let fileActionMenuAnchorEl: HTMLDivElement | null = $state(null);
</script>

{#snippet FileHeaderCoreActions(path: string)}
	<div class="relative shrink-0" data-resource-actions bind:this={fileActionMenuAnchorEl}>
		<button type="button" class="icon-btn" onclick={(event) => { event.stopPropagation(); fileActionMenuOpenPath = fileActionMenuOpenPath === path ? null : path; }} title="More actions" aria-haspopup="menu" aria-expanded={fileActionMenuOpenPath === path}>
			<MoreHorizontal class="w-4 h-4" />
		</button>
		{#if fileActionMenuOpenPath === path}
			<div
				class="w-44 overflow-hidden rounded-md border border-border-subtle bg-bg-primary py-1 shadow-lg"
				role="menu"
				data-resource-actions
				use:floatNear={{
					getAnchor: () => fileActionMenuAnchorEl,
					placement: "bottom-end",
					gap: 4,
					width: 176,
					zIndex: 90,
				}}
			>
				<button type="button" class="menu-item" onclick={() => { void onLabelFile(path); fileActionMenuOpenPath = null; }} role="menuitem"><ListTree class="w-3.5 h-3.5" /><span>Label as…</span></button>
				<button type="button" class="menu-item" onclick={() => { onInsertFilePathReference(path); fileActionMenuOpenPath = null; }} role="menuitem"><TextCursorInput class="w-3.5 h-3.5" /><span>Insert reference</span></button>
				<button type="button" class="menu-item" onclick={() => { void onDownloadFilePath(path); fileActionMenuOpenPath = null; }} role="menuitem"><Download class="w-3.5 h-3.5" /><span>Download</span></button>
				{#if canEditFiles && !activeFsReadonly}
					<button type="button" class="menu-item" onclick={() => { void onRenameFilePath(path); fileActionMenuOpenPath = null; }} role="menuitem"><Pencil class="w-3.5 h-3.5" /><span>Rename</span></button>
					<button type="button" class="menu-item danger" onclick={() => { void onDeleteFilePath(path); fileActionMenuOpenPath = null; }} role="menuitem"><Trash2 class="w-3.5 h-3.5" /><span>Delete</span></button>
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

  <!-- Inline file panel — desktop: side panel, mobile: full-screen overlay -->
  {#if inlineFile}
    <!-- Mobile full-screen overlay -->
    <div class="lg:hidden fixed inset-0 z-50 flex flex-col bg-bg-content">
      <PreviewTabs tabs={previewTabs} onActivate={onActivatePreviewTab} onClose={onClosePreviewTab} />
      <div class="flex h-11 items-center gap-2 border-b border-border-subtle px-3 shrink-0 bg-bg-surface">
        <button type="button" class="icon-btn" onclick={onCloseInlineFile} title="Close file">
          <X class="w-5 h-5" />
        </button>
        {#if inlineFileCanGoBack}
          <button type="button" class="icon-btn" onclick={() => void onBackInlineFile()} title="Back">
            <ArrowLeft class="w-5 h-5" />
          </button>
        {/if}
        <div class="min-w-0 flex-1 truncate text-sm text-text-secondary">
          {#if inlineFile.response}{inlineFile.response.path}{:else}{inlineFile.path}{/if}
        </div>
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
            {#if inlineFileViewMode === "diff" && showDiffMode}
              {#await loadFileDiffViewModule() then diffModule}
                {@const LazyFileDiffView = diffModule.default}
                <LazyFileDiffView patch={inlineFileDiff} loading={inlineFileDiffLoading} error={inlineFileDiffError} />
              {:catch}
                <div class="flex h-full items-center justify-center text-[12px] text-error-soft">Diff failed to load.</div>
              {/await}
            {:else if inlineFileViewMode === "preview" && inlineFileHasRenderedPreview}
              {#await loadRenderedFilePreviewModule() then previewModule}
                {@const LazyRenderedFilePreview = previewModule.default}
                <LazyRenderedFilePreview
                  name={inlineFile.response.name}
                  source={inlineFile.draft}
                  type={inlineFileIsMarkdown ? "markdown" : "html"}
                  path={inlineFile.response.path}
                  spaceId={inlineFileSpaceId}
                  readonly={activeFsReadonly}
                  debugWork={inlineFileDebugWork}
                  onOpenFile={onOpenLinkedInlineFile}
                />
              {:catch}
                <div class="flex h-full items-center justify-center text-[12px] text-error-soft">Preview failed to load.</div>
              {/await}
            {:else}
              {#await loadCodeEditorModule() then editorModule}
                {@const LazyCodeEditor = editorModule.default}
                {@const editorPath = inlineFile.path}
                <LazyCodeEditor value={inlineFile.draft} language={inlineFileExt} initialPosition={inlineFile.position} onInput={(v) => { if (inlineFile) inlineFile.draft = v; }} onVisibleLinesChange={(range) => onVisibleLinesChange?.(editorPath, range)} readonly={!canEditFiles || activeFsReadonly} />
              {:catch}
                <div class="flex h-full items-center justify-center text-[12px] text-error-soft">Editor failed to load.</div>
              {/await}
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
    >
      <div class="inline-file-preview flex h-full min-w-0 flex-col bg-bg-content" class:inline-file-preview--immersive={previewImmersiveMode}>
        <PreviewTabs tabs={previewTabs} onActivate={onActivatePreviewTab} onClose={onClosePreviewTab} />
        {#if inlineFile.loading}
          <div class="flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
            <span class="flex-1 truncate text-xs text-text-secondary">{inlineFile.path}</span>
            {@render FileHeaderCoreActions(inlineFile.path)}
            {@render PreviewFocusButton()}
            <button type="button" class="icon-btn" onclick={onCloseInlineFile} title="Close file">
              <X class="w-4 h-4" />
            </button>
          </div>
          <CenteredLoading label="Loading file…" size="panel" />
        {:else if inlineFile.error}
          <div class="flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
            <span class="flex-1 truncate text-xs text-text-secondary">{inlineFile.path}</span>
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
          <div class="flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
            <span class="flex-1 truncate text-xs text-text-secondary">{inlineFile.path}</span>
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
            <div class="flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
              {#if inlineFileCanGoBack}
                <button type="button" class="icon-btn" onclick={() => void onBackInlineFile()} title="Back">
                  <ArrowLeft class="w-4 h-4" />
                </button>
              {/if}
              <div class="min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
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
              {#if inlineFileViewMode === "diff" && showDiffMode}
                {#await loadFileDiffViewModule() then diffModule}
                  {@const LazyFileDiffView = diffModule.default}
                  <LazyFileDiffView
                    patch={inlineFileDiff}
                    loading={inlineFileDiffLoading}
                    error={inlineFileDiffError}
                  />
                {:catch}
                  <div class="flex h-full items-center justify-center text-[12px] text-error-soft">Diff failed to load.</div>
                {/await}
              {:else if inlineFileViewMode === "preview" && inlineFileHasRenderedPreview}
                {#await loadRenderedFilePreviewModule() then previewModule}
                  {@const LazyRenderedFilePreview = previewModule.default}
                  <LazyRenderedFilePreview
                    name={inlineFile.response.name}
                    source={inlineFile.draft}
                    type={inlineFileIsMarkdown ? "markdown" : "html"}
                    path={inlineFile.response.path}
                    spaceId={inlineFileSpaceId}
                    readonly={activeFsReadonly}
                    debugWork={inlineFileDebugWork}
                    onOpenFile={onOpenLinkedInlineFile}
                  />
                {:catch}
                  <div class="flex h-full items-center justify-center text-[12px] text-error-soft">Preview failed to load.</div>
                {/await}
              {:else}
                {#await loadCodeEditorModule() then editorModule}
                  {@const LazyCodeEditor = editorModule.default}
                  {@const editorPath = inlineFile.path}
                  <LazyCodeEditor
                    value={inlineFile.draft}
                    language={inlineFileExt}
                    initialPosition={inlineFile.position}
                    onInput={(v) => { if (inlineFile) inlineFile.draft = v; }}
                    onVisibleLinesChange={(range) => onVisibleLinesChange?.(editorPath, range)}
                    readonly={!canEditFiles || activeFsReadonly}
                  />
                {:catch}
                  <div class="flex h-full items-center justify-center text-[12px] text-error-soft">Editor failed to load.</div>
                {/await}
              {/if}
            </div>
          {:else if inlineFileIsImage && inlineFileDataUrl}
            <div class="flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
              <div class="min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
                {inlineFile.response.path}
              </div>
              <div class="text-xs text-text-tertiary hidden sm:inline">{formatFileSize(inlineFile.response.size)}</div>
              {@render FileHeaderCoreActions(inlineFile.response.path)}
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
          {:else if inlineFileIsVideo && inlineFileDataUrl}
            <div class="flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
              <div class="min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
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
            <div class="flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-surface px-3">
              <div class="min-w-0 flex-1 truncate text-xs sm:text-sm text-text-secondary">
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
  .inline-file-preview--immersive > :global(:first-child) {
    display: none;
  }
</style>
