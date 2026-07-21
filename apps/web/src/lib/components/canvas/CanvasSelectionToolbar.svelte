<script lang="ts">
import { ArrowDownToLine, ArrowUpToLine, Copy, Trash2 } from "lucide-svelte";
import { CANVAS_COLORS } from "$lib/canvas/core/palette";
import type { CanvasEditor } from "$lib/canvas/editor.svelte";

const { editor }: { editor: CanvasEditor } = $props();

const visible = $derived(
	editor.selection.length > 0 &&
		editor.interaction.type !== "brushing" &&
		!editor.editingId,
);

const position = $derived.by(() => {
	const bounds = editor.bounds;
	if (!bounds) return null;
	const camera = editor.camera;
	return {
		left: (bounds.x + bounds.width / 2) * camera.zoom + camera.x,
		top: bounds.y * camera.zoom + camera.y,
	};
});

/**
 * The selection's color state for the palette:
 * - `undefined` — no color-bearing shape selected (hide the palette);
 * - a color id — every color-bearing shape shares it (highlight that swatch);
 * - `null` — mixed colors (no highlight).
 */
const currentColor = $derived.by<string | null | undefined>(() => {
	const colors = editor.selectedItems
		.filter(
			(item) =>
				item.type === "note" ||
				item.type === "geo" ||
				item.type === "draw" ||
				item.type === "arrow",
		)
		.map((item) => item.color);
	if (colors.length === 0) return undefined;
	return colors.every((color) => color === colors[0])
		? (colors[0] ?? null)
		: null;
});
</script>

{#if visible && position}
	<div
		class="canvas-selection-toolbar"
		style:left="{position.left}px"
		style:top="{position.top}px"
		role="toolbar"
		aria-label="Selection actions"
	>
		{#if currentColor !== undefined}
			<div class="flex items-center gap-1 px-1">
				{#each CANVAS_COLORS as color (color.id)}
					<button
						type="button"
						class="swatch"
						class:swatch--active={currentColor === color.id}
						title={color.label}
						aria-label="Set {color.label} color"
						style:--swatch-color={`#${color.dark.stroke.toString(16).padStart(6, "0")}`}
						onclick={() => editor.setSelectionColor(color.id)}
					></button>
				{/each}
			</div>
			<div class="divider"></div>
		{/if}

		<button type="button" class="sel-btn" title="Bring to front" aria-label="Bring to front" onclick={() => editor.bringToFront()}>
			<ArrowUpToLine class="h-3.5 w-3.5" />
		</button>
		<button type="button" class="sel-btn" title="Send to back" aria-label="Send to back" onclick={() => editor.sendToBack()}>
			<ArrowDownToLine class="h-3.5 w-3.5" />
		</button>

		<div class="divider"></div>

		<button type="button" class="sel-btn" title="Duplicate" aria-label="Duplicate" onclick={() => editor.duplicateSelection()}>
			<Copy class="h-3.5 w-3.5" />
		</button>
		<button type="button" class="sel-btn sel-btn--danger" title="Delete" aria-label="Delete" onclick={() => editor.deleteSelection()}>
			<Trash2 class="h-3.5 w-3.5" />
		</button>
	</div>
{/if}

<style>
	.canvas-selection-toolbar {
		position: absolute;
		z-index: 24;
		display: flex;
		align-items: center;
		gap: 2px;
		transform: translate(-50%, calc(-100% - 12px));
		border-radius: 9px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
		padding: 4px;
		box-shadow: 0 8px 20px color-mix(in srgb, var(--overlay-scrim-strong) 14%, transparent);
		backdrop-filter: blur(12px);
		white-space: nowrap;
	}

	.swatch {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1.5px solid var(--border-subtle);
		background: var(--swatch-color);
		cursor: pointer;
		transition: transform 100ms ease, border-color 100ms ease;
	}
	.swatch:hover { transform: scale(1.15); }
	.swatch--active {
		border-color: var(--text-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--swatch-color) 40%, transparent);
	}

	.sel-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease;
	}
	.sel-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
	.sel-btn--danger:hover { background: var(--error-bg); color: var(--error-700); }

	.divider {
		width: 1px;
		height: 16px;
		margin: 0 3px;
		background: var(--border-subtle);
	}
</style>
