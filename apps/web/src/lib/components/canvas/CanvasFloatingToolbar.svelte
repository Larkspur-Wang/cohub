<script lang="ts">
import {
	ArrowUpRight,
	Eraser,
	Hand,
	MousePointer2,
	Pencil,
	Plus,
	Redo2,
	Square,
	StickyNote,
	Type,
	Undo2,
} from "lucide-svelte";
import { CANVAS_COLORS } from "$lib/canvas/core/palette";
import { GEO_KINDS } from "$lib/canvas/core/shape-types";
import type { CanvasEditor, CanvasToolId } from "$lib/canvas/editor.svelte";
import CanvasAddMenu from "$lib/components/canvas/CanvasAddMenu.svelte";

const { editor }: { editor: CanvasEditor } = $props();

let addMenuOpen = $state(false);
let addButton: HTMLButtonElement | null = $state(null);

type ToolDef = {
	id: CanvasToolId;
	label: string;
	shortcut: string;
	icon: typeof MousePointer2;
	/** Tools that consume the active color (show the palette while active). */
	usesColor: boolean;
};

const TOOLS: ToolDef[] = [
	{
		id: "select",
		label: "Select",
		shortcut: "V",
		icon: MousePointer2,
		usesColor: false,
	},
	{ id: "hand", label: "Hand", shortcut: "H", icon: Hand, usesColor: false },
	{ id: "text", label: "Text", shortcut: "T", icon: Type, usesColor: false },
	{
		id: "note",
		label: "Note",
		shortcut: "N",
		icon: StickyNote,
		usesColor: true,
	},
	{ id: "geo", label: "Shape", shortcut: "G", icon: Square, usesColor: true },
	{ id: "draw", label: "Draw", shortcut: "D", icon: Pencil, usesColor: true },
	{
		id: "arrow",
		label: "Arrow",
		shortcut: "A",
		icon: ArrowUpRight,
		usesColor: true,
	},
	{
		id: "eraser",
		label: "Eraser",
		shortcut: "E",
		icon: Eraser,
		usesColor: false,
	},
];

const activeTool = $derived(TOOLS.find((t) => t.id === editor.tool));
const showPalette = $derived(Boolean(activeTool?.usesColor));

const GEO_LABELS: Record<string, string> = {
	rectangle: "Rectangle",
	rounded: "Rounded",
	ellipse: "Ellipse",
	diamond: "Diamond",
	triangle: "Triangle",
};

function selectTool(id: CanvasToolId) {
	editor.tool = id;
	addMenuOpen = false;
}

function toggleAddMenu() {
	addMenuOpen = !addMenuOpen;
}

function closeAddMenu() {
	addMenuOpen = false;
}
</script>

<div class="canvas-toolbar-wrap">
	<!-- Style row: color palette + shape picker, shown for color-using tools. -->
	{#if showPalette}
		<div class="canvas-style-row" role="toolbar" aria-label="Shape style">
			{#each CANVAS_COLORS as color (color.id)}
				<button
					type="button"
					class="color-swatch"
					class:color-swatch--active={editor.activeColor === color.id}
					title={color.label}
					aria-label="Use {color.label}"
					style:--swatch={color.dark.stroke ? `#${color.dark.stroke.toString(16).padStart(6, "0")}` : "#888"}
					onclick={() => { editor.activeColor = color.id; }}
				></button>
			{/each}
			{#if editor.tool === "geo"}
				<div class="style-divider"></div>
				{#each GEO_KINDS as geo (geo)}
					<button
						type="button"
						class="geo-btn"
						class:geo-btn--active={editor.activeGeo === geo}
						title={GEO_LABELS[geo] ?? geo}
						aria-label="Use {GEO_LABELS[geo] ?? geo}"
						onclick={() => { editor.activeGeo = geo; }}
					>
						{GEO_LABELS[geo]?.[0] ?? geo[0]}
					</button>
				{/each}
			{/if}
		</div>
	{/if}

	<div class="canvas-floating-toolbar" role="toolbar" aria-label="Canvas tools">
		{#each TOOLS as tool (tool.id)}
			<button
				type="button"
				class="tool-btn"
				class:tool-btn--active={editor.tool === tool.id}
				title="{tool.label} ({tool.shortcut})"
				aria-label="{tool.label} tool"
				aria-pressed={editor.tool === tool.id}
				onclick={() => selectTool(tool.id)}
			>
				<tool.icon class="h-4 w-4" />
			</button>
		{/each}

		<div class="divider"></div>

		<button
			type="button"
			bind:this={addButton}
			class="tool-btn"
			class:tool-btn--active={addMenuOpen}
			title="Add file or URL"
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
</div>

{#if addMenuOpen}
	<CanvasAddMenu {editor} getAnchor={() => addButton} onClose={closeAddMenu} />
{/if}

<style>
	.canvas-toolbar-wrap {
		position: absolute;
		bottom: 14px;
		left: 50%;
		z-index: 25;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		transform: translateX(-50%);
	}

	.canvas-style-row {
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: 9px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
		padding: 4px 6px;
		box-shadow: 0 8px 20px color-mix(in srgb, var(--overlay-scrim-strong) 14%, transparent);
		backdrop-filter: blur(12px);
	}

	.color-swatch {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1.5px solid var(--border-subtle);
		background: var(--swatch);
		cursor: pointer;
		transition: transform 100ms ease, border-color 100ms ease;
	}
	.color-swatch:hover { transform: scale(1.15); }
	.color-swatch--active {
		border-color: var(--text-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--swatch) 45%, transparent);
	}

	.geo-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		border: 1px solid transparent;
		color: var(--text-secondary);
		font-size: 10px;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease;
	}
	.geo-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
	.geo-btn--active {
		background: var(--brand-bg);
		border-color: var(--brand-border);
		color: var(--brand-muted-fg);
	}

	.style-divider {
		width: 1px;
		height: 16px;
		margin: 0 2px;
		background: var(--border-subtle);
	}

	.canvas-floating-toolbar {
		display: flex;
		align-items: center;
		gap: 2px;
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

	/* Mobile: larger touch targets. */
	@media (pointer: coarse) {
		.tool-btn { width: 40px; height: 40px; }
		.color-swatch { width: 26px; height: 26px; }
		.geo-btn { width: 30px; height: 30px; }
	}
</style>
