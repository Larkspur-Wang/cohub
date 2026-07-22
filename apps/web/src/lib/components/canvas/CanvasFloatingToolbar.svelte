<script lang="ts">
import {
	ArrowUpRight,
	ChevronUp,
	Frame,
	Hand,
	MousePointer2,
	Pencil,
	Pin,
	Redo2,
	Square,
	StickyNote,
	Type,
	Undo2,
} from "lucide-svelte";
import { CANVAS_COLORS, canvasColorCssVar } from "$lib/canvas/core/palette";
import { GEO_KINDS } from "$lib/canvas/core/shape-types";
import type { CanvasEditor, CanvasToolId } from "$lib/canvas/editor.svelte";

const {
	editor,
	immersive = false,
}: { editor: CanvasEditor; immersive?: boolean } = $props();

let lockTimer: ReturnType<typeof setTimeout> | null = null;
let moreOpen = $state(false);

type ToolDef = {
	id: CanvasToolId;
	label: string;
	shortcut: string;
	icon: typeof MousePointer2;
	/** Tools that consume the active color (show the palette while active). */
	usesColor: boolean;
	/** Shown behind "More" on narrow touch layouts. */
	secondary?: boolean;
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
	{ id: "draw", label: "Draw", shortcut: "D", icon: Pencil, usesColor: true },
	{
		id: "arrow",
		label: "Arrow",
		shortcut: "A",
		icon: ArrowUpRight,
		usesColor: true,
	},
	{ id: "text", label: "Text", shortcut: "T", icon: Type, usesColor: true },
	{
		id: "note",
		label: "Note",
		shortcut: "N",
		icon: StickyNote,
		usesColor: true,
	},
	{ id: "geo", label: "Shape", shortcut: "G", icon: Square, usesColor: true },
	{
		id: "frame",
		label: "Frame",
		shortcut: "F",
		icon: Frame,
		usesColor: true,
		secondary: true,
	},
];

const primaryTools = $derived(TOOLS.filter((tool) => !tool.secondary));
const secondaryTools = $derived(TOOLS.filter((tool) => tool.secondary));
const activeTool = $derived(TOOLS.find((t) => t.id === editor.tool));
const showPalette = $derived(Boolean(activeTool?.usesColor));
const secondaryActive = $derived(
	secondaryTools.some((tool) => tool.id === editor.tool),
);

const GEO_LABELS: Record<string, string> = {
	rectangle: "Rectangle",
	rounded: "Rounded",
	ellipse: "Ellipse",
	diamond: "Diamond",
	triangle: "Triangle",
};

function selectTool(id: CanvasToolId) {
	editor.tool = id;
	// Select / Hand are navigation modes — clear any leftover lock.
	// Creation tools stay hot after each stroke (tldraw-style continuous draw).
	if (id === "select" || id === "hand") editor.toolLocked = false;
	moreOpen = false;
}

function onToolPointerDown(id: CanvasToolId) {
	if (lockTimer) clearTimeout(lockTimer);
	// Long-press still force-locks (e.g. keep Text after commit).
	if (id === "select" || id === "hand") return;
	lockTimer = setTimeout(() => {
		editor.tool = id;
		editor.toolLocked = true;
		lockTimer = null;
	}, 450);
}

function onToolPointerUp() {
	if (lockTimer) {
		clearTimeout(lockTimer);
		lockTimer = null;
	}
}

function toggleToolLock() {
	editor.toolLocked = !editor.toolLocked;
}

function toolTitle(tool: ToolDef) {
	const locked =
		editor.tool === tool.id && editor.toolLocked ? " · locked" : "";
	const stay =
		tool.id === "draw" || tool.id === "arrow" ? " · stay active" : "";
	return `${tool.label} (${tool.shortcut})${locked || stay}`;
}
</script>

<div class="canvas-toolbar-wrap" class:canvas-toolbar-wrap--immersive={immersive}>
	{#if showPalette}
		<div class="canvas-style-row" role="toolbar" aria-label="Shape style">
			{#each CANVAS_COLORS as color (color.id)}
				<button
					type="button"
					class="color-swatch"
					class:color-swatch--active={editor.activeColor === color.id}
					title={color.label}
					aria-label="Use {color.label}"
					style:--swatch="var({canvasColorCssVar(color.id, 'stroke')})"
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

	{#if moreOpen}
		<div class="canvas-more-menu" role="menu" aria-label="More tools">
			{#each secondaryTools as tool (tool.id)}
				<button
					type="button"
					class="more-item"
					class:more-item--active={editor.tool === tool.id}
					role="menuitem"
					onclick={() => selectTool(tool.id)}
				>
					<tool.icon class="h-4 w-4" />
					<span>{tool.label}</span>
					<span class="more-shortcut">{tool.shortcut}</span>
				</button>
			{/each}
		</div>
	{/if}

	<div class="canvas-floating-toolbar" role="toolbar" aria-label="Canvas tools">
		{#each primaryTools as tool (tool.id)}
			<button
				type="button"
				class="tool-btn"
				class:tool-btn--active={editor.tool === tool.id}
				class:tool-btn--locked={editor.tool === tool.id && editor.toolLocked}
				title={toolTitle(tool)}
				aria-label="{tool.label} tool"
				aria-pressed={editor.tool === tool.id}
				onclick={() => selectTool(tool.id)}
				onpointerdown={() => onToolPointerDown(tool.id)}
				onpointerup={onToolPointerUp}
				onpointerleave={onToolPointerUp}
				onpointercancel={onToolPointerUp}
			>
				<tool.icon class="h-4 w-4" />
			</button>
		{/each}

		<!-- Secondary tools: inline on desktop, "More" on coarse/narrow. -->
		<div class="secondary-inline">
			{#each secondaryTools as tool (tool.id)}
				<button
					type="button"
					class="tool-btn"
					class:tool-btn--active={editor.tool === tool.id}
					class:tool-btn--locked={editor.tool === tool.id && editor.toolLocked}
					title={toolTitle(tool)}
					aria-label="{tool.label} tool"
					aria-pressed={editor.tool === tool.id}
					onclick={() => selectTool(tool.id)}
					onpointerdown={() => onToolPointerDown(tool.id)}
					onpointerup={onToolPointerUp}
					onpointerleave={onToolPointerUp}
					onpointercancel={onToolPointerUp}
				>
					<tool.icon class="h-4 w-4" />
				</button>
			{/each}
		</div>

		<button
			type="button"
			class="tool-btn more-btn"
			class:tool-btn--active={moreOpen || secondaryActive}
			title="More tools"
			aria-label="More tools"
			aria-expanded={moreOpen}
			onclick={() => { moreOpen = !moreOpen; }}
		>
			<ChevronUp class="h-4 w-4" />
		</button>

		<div class="divider"></div>

		<button
			type="button"
			class="tool-btn"
			class:tool-btn--active={editor.toolLocked}
			title={editor.toolLocked ? "Unlock tool" : "Keep tool after placing (or long-press)"}
			aria-label={editor.toolLocked ? "Unlock tool" : "Lock tool"}
			aria-pressed={editor.toolLocked}
			onclick={toggleToolLock}
		>
			<Pin class="h-4 w-4" />
		</button>

		<div class="divider history-divider"></div>

		<button
			type="button"
			class="tool-btn history-btn"
			title="Undo"
			aria-label="Undo"
			disabled={!editor.canUndo}
			onclick={() => editor.undo()}
		>
			<Undo2 class="h-4 w-4" />
		</button>
		<button
			type="button"
			class="tool-btn history-btn"
			title="Redo"
			aria-label="Redo"
			disabled={!editor.canRedo}
			onclick={() => editor.redo()}
		>
			<Redo2 class="h-4 w-4" />
		</button>
	</div>
</div>

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

	.canvas-toolbar-wrap--immersive {
		left: var(--preview-safe-left, 10px);
		right: var(--preview-safe-right, 10px);
		transform: none;
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

	.canvas-more-menu {
		display: none;
		min-width: 160px;
		flex-direction: column;
		gap: 2px;
		border-radius: 10px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 96%, transparent);
		padding: 4px;
		box-shadow: 0 10px 24px color-mix(in srgb, var(--overlay-scrim-strong) 16%, transparent);
		backdrop-filter: blur(12px);
	}

	.more-item {
		display: flex;
		align-items: center;
		gap: 8px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		padding: 8px 10px;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
	}
	.more-item:hover { background: var(--bg-hover); color: var(--text-primary); }
	.more-item--active {
		background: var(--brand-bg);
		color: var(--brand-muted-fg);
	}
	.more-shortcut {
		margin-left: auto;
		color: var(--text-placeholder);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
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

	.secondary-inline { display: contents; }
	.more-btn { display: none; }

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
	.tool-btn--locked {
		box-shadow: inset 0 0 0 1px var(--brand-border);
	}
	.tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.divider {
		width: 1px;
		height: 18px;
		margin: 0 3px;
		background: var(--border-subtle);
	}

	/* Mobile: larger targets, More menu, safe-area, room for top zoom. */
	@media (pointer: coarse) {
		.canvas-toolbar-wrap {
			bottom: calc(10px + env(safe-area-inset-bottom, 0px));
			width: min(100% - 16px, 100%);
			max-width: calc(100vw - 16px);
		}
		.canvas-floating-toolbar {
			max-width: 100%;
			overflow-x: auto;
			scrollbar-width: none;
			-webkit-overflow-scrolling: touch;
			padding: 5px;
			gap: 3px;
		}
		.canvas-floating-toolbar::-webkit-scrollbar { display: none; }
		.canvas-style-row {
			max-width: 100%;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.canvas-style-row::-webkit-scrollbar { display: none; }
		.tool-btn { width: 40px; height: 40px; flex-shrink: 0; }
		.color-swatch { width: 26px; height: 26px; flex-shrink: 0; }
		.geo-btn { width: 30px; height: 30px; flex-shrink: 0; }

		.secondary-inline { display: none; }
		.more-btn { display: inline-flex; }
		.canvas-more-menu { display: flex; }
	}

	@media (pointer: coarse) and (max-width: 480px) {
		.canvas-toolbar-wrap {
			bottom: calc(8px + env(safe-area-inset-bottom, 0px));
		}
		.tool-btn { width: 38px; height: 38px; }
		/* History is available via keyboard / selection actions on the tiniest screens. */
		.history-btn,
		.history-divider { display: none; }
	}
</style>
