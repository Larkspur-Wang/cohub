<script lang="ts">
import { Trash2 } from "lucide-svelte";
import { getResourceTitle } from "$lib/canvas/canvas-media";
import type { CanvasItem } from "$lib/canvas/canvas-schema";

const {
	item,
	onDelete,
	onEditText,
}: {
	item: CanvasItem | null;
	onDelete: (id: string) => void;
	onEditText: (id: string) => void;
} = $props();

const title = $derived.by(() => {
	if (!item) return "";
	if (item.type === "text") return item.text.split("\n")[0] || "Text note";
	return (
		item.snapshot?.title ??
		(item.ref.kind === "space-file"
			? getResourceTitle(item.ref.path)
			: getResourceTitle(item.ref.url))
	);
});
</script>

{#if item}
  <div class="absolute bottom-3 right-3 w-[min(280px,calc(100%-24px))] rounded-lg border border-border-subtle bg-bg-content p-3 shadow-sm">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <div class="truncate text-xs font-medium text-text-primary">{title}</div>
        <div class="mt-1 text-[11px] text-text-tertiary">
          {item.type === "text" ? "Text" : item.ref.kind === "space-file" ? "Space file" : "Remote URL"}
        </div>
      </div>
      <button type="button" class="inspector-icon" onclick={() => onDelete(item.id)} title="Delete item">
        <Trash2 class="h-3.5 w-3.5" />
      </button>
    </div>
    <div class="mt-2 grid grid-cols-4 gap-1 text-[10px] text-text-tertiary">
      <span>x {Math.round(item.frame.x)}</span>
      <span>y {Math.round(item.frame.y)}</span>
      <span>w {Math.round(item.frame.width)}</span>
      <span>h {Math.round(item.frame.height)}</span>
    </div>
    {#if item.type === "text"}
      <button type="button" class="mt-2 text-[11px] text-brand-muted-fg hover:text-text-primary" onclick={() => onEditText(item.id)}>Edit text</button>
    {/if}
  </div>
{/if}

<style>
  .inspector-icon {
    display: inline-flex;
    height: 1.5rem;
    width: 1.5rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.375rem;
    color: var(--text-tertiary);
  }
  .inspector-icon:hover { background: var(--bg-hover); color: var(--error-700); }
</style>
