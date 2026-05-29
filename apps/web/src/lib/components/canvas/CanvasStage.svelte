<script lang="ts">
import { Application, Container } from "pixi.js";
import { onDestroy, onMount } from "svelte";
import {
	addCanvasItem,
	moveCanvasItem,
	setCanvasViewport,
} from "$lib/canvas/actions/canvas-document-actions";
import { clampZoom, screenToWorld } from "$lib/canvas/canvas-geometry";
import { createSpaceFileCanvasItem } from "$lib/canvas/canvas-items";
import { getCanvasResolution } from "$lib/canvas/canvas-rendering";
import type {
	CanvasFrame,
	CanvasItem,
	CovasDocument,
} from "$lib/canvas/canvas-schema";
import {
	type CanvasRenderPalette,
	getCanvasCardRenderer,
} from "$lib/canvas/renderers/canvas-renderer-registry";
import { getCanvasThemeRenderer } from "$lib/canvas/themes/canvas-theme-registry";

const {
	document: canvasDocument,
	selectedItemIds,
	onChange,
	onSelect,
}: {
	document: CovasDocument;
	selectedItemIds: string[];
	onChange: (document: CovasDocument) => void;
	onSelect: (ids: string[]) => void;
} = $props();

type CardDisplayEntry = {
	item: CanvasItem;
	selected: boolean;
	rendererId: string;
	display: Container;
};

let host: HTMLDivElement | null = $state(null);
let app: Application | null = null;
let world: Container | null = null;
let background: Container | null = null;
let backgroundThemeId: string | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;
let drag: {
	id: string;
	pointerId: number;
	startX: number;
	startY: number;
	frame: CanvasFrame;
} | null = null;
let panning: {
	pointerId: number;
	startX: number;
	startY: number;
	viewportX: number;
	viewportY: number;
} | null = null;
let dropActive = $state(false);
const cardDisplays = new Map<string, CardDisplayEntry>();

const viewport = $derived(canvasDocument.viewport);

let colorCanvas: HTMLCanvasElement | null = null;
if (typeof globalThis.document !== "undefined") {
	colorCanvas = globalThis.document.createElement("canvas");
}
const documentColorProbe = colorCanvas?.getContext("2d") ?? null;

function cssNumber(name: string, fallback: number) {
	if (!host) return fallback;
	const value = getComputedStyle(host).getPropertyValue(name).trim();
	const probe = documentColorProbe;
	if (!value || !probe) return fallback;
	probe.fillStyle = value;
	const normalized = probe.fillStyle;
	const match = /^#([0-9a-f]{6})$/i.exec(normalized);
	return match ? Number.parseInt(match[1], 16) : fallback;
}

function getPalette(): CanvasRenderPalette {
	return {
		bg: cssNumber("--bg-content", 0x161616),
		surface: cssNumber("--bg-surface", 0x202020),
		hover: cssNumber("--bg-hover", 0x2a2a2a),
		border: cssNumber("--border-subtle", 0x3a3a3a),
		brand: cssNumber("--brand", 0xff3e00),
		text: cssNumber("--text-primary", 0xf4f4f4),
		muted: cssNumber("--text-tertiary", 0x8c8c8c),
		rare: 0x38bdf8,
		epic: 0xa78bfa,
		legendary: 0xf59e0b,
	};
}

function patchFrame(id: string, frame: CanvasFrame) {
	onChange(moveCanvasItem(canvasDocument, id, frame));
}

function updateViewport(next: CovasDocument["viewport"]) {
	onChange(setCanvasViewport(canvasDocument, next));
}

function toggleSelection(id: string) {
	if (selectedItemIds.includes(id)) {
		onSelect(selectedItemIds.filter((selectedId) => selectedId !== id));
	} else {
		onSelect([...selectedItemIds, id]);
	}
}

function handleItemPointerDown(
	item: CanvasItem,
	event: {
		stopPropagation: () => void;
		pointerId: number;
		global: { x: number; y: number };
		originalEvent?: MouseEvent | PointerEvent | TouchEvent;
	},
) {
	event.stopPropagation();
	const additive = Boolean(
		event.originalEvent &&
			("shiftKey" in event.originalEvent ||
				"metaKey" in event.originalEvent ||
				"ctrlKey" in event.originalEvent) &&
			(event.originalEvent.shiftKey ||
				event.originalEvent.metaKey ||
				event.originalEvent.ctrlKey),
	);
	if (additive) toggleSelection(item.id);
	else if (!selectedItemIds.includes(item.id)) onSelect([item.id]);
	drag = {
		id: item.id,
		pointerId: event.pointerId,
		startX: event.global.x,
		startY: event.global.y,
		frame: item.frame,
	};
}

function syncBackground(palette: CanvasRenderPalette) {
	if (!app) return;
	const themeRenderer = getCanvasThemeRenderer(canvasDocument);
	if (!background || backgroundThemeId !== themeRenderer.id) {
		background?.destroy({ children: true });
		background = themeRenderer.createBackground({
			app,
			document: canvasDocument,
			viewport,
			palette,
		});
		backgroundThemeId = themeRenderer.id;
		app.stage.addChildAt(background, 0);
		return;
	}
	themeRenderer.updateBackground?.(background, {
		app,
		document: canvasDocument,
		viewport,
		palette,
	});
}

function syncCards(palette: CanvasRenderPalette) {
	const currentWorld = world;
	if (!currentWorld) return;
	const selectedSet = new Set(selectedItemIds);
	const itemIds = new Set(canvasDocument.items.map((item) => item.id));
	const renderContext = {
		document: canvasDocument,
		selectedItemIds,
		palette,
		onItemPointerDown: handleItemPointerDown,
	};

	for (const [id, entry] of cardDisplays) {
		if (!itemIds.has(id)) {
			currentWorld.removeChild(entry.display);
			entry.display.destroy({ children: true });
			cardDisplays.delete(id);
		}
	}

	canvasDocument.items.forEach((item, index) => {
		const renderer = getCanvasCardRenderer(item, renderContext);
		const selected = selectedSet.has(item.id);
		const existing = cardDisplays.get(item.id);
		const needsReplace =
			!existing ||
			existing.item !== item ||
			existing.selected !== selected ||
			existing.rendererId !== renderer.id;

		let display = existing?.display;
		if (needsReplace) {
			if (existing) {
				currentWorld.removeChild(existing.display);
				existing.display.destroy({ children: true });
			}
			display = renderer.create(item, renderContext);
			cardDisplays.set(item.id, {
				item,
				selected,
				rendererId: renderer.id,
				display,
			});
		}

		if (display && display.parent !== currentWorld)
			currentWorld.addChild(display);
		if (display) currentWorld.setChildIndex(display, index);
	});
}

function syncStage() {
	if (!app || !world) return;
	const palette = getPalette();
	syncBackground(palette);
	world.x = viewport.x;
	world.y = viewport.y;
	world.scale.set(viewport.zoom);
	if (world.parent !== app.stage) app.stage.addChild(world);
	syncCards(palette);
}

function resizeStage() {
	if (!app) return;
	cancelAnimationFrame(resizeFrame);
	resizeFrame = requestAnimationFrame(() => {
		if (!app) return;
		app.resize();
		app.stage.hitArea = app.screen;
		syncStage();
	});
}

function handleWheel(event: WheelEvent) {
	event.preventDefault();
	if (!host) return;
	const rect = host.getBoundingClientRect();
	const before = screenToWorld(event.clientX, event.clientY, rect, viewport);
	const nextZoom = clampZoom(viewport.zoom * (event.deltaY < 0 ? 1.08 : 0.92));
	updateViewport({
		x: event.clientX - rect.left - before.x * nextZoom,
		y: event.clientY - rect.top - before.y * nextZoom,
		zoom: nextZoom,
	});
}

function handleDrop(event: DragEvent) {
	event.preventDefault();
	dropActive = false;
	if (!host) return;
	const path = event.dataTransfer
		?.getData("text/cohub-path")
		?.replace(/\/$/, "");
	if (!path) return;
	const rect = host.getBoundingClientRect();
	const point = screenToWorld(event.clientX, event.clientY, rect, viewport);
	onChange(
		addCanvasItem(
			canvasDocument,
			createSpaceFileCanvasItem(path, point.x, point.y),
		),
	);
}

onMount(async () => {
	if (!host) return;
	app = new Application();
	await app.init({
		antialias: true,
		autoDensity: true,
		backgroundAlpha: 0,
		resizeTo: host,
		resolution: getCanvasResolution(),
	});
	host.appendChild(app.canvas);
	world = new Container();
	app.stage.eventMode = "static";
	app.stage.hitArea = app.screen;
	app.stage.on("pointerdown", (event) => {
		onSelect([]);
		panning = {
			pointerId: event.pointerId,
			startX: event.global.x,
			startY: event.global.y,
			viewportX: viewport.x,
			viewportY: viewport.y,
		};
	});
	app.stage.on("globalpointermove", (event) => {
		if (drag) {
			const dx = (event.global.x - drag.startX) / viewport.zoom;
			const dy = (event.global.y - drag.startY) / viewport.zoom;
			patchFrame(drag.id, {
				...drag.frame,
				x: drag.frame.x + dx,
				y: drag.frame.y + dy,
			});
		} else if (panning) {
			updateViewport({
				...viewport,
				x: panning.viewportX + event.global.x - panning.startX,
				y: panning.viewportY + event.global.y - panning.startY,
			});
		}
	});
	app.stage.on("pointerup", () => {
		drag = null;
		panning = null;
	});
	app.stage.on("pointerupoutside", () => {
		drag = null;
		panning = null;
	});
	resizeObserver = new ResizeObserver(resizeStage);
	resizeObserver.observe(host);
	resizeStage();
});

$effect(() => {
	canvasDocument;
	selectedItemIds;
	syncStage();
});

onDestroy(() => {
	resizeObserver?.disconnect();
	cancelAnimationFrame(resizeFrame);
	for (const entry of cardDisplays.values())
		entry.display.destroy({ children: true });
	cardDisplays.clear();
	background?.destroy({ children: true });
	background = null;
	app?.destroy(true);
	app = null;
});
</script>

<div
  bind:this={host}
  class="relative h-full w-full overflow-hidden {dropActive ? 'canvas-drop-active' : ''}"
  role="application"
  aria-label="Canvas stage"
  onwheel={handleWheel}
  ondragover={(event) => { if (event.dataTransfer?.types.includes("text/cohub-path")) { event.preventDefault(); dropActive = true; } }}
  ondragleave={() => { dropActive = false; }}
  ondrop={handleDrop}
></div>

<style>
  .canvas-drop-active::after {
    content: "";
    position: absolute;
    inset: 0.75rem;
    pointer-events: none;
    border: 1px solid var(--brand-border);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--brand-bg) 40%, transparent);
  }
</style>
