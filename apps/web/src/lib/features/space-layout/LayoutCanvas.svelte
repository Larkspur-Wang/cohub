<script lang="ts">
import type {
	SpaceLayoutComponent,
	SpaceLayoutComponentType,
} from "@cohub/protocol";
import { formatComponentMode } from "./layout-helpers";

type Props = {
	components: SpaceLayoutComponent[];
	selectedType: SpaceLayoutComponentType;
	onSelect: (type: SpaceLayoutComponentType) => void;
	onMove: (type: SpaceLayoutComponentType, x: number, y: number) => void;
	onResize: (
		type: SpaceLayoutComponentType,
		width: number,
		height: number,
	) => void;
};

let { components, selectedType, onSelect, onMove, onResize }: Props = $props();
let canvasEl = $state<HTMLDivElement | null>(null);

type DragState = {
	type: SpaceLayoutComponentType;
	kind: "move" | "resize";
	startX: number;
	startY: number;
	originX: number;
	originY: number;
	originWidth: number;
	originHeight: number;
};
let dragState: DragState | null = null;

function componentRect(component: SpaceLayoutComponent) {
	if (component.placement.mode === "hidden")
		return { x: 0.36, y: 0.42, width: 0.28, height: 0.18, hidden: true };
	if (component.placement.mode === "fullscreen")
		return { x: 0.03, y: 0.03, width: 0.94, height: 0.82 };
	if (component.placement.mode === "floating") {
		const position = component.placement.position ?? {
			x: 0.58,
			y: 0.12,
			unit: "ratio",
		};
		return {
			x: clampRatio(position.x),
			y: clampRatio(position.y),
			width: clampRatio(
				component.size?.unit === "ratio"
					? (component.size.width ?? 0.32)
					: 0.32,
				0.16,
				0.72,
			),
			height: clampRatio(
				component.size?.unit === "ratio"
					? (component.size.height ?? 0.46)
					: 0.46,
				0.14,
				0.78,
			),
		};
	}
	const edge = component.placement.edge ?? "right";
	const orderOffset = ((component.placement.order ?? 20) % 10) * 0.018;
	if (edge === "left")
		return { x: 0.03, y: 0.08 + orderOffset, width: 0.24, height: 0.72 };
	if (edge === "top") return { x: 0.28, y: 0.03, width: 0.44, height: 0.2 };
	if (edge === "bottom") return { x: 0.28, y: 0.66, width: 0.44, height: 0.2 };
	return { x: 0.72, y: 0.08 + orderOffset, width: 0.25, height: 0.68 };
}

function clampRatio(value: number, min = 0.02, max = 0.9) {
	return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function styleFor(component: SpaceLayoutComponent) {
	const rect = componentRect(component);
	return `left: ${rect.x * 100}%; top: ${rect.y * 100}%; width: ${rect.width * 100}%; height: ${rect.height * 100}%; z-index: ${component.placement.mode === "floating" ? (component.placement.z ?? 20) : component.placement.mode === "fullscreen" ? 12 : 5}; opacity: ${rect.hidden ? 0.35 : 1}`;
}

function beginDrag(
	event: PointerEvent,
	component: SpaceLayoutComponent,
	kind: "move" | "resize",
) {
	if (component.placement.mode !== "floating") return;
	event.preventDefault();
	event.stopPropagation();
	const rect = componentRect(component);
	dragState = {
		type: component.type,
		kind,
		startX: event.clientX,
		startY: event.clientY,
		originX: rect.x,
		originY: rect.y,
		originWidth: rect.width,
		originHeight: rect.height,
	};
	(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function handlePointerMove(event: PointerEvent) {
	if (!dragState || !canvasEl) return;
	const bounds = canvasEl.getBoundingClientRect();
	const dx = (event.clientX - dragState.startX) / bounds.width;
	const dy = (event.clientY - dragState.startY) / bounds.height;
	if (dragState.kind === "move") {
		onMove(
			dragState.type,
			clampRatio(dragState.originX + dx, 0.01, 0.86),
			clampRatio(dragState.originY + dy, 0.01, 0.82),
		);
	} else {
		onResize(
			dragState.type,
			clampRatio(dragState.originWidth + dx, 0.16, 0.82),
			clampRatio(dragState.originHeight + dy, 0.14, 0.86),
		);
	}
}

function endDrag(event: PointerEvent) {
	if (!dragState) return;
	(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
	dragState = null;
}
</script>

<div
	bind:this={canvasEl}
	class="layout-canvas"
	role="application"
	aria-label="Layout preview canvas"
	onpointermove={handlePointerMove}
	onpointerup={endDrag}
	onpointercancel={endDrag}
>
	<div class="layout-canvas__workspace"></div>
	{#each components as component (component.id)}
		<div
			role="button"
			tabindex="0"
			class="layout-canvas__component"
			class:selected={selectedType === component.type}
			class:hidden-mode={component.placement.mode === "hidden"}
			class:floating={component.placement.mode === "floating"}
			style={styleFor(component)}
			onclick={() => onSelect(component.type)}
			onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(component.type); }}
			onpointerdown={(event) => beginDrag(event, component, "move")}
		>
			<span>{component.title ?? component.type}</span>
			<small>{formatComponentMode(component)}</small>
			{#if component.placement.mode === "floating"}
				<button type="button" class="layout-canvas__resize" aria-label={`Resize ${component.title ?? component.type}`} onpointerdown={(event) => beginDrag(event, component, "resize")}></button>
			{/if}
		</div>
	{/each}
	<div class="layout-canvas__bar">Runtime system bar</div>
</div>

<style>
	.layout-canvas {
		position: relative;
		height: 100%;
		min-height: 420px;
		overflow: hidden;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		background: var(--bg-primary);
	}
	.layout-canvas__workspace {
		position: absolute;
		inset: 12px;
		border: 1px solid color-mix(in srgb, var(--border-subtle) 60%, transparent);
		border-radius: 8px;
		background: var(--bg-content);
	}
	.layout-canvas__component {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: space-between;
		border: 1px solid var(--border-subtle);
		border-radius: 9px;
		background: var(--bg-surface);
		padding: 10px;
		color: var(--text-secondary);
		box-shadow: 0 12px 28px color-mix(in srgb, var(--overlay-scrim-strong) 12%, transparent);
		transition: border-color 120ms ease, color 120ms ease, outline-color 120ms ease;
	}
	.layout-canvas__component.floating {
		cursor: move;
	}
	.layout-canvas__component.selected {
		border-color: color-mix(in srgb, var(--brand) 55%, var(--border-subtle));
		color: var(--text-primary);
		outline: 1px solid color-mix(in srgb, var(--brand) 22%, transparent);
	}
	.layout-canvas__component.hidden-mode {
		border-style: dashed;
	}
	.layout-canvas__component span {
		font-size: 13px;
		font-weight: 600;
	}
	.layout-canvas__component small {
		font-size: 11px;
		color: var(--text-placeholder);
	}
	.layout-canvas__resize {
		position: absolute;
		right: 6px;
		bottom: 6px;
		height: 14px;
		width: 14px;
		cursor: nwse-resize;
		border-right: 2px solid var(--text-placeholder);
		border-bottom: 2px solid var(--text-placeholder);
		border-radius: 2px;
	}
	.layout-canvas__bar {
		position: absolute;
		bottom: 12px;
		left: 12px;
		right: 12px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		background: var(--bg-surface);
		padding: 8px 12px;
		font-size: 11px;
		color: var(--text-tertiary);
	}
</style>
