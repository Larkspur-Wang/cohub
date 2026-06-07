<script lang="ts">
import type { SpacePublicEndpoints } from "@cohub/protocol/ports";
import {
	AlertCircle,
	ChevronDown,
	Lock,
	Plus,
	RefreshCw,
	Upload,
} from "lucide-svelte";
import { tick } from "svelte";
import FileUploadPane from "$lib/components/FileUploadPane.svelte";
import FsTreeItem from "$lib/components/FsTreeItem.svelte";
import SpacePreviewPorts from "$lib/components/SpacePreviewPorts.svelte";
import type { SpaceFsNode } from "$lib/space-fs";
import {
	entriesFromDataTransfer,
	entriesFromFiles,
	type LocalUploadEntry,
} from "$lib/upload-entries";

const {
	nodes,
	selectedPath,
	loading,
	error,
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
	onOpenPort,
	activePort = null,
	draggable = true,
	showItemActions = true,
	canWrite = true,
	previewEndpoints = {},
}: {
	nodes: SpaceFsNode[];
	selectedPath: string;
	loading: boolean;
	error: string | null;
	onToggle: (node: SpaceFsNode) => void;
	onSelect: (node: SpaceFsNode) => void;
	onRefresh: () => void;
	onCreateFile: (parentPath: string) => void;
	onCreateCanvas?: (parentPath: string) => void;
	onCreateDir: (parentPath: string) => void;
	onRename: (node: SpaceFsNode) => void;
	onDelete: (node: SpaceFsNode) => void;
	onDownload?: (node: SpaceFsNode) => void;
	onUpload?: (files: File[] | LocalUploadEntry[], targetDir: string) => void;
	onInsertReference?: (path: string) => void;
	onOpenPort?: (port: string, url: string) => void;
	activePort?: string | null;
	draggable?: boolean;
	showItemActions?: boolean;
	canWrite?: boolean;
	previewEndpoints?: SpacePublicEndpoints;
} = $props();

let treeScrollContainer: HTMLDivElement | null = $state(null);
let rootDragOver = $state(false);

// Dropdown state
let newMenuOpen = $state(false);
let uploadMenuOpen = $state(false);
let newMenuEl: HTMLDivElement | null = $state(null);
let uploadMenuEl: HTMLDivElement | null = $state(null);

function closeMenus() {
	newMenuOpen = false;
	uploadMenuOpen = false;
}

function toggleNewMenu() {
	newMenuOpen = !newMenuOpen;
	uploadMenuOpen = false;
}

function toggleUploadMenu() {
	uploadMenuOpen = !uploadMenuOpen;
	newMenuOpen = false;
}

function handleCreateFileAtRoot() {
	closeMenus();
	onCreateFile("");
}

function handleCreateDirAtRoot() {
	closeMenus();
	onCreateDir("");
}

function handleCreateCanvasAtRoot() {
	closeMenus();
	onCreateCanvas?.("");
}

function openUploadPicker(folder = false) {
	closeMenus();
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = true;
	if (folder) input.setAttribute("webkitdirectory", "");
	input.onchange = () => {
		if (input.files?.length && onUpload) {
			onUpload(entriesFromFiles(Array.from(input.files)), "");
		}
	};
	input.click();
}

function handleUploadClick() {
	openUploadPicker(false);
}

function handleFolderUploadClick() {
	openUploadPicker(true);
}

async function handleRootDrop(e: DragEvent) {
	if (!onUpload) return;
	e.preventDefault();
	e.stopPropagation();
	rootDragOver = false;
	if (!e.dataTransfer || e.dataTransfer.types.includes("text/cohub-path"))
		return;
	const entries = await entriesFromDataTransfer(e.dataTransfer);
	if (entries.length > 0) onUpload(entries, "");
}

$effect(() => {
	const path = selectedPath;
	const container = treeScrollContainer;
	if (!path || !container || container.clientHeight === 0) return;

	void tick().then(() => {
		if (selectedPath !== path || !treeScrollContainer) return;
		const selectedItem = treeScrollContainer.querySelector<HTMLElement>(
			`[data-space-file-path="${CSS.escape(path)}"]`,
		);
		selectedItem?.scrollIntoView({
			block: "center",
			inline: "nearest",
			behavior: "smooth",
		});
	});
});

// Close menus on outside click
$effect(() => {
	if (!newMenuOpen && !uploadMenuOpen) return;
	function onClick(e: MouseEvent) {
		if (newMenuEl?.contains(e.target as Node)) return;
		if (uploadMenuEl?.contains(e.target as Node)) return;
		closeMenus();
	}
	document.addEventListener("click", onClick, true);
	return () => document.removeEventListener("click", onClick, true);
});
</script>

<div class="flex h-full flex-col bg-bg-primary min-w-0 relative">
  <div class="flex items-center gap-2 border-b border-border-subtle px-3 py-2 shrink-0 [&_button]:cursor-pointer">
    <div class="min-w-0 flex-1">
      <div class="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">Files</div>
      <div class="text-[12px] text-text-secondary">Space files</div>
    </div>
    {#if canWrite}
      <div class="relative">
        <button class="icon-btn" type="button" onclick={toggleNewMenu} aria-expanded={newMenuOpen}>
          <Plus class="w-4 h-4" />
          <span class="sr-only">New</span>
        </button>
        {#if newMenuOpen}
          <div class="dropdown" bind:this={newMenuEl}>
            <button type="button" class="dropdown-item" onclick={handleCreateFileAtRoot}>
              <Plus class="w-3.5 h-3.5" />
              New file
            </button>
            {#if onCreateCanvas}
              <button type="button" class="dropdown-item" onclick={handleCreateCanvasAtRoot}>
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>
                New canvas
              </button>
            {/if}
            <button type="button" class="dropdown-item" onclick={handleCreateDirAtRoot}>
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M12 10v6"/><path d="M9 13h6"/></svg>
              New folder
            </button>
          </div>
        {/if}
      </div>
      {#if onUpload}
        <div class="relative">
          <button class="icon-btn" type="button" onclick={toggleUploadMenu} aria-expanded={uploadMenuOpen}>
            <Upload class="w-4 h-4" />
            <span class="sr-only">Upload</span>
          </button>
          {#if uploadMenuOpen}
            <div class="dropdown" bind:this={uploadMenuEl}>
              <button type="button" class="dropdown-item" onclick={handleUploadClick}>
                <Upload class="w-3.5 h-3.5" />
                Upload files
              </button>
              <button type="button" class="dropdown-item" onclick={handleFolderUploadClick}>
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M12 10V16"/><path d="m15 13-3-3-3 3"/></svg>
                Upload folder
              </button>
            </div>
          {/if}
        </div>
      {/if}
    {:else}
      <div class="w-8 h-8 flex items-center justify-center text-text-tertiary" title="Read-only">
        <Lock class="w-4 h-4" />
      </div>
    {/if}
    <button class="icon-btn" type="button" title="Refresh" onclick={onRefresh}>
      <RefreshCw class="w-4 h-4 {loading ? 'animate-spin' : ''}" />
    </button>
  </div>

  <SpacePreviewPorts endpoints={previewEndpoints} {activePort} onOpen={onOpenPort} />

  {#if error}
    <div class="mx-3 mt-3 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-2 text-[12px] text-error-soft">
      <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
      <span>{error}</span>
    </div>
  {/if}

  <div
    class="min-h-0 flex-1 overflow-auto px-2 py-2 {rootDragOver ? 'outline outline-1 outline-brand/60 outline-offset-[-2px]' : ''}"
    bind:this={treeScrollContainer}
    role="tree"
    tabindex="0"
    ondragover={(e) => { if (!onUpload || e.dataTransfer?.types.includes("text/cohub-path")) return; e.preventDefault(); rootDragOver = true; }}
    ondragleave={() => { rootDragOver = false; }}
    ondrop={handleRootDrop}
  >
    {#if nodes.length === 0 && loading}
      <div class="flex items-center gap-2 px-2 py-3 text-[12px] text-text-tertiary">
        <RefreshCw class="h-3 w-3 animate-spin" />
        <span>Loading files…</span>
      </div>
    {:else if nodes.length === 0}
      <div class="px-2 py-3 text-[12px] text-text-tertiary">No files</div>
    {:else}
      {#each nodes as node (node.path)}
        <FsTreeItem
          {node}
          depth={0}
          {selectedPath}
          {onToggle}
          {onSelect}
          {onCreateFile}
          {onCreateCanvas}
          {onCreateDir}
          {onRename}
          {onDelete}
          {onDownload}
          {onUpload}
          {onInsertReference}
          {draggable}
          {showItemActions}
          {canWrite}
        />
      {/each}
    {/if}
  </div>
</div>

<style>
  .relative { position: relative; }

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
    cursor: pointer;
  }

  .icon-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }

  .dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 100;
    min-width: 150px;
    padding: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .dropdown-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .dropdown-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
