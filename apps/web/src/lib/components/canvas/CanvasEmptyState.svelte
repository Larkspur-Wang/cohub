<script lang="ts">
import { FilePlus2, Link as LinkIcon, Type } from "lucide-svelte";

const {
	onAddFile,
	onAddUrl,
	onAddText,
}: {
	onAddFile: () => void;
	onAddUrl: () => void;
	onAddText: () => void;
} = $props();
</script>

<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
  <div class="pointer-events-auto w-full max-w-sm rounded-xl border border-border-subtle bg-bg-content/95 p-4 shadow-sm">
    <div class="text-sm font-medium text-text-primary">Start your canvas</div>
    <div class="mt-1 text-xs leading-5 text-text-secondary">Drop files from the file tree, or add a URL / text note.</div>
    <div class="mt-4 flex flex-wrap gap-2">
      <button type="button" class="empty-action" onclick={onAddFile}><FilePlus2 class="h-3.5 w-3.5" />File</button>
      <button type="button" class="empty-action" onclick={onAddUrl}><LinkIcon class="h-3.5 w-3.5" />URL</button>
      <button type="button" class="empty-action" onclick={onAddText}><Type class="h-3.5 w-3.5" />Text</button>
    </div>
  </div>
</div>

<style>
  .empty-action {
    display: inline-flex;
    height: 1.875rem;
    align-items: center;
    gap: 0.375rem;
    border-radius: 0.375rem;
    border: 1px solid var(--border-subtle);
    padding: 0 0.625rem;
    color: var(--text-secondary);
    font-size: 12px;
  }
  .empty-action:hover { background: var(--bg-hover); color: var(--text-primary); }
</style>
