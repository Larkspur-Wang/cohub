<script lang="ts">
import {
	AlertCircle,
	FolderPlus,
	Lock,
	Plus,
	RefreshCw,
	Upload,
} from "lucide-svelte";
import FileUploadPane from "$lib/components/FileUploadPane.svelte";
import FsTreeItem from "$lib/components/FsTreeItem.svelte";
import type { SpaceFsNode } from "$lib/space-fs";

const {
	nodes,
	selectedPath,
	loading,
	error,
	onToggle,
	onSelect,
	onRefresh,
	onCreateFile,
	onCreateDir,
	onRename,
	onDelete,
	onUpload,
	isPinned,
	onTogglePin,
	canWrite = true,
}: {
	nodes: SpaceFsNode[];
	selectedPath: string;
	loading: boolean;
	error: string | null;
	onToggle: (node: SpaceFsNode) => void;
	onSelect: (node: SpaceFsNode) => void;
	onRefresh: () => void;
	onCreateFile: (parentPath: string) => void;
	onCreateDir: (parentPath: string) => void;
	onRename: (node: SpaceFsNode) => void;
	onDelete: (node: SpaceFsNode) => void;
	onUpload?: (files: File[], targetDir: string) => void;
	isPinned?: (node: SpaceFsNode) => boolean;
	onTogglePin?: (node: SpaceFsNode) => void;
	canWrite?: boolean;
} = $props();

function handleCreateFileAtRoot() {
	onCreateFile("");
}

function handleCreateDirAtRoot() {
	onCreateDir("");
}

function handleUploadClick() {
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = true;
	input.onchange = () => {
		if (input.files?.length && onUpload) {
			onUpload(Array.from(input.files), "");
		}
	};
	input.click();
}
</script>

<div class="flex h-full flex-col bg-bg-primary min-w-0 relative">
  <div class="flex items-center gap-1 border-b border-border-subtle px-3 py-2 shrink-0 [&_button]:cursor-pointer">
    <div class="min-w-0 flex-1">
      <div class="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">Files</div>
      <div class="text-[12px] text-text-secondary">Space files</div>
    </div>
    {#if canWrite}
      {#if onUpload}
        <button class="icon-btn" type="button" title="Upload files" onclick={handleUploadClick}>
          <Upload class="w-3.5 h-3.5" />
        </button>
      {/if}
      <button class="icon-btn" type="button" title="New file" onclick={handleCreateFileAtRoot}>
        <Plus class="w-3.5 h-3.5" />
      </button>
      <button class="icon-btn" type="button" title="New folder" onclick={handleCreateDirAtRoot}>
        <FolderPlus class="w-3.5 h-3.5" />
      </button>
    {:else}
      <div class="w-7 h-7 flex items-center justify-center text-text-tertiary" title="Read-only">
        <Lock class="w-3.5 h-3.5" />
      </div>
    {/if}
    <button class="icon-btn" type="button" title="Refresh" onclick={onRefresh}>
      <RefreshCw class="w-3.5 h-3.5 {loading ? 'animate-spin' : ''}" />
    </button>
  </div>

  {#if error}
    <div class="mx-3 mt-3 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-2 text-[12px] text-error-soft">
      <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{error}</span>
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-auto px-2 py-2">
    {#if nodes.length === 0 && !loading}
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
          {onCreateDir}
          {onRename}
          {onDelete}
          {onUpload}
          {isPinned}
          {onTogglePin}
          {canWrite}
        />
      {/each}
    {/if}
  </div>
</div>
