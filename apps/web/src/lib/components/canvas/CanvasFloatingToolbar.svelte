<script lang="ts">
import { Hand, MousePointer2, Plus, Redo2, Undo2 } from "lucide-svelte";
import type { CanvasEditor } from "$lib/canvas/editor.svelte";
import CanvasAddMenu from "$lib/components/canvas/CanvasAddMenu.svelte";

const { editor }: { editor: CanvasEditor } = $props();

let addMenuOpen = $state(false);
let addButton: HTMLButtonElement | null = $state(null);

function toggleAddMenu() {
	addMenuOpen = !addMenuOpen;
}

function closeAddMenu() {
	addMenuOpen = false;
}
</script>

<div class="canvas-floating-toolbar">
	<button
		type="button"
		class="tool-btn"
		class:tool-btn--active={editor.tool === "select"}
		title="Select (V)"
		aria-label="Select tool"
		onclick={() => { editor.tool = "select"; }}
	>
		<MousePointer2 class="h-4 w-4" />
	</button>
	<button
		type="button"
		class="tool-btn"
		class:tool-btn--active={editor.tool === "hand"}
		title="Pan (H)"
		aria-label="Pan tool"
		onclick={() => { editor.tool = "hand"; }}
	>
		<Hand class="h-4 w-4" />
	</button>

	<div class="divider"></div>

	<button
		type="button"
		bind:this={addButton}
		class="tool-btn"
		class:tool-btn--active={addMenuOpen}
		title="Add file, URL, or text"
		aria-label="Add to canvas"
		aria-expanded={addMenuOpen}
		onclick={toggleAddMenu}
	>
		<Plus class="h-4 w-4" />
	</button>

	<div class="divider"></div>

	<button
		type="button"
		class="tool-btn"
		title="Undo"
		aria-label="Undo"
		disabled={!editor.canUndo}
		onclick={() => editor.undo()}
	>
		<Undo2 class="h-4 w-4" />
	</button>
	<button
		type="button"
		class="tool-btn"
		title="Redo"
		aria-label="Redo"
		disabled={!editor.canRedo}
		onclick={() => editor.redo()}
	>
		<Redo2 class="h-4 w-4" />
	</button>
</div>

{#if addMenuOpen}
	<CanvasAddMenu {editor} getAnchor={() => addButton} onClose={closeAddMenu} />
{/if}

<style>
	.canvas-floating-toolbar {
		position: absolute;
		bottom: 14px;
		left: 50%;
		z-index: 25;
		display: flex;
		align-items: center;
		gap: 2px;
		transform: translateX(-50%);
		border-radius: 10px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
		padding: 4px;
		box-shadow: 0 10px 24px color-mix(in srgb, var(--overlay-scrim-strong) 16%, transparent);
		backdrop-filter: blur(12px);
	}

	.tool-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 7px;
		border: 1px solid transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease, border-color 100ms ease;
	}
	.tool-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
	.tool-btn--active {
		background: var(--brand-bg);
		border-color: var(--brand-border);
		color: var(--brand-muted-fg);
	}
	.tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.divider {
		width: 1px;
		height: 18px;
		margin: 0 3px;
		background: var(--border-subtle);
	}
</style>
