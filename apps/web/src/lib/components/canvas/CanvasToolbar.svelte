<script lang="ts">
import {
	FilePlus2,
	Link as LinkIcon,
	LocateFixed,
	Maximize2,
	Minimize2,
	Minus,
	MousePointer2,
	Plus,
	Redo2,
	Type,
	Undo2,
	X,
} from "lucide-svelte";

const {
	title,
	dirty,
	saving,
	zoom,
	onAddFile,
	onAddUrl,
	onAddText,
	onZoomIn,
	onZoomOut,
	onFit,
	canUndo = false,
	canRedo = false,
	onUndo,
	onRedo,
	focused = false,
	onToggleFocus,
	onClose,
}: {
	title: string;
	dirty: boolean;
	saving: boolean;
	zoom: number;
	onAddFile: () => void;
	onAddUrl: () => void;
	onAddText: () => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onFit: () => void;
	canUndo?: boolean;
	canRedo?: boolean;
	onUndo?: () => void;
	onRedo?: () => void;
	focused?: boolean;
	onToggleFocus?: () => void;
	onClose: () => void;
} = $props();
</script>

<div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-content px-2.5">
  <div class="flex min-w-0 flex-1 items-center gap-2">
    <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-brand-border bg-brand-bg text-brand-muted-fg">
      <MousePointer2 class="h-3.5 w-3.5" />
    </div>
    <div class="min-w-0">
      <div class="truncate text-[12px] font-medium text-text-primary">{title}</div>
      <div class="text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{saving ? "Syncing" : dirty ? "Pending" : "Synced"}</div>
    </div>
  </div>

  <div class="flex min-w-0 items-center gap-1 overflow-x-auto">
    <button type="button" class="canvas-tool" onclick={onAddFile} title="Add file by path">
      <FilePlus2 class="h-3.5 w-3.5" />
      <span class="hidden sm:inline">File</span>
    </button>
    <button type="button" class="canvas-tool" onclick={onAddUrl} title="Add remote URL">
      <LinkIcon class="h-3.5 w-3.5" />
      <span class="hidden sm:inline">URL</span>
    </button>
    <button type="button" class="canvas-tool" onclick={onAddText} title="Add text note">
      <Type class="h-3.5 w-3.5" />
      <span class="hidden sm:inline">Text</span>
    </button>
    <div class="mx-1 h-5 w-px bg-border-subtle"></div>
    <button type="button" class="canvas-icon" onclick={onUndo} disabled={!canUndo} title="Undo"><Undo2 class="h-3.5 w-3.5" /></button>
    <button type="button" class="canvas-icon" onclick={onRedo} disabled={!canRedo} title="Redo"><Redo2 class="h-3.5 w-3.5" /></button>
    <div class="mx-1 h-5 w-px bg-border-subtle"></div>
    <button type="button" class="canvas-icon" onclick={onZoomOut} title="Zoom out"><Minus class="h-3.5 w-3.5" /></button>
    <span class="w-10 text-center text-[11px] tabular-nums text-text-tertiary">{Math.round(zoom * 100)}%</span>
    <button type="button" class="canvas-icon" onclick={onZoomIn} title="Zoom in"><Plus class="h-3.5 w-3.5" /></button>
    <button type="button" class="canvas-icon" onclick={onFit} title="Reset view"><LocateFixed class="h-3.5 w-3.5" /></button>
    <div class="mx-1 h-5 w-px bg-border-subtle"></div>
    <span class="canvas-sync-state">{saving ? "Syncing" : dirty ? "Pending" : "Synced"}</span>
    {#if onToggleFocus}
      <button type="button" class="canvas-icon" onclick={onToggleFocus} title={focused ? "Exit preview focus" : "Focus preview"} aria-label={focused ? "Exit preview focus" : "Focus preview"}>
        {#if focused}
          <Minimize2 class="h-3.5 w-3.5" />
        {:else}
          <Maximize2 class="h-3.5 w-3.5" />
        {/if}
      </button>
    {/if}
    <button type="button" class="canvas-icon" onclick={onClose} title="Close canvas"><X class="h-3.5 w-3.5" /></button>
  </div>
</div>

<style>
  .canvas-tool,
  .canvas-icon {
    display: inline-flex;
    height: 1.75rem;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    border-radius: 0.375rem;
    border: 1px solid transparent;
    padding: 0 0.5rem;
    color: var(--text-secondary);
    font-size: 11px;
    transition: background-color 100ms ease, color 100ms ease, border-color 100ms ease;
    white-space: nowrap;
  }
  .canvas-icon { width: 1.75rem; padding: 0; }
  .canvas-tool:hover,
  .canvas-icon:hover { background: var(--bg-hover); color: var(--text-primary); }
  .canvas-tool:disabled { cursor: not-allowed; opacity: 0.45; }
  .canvas-sync-state {
    display: inline-flex;
    align-items: center;
    height: 1.75rem;
    padding: 0 0.4rem;
    color: var(--text-tertiary);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }
</style>
