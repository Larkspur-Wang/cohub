<script lang="ts">
import {
	ArrowUpRight,
	Check,
	Crop,
	Loader2,
	MousePointer2,
	Pencil,
	RefreshCw,
	Square,
	Trash2,
	Undo2,
	X,
} from "lucide-svelte";
import type { MarkColor, MarkTool } from "../types";
import { MARK_COLOR_HEX } from "../types";

type Props = {
	tool: MarkTool;
	color: MarkColor;
	canUndo: boolean;
	canCropApply: boolean;
	canResetCrop: boolean;
	canRecapture: boolean;
	attaching: boolean;
	onTool: (tool: MarkTool) => void;
	onColor: (color: MarkColor) => void;
	onUndo: () => void;
	onClear: () => void;
	onApplyCrop: () => void;
	onResetCrop: () => void;
	onRecapture?: () => void;
	onAttach: () => void;
	onClose: () => void;
};

let {
	tool,
	color,
	canUndo,
	canCropApply,
	canResetCrop,
	canRecapture,
	attaching,
	onTool,
	onColor,
	onUndo,
	onClear,
	onApplyCrop,
	onResetCrop,
	onRecapture,
	onAttach,
	onClose,
}: Props = $props();

const tools: Array<{ id: MarkTool; label: string; icon: typeof Pencil }> = [
	{ id: "pen", label: "Pen", icon: Pencil },
	{ id: "arrow", label: "Arrow", icon: ArrowUpRight },
	{ id: "rect", label: "Rect", icon: Square },
	{ id: "crop", label: "Crop", icon: Crop },
];

const colors: MarkColor[] = ["brand", "red", "yellow", "white"];
</script>

<div class="mark-toolbar" role="toolbar" aria-label="Mark tools">
	<div class="mark-toolbar-scroll">
		{#each tools as item (item.id)}
			{@const Icon = item.icon}
			<button
				type="button"
				class="mark-tool"
				class:active={tool === item.id}
				title={item.label}
				aria-label={item.label}
				aria-pressed={tool === item.id}
				onclick={() => onTool(item.id)}
			>
				<Icon class="h-3.5 w-3.5" />
				<span class="mark-tool-label">{item.label}</span>
			</button>
		{/each}

		<div class="mark-sep"></div>

		{#each colors as c (c)}
			<button
				type="button"
				class="mark-swatch"
				class:active={color === c}
				style={`--swatch:${MARK_COLOR_HEX[c]}`}
				title={c}
				aria-label={`Color ${c}`}
				aria-pressed={color === c}
				onclick={() => onColor(c)}
			></button>
		{/each}

		<div class="mark-sep"></div>

		<button type="button" class="mark-icon" title="Undo" aria-label="Undo" disabled={!canUndo} onclick={onUndo}>
			<Undo2 class="h-3.5 w-3.5" />
		</button>
		<button type="button" class="mark-icon" title="Clear marks" aria-label="Clear marks" disabled={!canUndo} onclick={onClear}>
			<Trash2 class="h-3.5 w-3.5" />
		</button>

		{#if tool === "crop" || canCropApply || canResetCrop}
			<div class="mark-sep"></div>
			{#if canCropApply}
				<button type="button" class="mark-action" onclick={onApplyCrop} title="Apply crop">
					<Check class="h-3.5 w-3.5" />
					<span>Crop</span>
				</button>
			{/if}
			{#if canResetCrop}
				<button type="button" class="mark-action ghost" onclick={onResetCrop} title="Reset crop">
					<MousePointer2 class="h-3.5 w-3.5" />
					<span>Reset</span>
				</button>
			{/if}
		{/if}

		{#if canRecapture && onRecapture}
			<div class="mark-sep"></div>
			<button type="button" class="mark-action ghost" onclick={onRecapture} title="Recapture">
				<RefreshCw class="h-3.5 w-3.5" />
				<span class="hidden sm:inline">Recapture</span>
			</button>
		{/if}
	</div>

	<div class="mark-toolbar-end">
		<button
			type="button"
			class="mark-attach"
			disabled={attaching}
			onclick={onAttach}
			title="Attach to chat"
		>
			{#if attaching}
				<Loader2 class="h-3.5 w-3.5 animate-spin" />
			{:else}
				<Check class="h-3.5 w-3.5" />
			{/if}
			<span>Attach</span>
		</button>
		<button type="button" class="mark-icon" title="Close" aria-label="Close mark" onclick={onClose}>
			<X class="h-3.5 w-3.5" />
		</button>
	</div>
</div>

<style>
	.mark-toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 6px 8px;
		border-bottom: 1px solid var(--border-subtle);
		background: var(--bg-surface);
	}
	.mark-toolbar-scroll {
		display: flex;
		min-width: 0;
		flex: 1;
		align-items: center;
		gap: 4px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.mark-toolbar-scroll::-webkit-scrollbar {
		display: none;
	}
	.mark-toolbar-end {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 4px;
	}
	.mark-tool,
	.mark-icon,
	.mark-action,
	.mark-attach {
		display: inline-flex;
		height: 32px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		gap: 4px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: background 120ms ease, color 120ms ease;
	}
	.mark-tool {
		padding: 0 8px;
	}
	.mark-tool-label {
		display: none;
		font-size: 11px;
		font-weight: 500;
	}
	@media (min-width: 640px) {
		.mark-tool-label {
			display: inline;
		}
	}
	.mark-tool:hover,
	.mark-icon:hover,
	.mark-action:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
	.mark-tool.active {
		background: var(--brand-muted);
		color: var(--brand-muted-fg);
	}
	.mark-icon {
		width: 32px;
	}
	.mark-icon:disabled,
	.mark-action:disabled,
	.mark-attach:disabled {
		opacity: 0.4;
		pointer-events: none;
	}
	.mark-action {
		padding: 0 8px;
		font-size: 11px;
		font-weight: 500;
	}
	.mark-action.ghost {
		color: var(--text-tertiary);
	}
	.mark-attach {
		padding: 0 10px;
		border-radius: 7px;
		background: var(--brand);
		color: var(--brand-contrast-fg);
		font-size: 12px;
		font-weight: 600;
	}
	.mark-attach:hover {
		filter: brightness(1.05);
	}
	.mark-swatch {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
		border: 2px solid transparent;
		border-radius: 999px;
		background: var(--swatch);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 18%, transparent);
		cursor: pointer;
	}
	.mark-swatch.active {
		border-color: var(--text-primary);
	}
	.mark-sep {
		width: 1px;
		height: 18px;
		flex-shrink: 0;
		margin: 0 2px;
		background: var(--border-subtle);
	}
</style>
