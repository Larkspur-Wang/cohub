<script lang="ts">
import type { SpaceFsFileResponse } from "@neta-art/cohub";
import {
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
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import type { WorkspaceFileLinkTarget } from "$lib/workspace-file-links";
import { formatFileSize } from "../space-utils";

type PanHandlers = {
	start: (event: MouseEvent) => void;
};

type Props = {
	routeFilePath: string | null;
	openFileLoading: boolean;
	openFileError: string | null;
	openFileTooLarge: boolean;
	openFile: SpaceFsFileResponse | null;
	openFileDownloadUrl: string;
	openFileDownloadName: string;
	openFileIsText: boolean;
	openFileHasRenderedPreview: boolean;
	openFileIsMarkdown: boolean;
	openFileIsHtml: boolean;
	openFileIsImage: boolean;
	openFileIsVideo: boolean;
	openFileDataUrl: string | null;
	openFileDraft: string;
	openFileExt: string;
	fileEdit: boolean;
	openFileCopied: boolean;
	openFileSaving: boolean;
	fileDirty: boolean;
	canEditFiles: boolean;
	activeFsReadonly: boolean;
	fileActionMenuOpenPath: string | null;
	openFileZoom: number;
	openFilePanX: number;
	openFilePanY: number;
	openFileDragging: boolean;
	openFilePanHandlers: PanHandlers;
	onCloseFile: () => void;
	onDownloadOpenFile: () => void | Promise<void>;
	onPublishOpenFile: () => void;
	onCopyFileContent: () => void | Promise<void>;
	onSaveOpenFile: () => void | Promise<void>;
	onLabelFile: (path: string) => void | Promise<void>;
	onInsertFilePathReference: (path: string) => void;
	onDownloadFilePath: (path: string) => void | Promise<void>;
	onRenameFilePath: (path: string) => void | Promise<void>;
	onDeleteFilePath: (path: string) => void | Promise<void>;
	onOpenLinkedInlineFile?: (
		target: string | WorkspaceFileLinkTarget,
	) => void | Promise<void>;
};

let {
	routeFilePath,
	openFileLoading,
	openFileError,
	openFileTooLarge,
	openFile,
	openFileDownloadUrl,
	openFileDownloadName,
	openFileIsText,
	openFileHasRenderedPreview,
	openFileIsMarkdown,
	openFileIsHtml,
	openFileIsImage,
	openFileIsVideo,
	openFileDataUrl,
	openFileDraft = $bindable(),
	openFileExt,
	fileEdit = $bindable(),
	openFileCopied,
	openFileSaving,
	fileDirty,
	canEditFiles,
	activeFsReadonly,
	fileActionMenuOpenPath = $bindable(),
	openFileZoom = $bindable(),
	openFilePanX = $bindable(),
	openFilePanY = $bindable(),
	openFileDragging,
	openFilePanHandlers,
	onCloseFile,
	onDownloadOpenFile,
	onPublishOpenFile,
	onCopyFileContent,
	onSaveOpenFile,
	onLabelFile,
	onInsertFilePathReference,
	onDownloadFilePath,
	onRenameFilePath,
	onDeleteFilePath,
	onOpenLinkedInlineFile,
}: Props = $props();

let codeEditorModulePromise: Promise<
	typeof import("$lib/components/CodeEditor.svelte")
> | null = null;
let renderedFilePreviewModulePromise: Promise<
	typeof import("$lib/components/RenderedFilePreview.svelte")
> | null = null;

function loadCodeEditorModule() {
	if (!codeEditorModulePromise) {
		codeEditorModulePromise = import("$lib/components/CodeEditor.svelte");
	}
	return codeEditorModulePromise;
}

function loadRenderedFilePreviewModule() {
	if (!renderedFilePreviewModulePromise) {
		renderedFilePreviewModulePromise = import(
			"$lib/components/RenderedFilePreview.svelte"
		);
	}
	return renderedFilePreviewModulePromise;
}
</script>

{#snippet FileHeaderCoreActions(path: string)}
	<div class="relative shrink-0" data-resource-actions>
		<button
			type="button"
			class="icon-btn"
			onclick={(event) => {
				event.stopPropagation();
				fileActionMenuOpenPath = fileActionMenuOpenPath === path ? null : path;
			}}
			title="More actions"
			aria-haspopup="menu"
			aria-expanded={fileActionMenuOpenPath === path}
		>
			<MoreHorizontal class="w-4 h-4" />
		</button>
		{#if fileActionMenuOpenPath === path}
			<div class="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-md border border-border-subtle bg-bg-primary py-1 shadow-lg" role="menu">
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

{#if openFileLoading && openFile?.path !== routeFilePath}
  <CenteredLoading label="Loading file…" size="panel" />
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
      {#if routeFilePath}
        {@render FileHeaderCoreActions(routeFilePath)}
      {/if}
      <button type="button" class="icon-btn" onclick={onCloseFile} title="Close file">
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
          onclick={(e) => { e.preventDefault(); void onDownloadOpenFile(); }}
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
        {#if openFileHasRenderedPreview}
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
              title={openFileIsMarkdown ? "Preview markdown" : "Preview HTML"}
            >
              Preview
            </button>
          </div>
        {/if}
        {@render FileHeaderCoreActions(openFile.path)}
        {#if openFileIsHtml && !fileEdit}
          <button type="button" class="action-btn" onclick={onPublishOpenFile} title="Publish work">
            <Rocket class="w-3.5 h-3.5 shrink-0" />
            <span class="hidden sm:inline">Publish</span>
          </button>
        {/if}
        <button type="button" class="icon-btn" onclick={() => void onCopyFileContent()} title="Copy content">
          {#if openFileCopied}
            <Check class="w-4 h-4 text-success-soft" />
          {:else}
            <Copy class="w-4 h-4" />
          {/if}
        </button>
        <button
          type="button"
          class="action-btn"
          onclick={onSaveOpenFile}
          disabled={openFileSaving || !fileDirty || !canEditFiles}
          title="Save (Ctrl+S)"
        >
          <Save class="w-3.5 h-3.5 shrink-0" />
          <span class="hidden sm:inline">Save</span>
        </button>
        <button type="button" class="icon-btn" onclick={onCloseFile} title="Close file">
          <X class="w-4 h-4" />
        </button>
      </div>
      <div class="flex-1 min-h-0">
        {#if fileEdit}
          {#await loadCodeEditorModule() then editorModule}
            {@const LazyCodeEditor = editorModule.default}
            <LazyCodeEditor
              value={openFileDraft}
              language={openFileExt}
              onInput={(v) => openFileDraft = v}
              readonly={!canEditFiles}
            />
          {:catch}
            <div class="flex h-full items-center justify-center text-[12px] text-error-soft">Editor failed to load.</div>
          {/await}
        {:else if openFileHasRenderedPreview}
          {#await loadRenderedFilePreviewModule() then previewModule}
            {@const LazyRenderedFilePreview = previewModule.default}
            <LazyRenderedFilePreview
              name={openFile.name}
              source={openFileDraft}
              type={openFileIsMarkdown ? "markdown" : "html"}
              path={openFile.path}
              onOpenFile={onOpenLinkedInlineFile}
            />
          {:catch}
            <div class="flex h-full items-center justify-center text-[12px] text-error-soft">Preview failed to load.</div>
          {/await}
        {:else}
          {#await loadCodeEditorModule() then editorModule}
            {@const LazyCodeEditor = editorModule.default}
            <LazyCodeEditor
              value={openFileDraft}
              language={openFileExt}
              readonly={true}
            />
          {:catch}
            <div class="flex h-full items-center justify-center text-[12px] text-error-soft">Editor failed to load.</div>
          {/await}
        {/if}
      </div>
    {:else if openFileIsImage && openFileDataUrl}
      <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
        <div class="min-w-0 flex-1 truncate text-[11px] sm:text-[12px] text-text-secondary">
          {openFile.path}
        </div>
        <div class="text-[11px] text-text-tertiary hidden sm:inline">{formatFileSize(openFile.size)}</div>
        {@render FileHeaderCoreActions(openFile.path)}
        <button type="button" class="zoom-btn" onclick={() => { openFileZoom = Math.max(0.25, openFileZoom - 0.25); openFilePanX = 0; openFilePanY = 0; }} title="Zoom out">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="7" y1="11" x2="15" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        <span class="text-[11px] text-text-tertiary tabular-nums w-10 text-center">{Math.round(openFileZoom * 100)}%</span>
        <button type="button" class="zoom-btn" onclick={() => { openFileZoom = Math.min(4, openFileZoom + 0.25); openFilePanX = 0; openFilePanY = 0; }} title="Zoom in">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="11" y1="7" x2="11" y2="15"/><line x1="7" y1="11" x2="15" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        <button type="button" class="icon-btn" onclick={onCloseFile} title="Close file">
          <X class="w-4 h-4" />
        </button>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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
        {@render FileHeaderCoreActions(openFile.path)}
        <button type="button" class="icon-btn" onclick={onCloseFile} title="Close file">
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
        {@render FileHeaderCoreActions(openFile.path)}
        <button type="button" class="icon-btn" onclick={onCloseFile} title="Close file">
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
