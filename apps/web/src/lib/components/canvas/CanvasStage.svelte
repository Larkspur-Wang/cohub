<script lang="ts">
import { Application, Container, Graphics } from "pixi.js";
import { onDestroy, onMount, untrack } from "svelte";
import {
	createCanvasAssetManager,
	imageAssetKey,
} from "$lib/canvas/canvas-asset-manager";
import {
	expandRect,
	frameHandlePosition,
	itemBounds,
	type Point,
	pointToWorld,
	RESIZE_HANDLES,
	type Rect,
	rectsIntersect,
	rotationHandlePosition,
	type ScreenPoint,
	screenPoint,
	screenToWorld,
	visibleWorldRect,
} from "$lib/canvas/canvas-geometry";
import { getCanvasResolution } from "$lib/canvas/canvas-rendering";
import type { CanvasFrame, CanvasItem } from "$lib/canvas/canvas-schema";
import type { CanvasEditor } from "$lib/canvas/editor.svelte";
import {
	type CanvasCardRenderer,
	type CanvasRenderContext,
	type CanvasRenderPalette,
	getCanvasCardRenderer,
} from "$lib/canvas/renderers/canvas-renderer-registry";
import { getCanvasThemeRenderer } from "$lib/canvas/themes/canvas-theme-registry";
import { getResolvedTheme } from "$lib/theme.svelte";

const {
	editor,
	spaceId,
	onSurfaceChange,
}: {
	editor: CanvasEditor;
	spaceId: string;
	onSurfaceChange?: (size: { width: number; height: number }) => void;
} = $props();

type CardEntry = {
	item: CanvasItem;
	container: Container;
	renderer: CanvasCardRenderer;
};

let host: HTMLDivElement | null = $state(null);
let app: Application | null = null;
let world: Container | null = null;
let background: Container | null = null;
let backgroundThemeId: string | null = null;
let overlay: Graphics | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;
let dropActive = $state(false);
let surface = $state<{ width: number; height: number }>({
	width: 0,
	height: 0,
});
// Bumped whenever the asset manager resolves a new thumbnail URL, so cards
// re-sync and images pop in.
let assetVersion = $state(0);
const cardDisplays = new Map<string, CardEntry>();

// One manager per mounted canvas; the space id is fixed for the mount.
const assets = createCanvasAssetManager({ spaceId: untrack(() => spaceId) });
const unsubscribeAssets = assets.subscribe(() => {
	assetVersion += 1;
});

let colorCanvas: HTMLCanvasElement | null = null;
if (typeof globalThis.document !== "undefined") {
	colorCanvas = globalThis.document.createElement("canvas");
}
const colorProbe = colorCanvas?.getContext("2d") ?? null;

function cssNumber(name: string, fallback: number): number {
	if (!host) return fallback;
	const value = getComputedStyle(host).getPropertyValue(name).trim();
	if (!value || !colorProbe) return fallback;
	colorProbe.fillStyle = value;
	const match = /^#([0-9a-f]{6})$/i.exec(colorProbe.fillStyle);
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

// Request thumbnails only for image cards near the viewport (space-file and
// remote alike). The margin preloads a band just off-screen so panning feels
// instant. Tracks only items/camera/surface: loaded textures notify via
// `assetVersion`, which the render effect (not this one) consumes.
$effect(() => {
	const items = editor.items;
	const camera = editor.camera;
	const width = surface.width;
	const height = surface.height;
	if (width === 0 || height === 0) return;
	const visible = visibleWorldRect(camera, width, height);
	const preload = expandRect(
		visible,
		Math.max(visible.width, visible.height) * 0.5,
	);
	for (const item of items) {
		if (!imageAssetKey(item)) continue;
		if (rectsIntersect(itemBounds(item.frame), preload))
			assets.requestItem(item);
	}
});

function buildContext(palette: CanvasRenderPalette): CanvasRenderContext {
	return {
		document: editor.document,
		selectedIds: new Set(editor.selection),
		hoveredId: editor.hoverId,
		palette,
		imageKey: imageAssetKey,
		getTexture: (key) => assets.getTexture(key),
		hasError: (key) => assets.hasError(key),
		acquireTexture: (key) => assets.acquire(key),
		releaseTexture: (key) => assets.release(key),
	};
}

function syncBackground(palette: CanvasRenderPalette) {
	if (!app) return;
	const themeRenderer = getCanvasThemeRenderer(editor.document);
	const context = {
		app,
		document: editor.document,
		viewport: editor.camera,
		palette,
	};
	if (!background || backgroundThemeId !== themeRenderer.id) {
		background?.destroy({ children: true });
		background = themeRenderer.createBackground(context);
		backgroundThemeId = themeRenderer.id;
		app.stage.addChildAt(background, 0);
		return;
	}
	themeRenderer.updateBackground?.(background, context);
}

function syncCards(context: CanvasRenderContext) {
	const currentWorld = world;
	if (!currentWorld) return;
	const items = editor.items;
	const itemIds = new Set(items.map((item) => item.id));

	for (const [id, entry] of cardDisplays) {
		if (!itemIds.has(id)) {
			currentWorld.removeChild(entry.container);
			entry.renderer.destroy?.(entry.container, context);
			cardDisplays.delete(id);
		}
	}

	items.forEach((item, index) => {
		const renderer = getCanvasCardRenderer(item, context);
		const existing = cardDisplays.get(item.id);
		let container: Container;
		if (existing && existing.renderer.id === renderer.id) {
			container = existing.container;
			renderer.update(container, item, context);
		} else {
			if (existing) {
				currentWorld.removeChild(existing.container);
				existing.renderer.destroy?.(existing.container, context);
			}
			container = renderer.create(item, context);
			cardDisplays.set(item.id, { item, container, renderer });
			currentWorld.addChild(container);
		}
		if (container.parent !== currentWorld) currentWorld.addChild(container);
		currentWorld.setChildIndex(container, index);
	});

	if (overlay && overlay.parent === currentWorld)
		currentWorld.setChildIndex(overlay, currentWorld.children.length - 1);
}

function drawOverlay(palette: CanvasRenderPalette) {
	if (!overlay) return;
	overlay.clear();
	const zoom = editor.camera.zoom;
	const inv = 1 / zoom;
	const brand = palette.brand;

	const marquee = editor.marquee;
	if (marquee) {
		overlay
			.rect(marquee.x, marquee.y, marquee.width, marquee.height)
			.fill({ color: brand, alpha: 0.08 });
		overlay
			.rect(marquee.x, marquee.y, marquee.width, marquee.height)
			.stroke({ color: brand, width: inv, alpha: 0.7 });
	}

	const bounds = editor.bounds;
	const selection = editor.selection;
	if (!bounds || selection.length === 0) return;

	overlay
		.rect(bounds.x, bounds.y, bounds.width, bounds.height)
		.stroke({ color: brand, width: 1.5 * inv, alpha: 0.95 });

	const single =
		selection.length === 1 ? (editor.selectedItems[0]?.frame ?? null) : null;
	const source: CanvasFrame = single ?? { ...bounds, rotation: 0 };
	const handles = single ? RESIZE_HANDLES : (["nw", "ne", "se", "sw"] as const);
	const handleSize = 8 * inv;
	for (const handle of handles) {
		const position = frameHandlePosition(source, handle);
		overlay
			.rect(
				position.x - handleSize / 2,
				position.y - handleSize / 2,
				handleSize,
				handleSize,
			)
			.fill({ color: palette.surface, alpha: 1 })
			.stroke({ color: brand, width: 1.5 * inv });
	}

	const rotation = rotationHandlePosition(bounds, zoom);
	const topCenter: Point = { x: bounds.x + bounds.width / 2, y: bounds.y };
	overlay
		.moveTo(topCenter.x, topCenter.y)
		.lineTo(rotation.x, rotation.y)
		.stroke({ color: brand, width: inv, alpha: 0.8 });
	overlay
		.circle(rotation.x, rotation.y, 5 * inv)
		.fill({ color: palette.surface })
		.stroke({ color: brand, width: 1.5 * inv });
}

function syncStage() {
	if (!app || !world) return;
	const palette = getPalette();
	syncBackground(palette);
	world.x = editor.camera.x;
	world.y = editor.camera.y;
	world.scale.set(editor.camera.zoom);
	if (world.parent !== app.stage) app.stage.addChild(world);
	syncCards(buildContext(palette));
	drawOverlay(palette);
}

function reportSurfaceSize() {
	if (!app) {
		surface = { width: 0, height: 0 };
		onSurfaceChange?.({ width: 0, height: 0 });
		return;
	}
	surface = { width: app.screen.width, height: app.screen.height };
	onSurfaceChange?.({ width: app.screen.width, height: app.screen.height });
}

function resizeStage() {
	if (!app) return;
	cancelAnimationFrame(resizeFrame);
	resizeFrame = requestAnimationFrame(() => {
		if (!app) return;
		app.resize();
		syncStage();
		reportSurfaceSize();
	});
}

// Convert a DOM event to a surface-relative screen point (the single place
// screen coordinates enter the editor).
function toScreenPoint(
	event: PointerEvent | WheelEvent | MouseEvent,
): ScreenPoint {
	if (!host) return screenPoint(0, 0);
	const rect = host.getBoundingClientRect();
	return screenPoint(event.clientX - rect.left, event.clientY - rect.top);
}

function toPointerEvent(event: PointerEvent) {
	const screen = toScreenPoint(event);
	return {
		pointerId: event.pointerId,
		screen,
		world: pointToWorld(screen, editor.camera),
		shiftKey: event.shiftKey,
		metaKey: event.metaKey,
		ctrlKey: event.ctrlKey,
		altKey: event.altKey,
		button: event.button,
		pointerType: event.pointerType,
	};
}

function handlePointerDown(event: PointerEvent) {
	if (!host) return;
	host.setPointerCapture(event.pointerId);
	editor.pointerDown(toPointerEvent(event));
}

function handlePointerMove(event: PointerEvent) {
	editor.pointerMove(toPointerEvent(event));
}

function handlePointerUp(event: PointerEvent) {
	editor.pointerUp(toPointerEvent(event));
}

function handleWheel(event: WheelEvent) {
	event.preventDefault();
	editor.wheel(
		toScreenPoint(event),
		event.deltaX,
		event.deltaY,
		event.ctrlKey || event.metaKey,
	);
}

function handleDoubleClick(event: MouseEvent) {
	const rect = host?.getBoundingClientRect() ?? new DOMRect();
	const worldPointAtCursor = screenToWorld(
		event.clientX,
		event.clientY,
		rect,
		editor.camera,
	);
	const item = editor.itemAt(worldPointAtCursor);
	if (item?.type === "text") {
		editor.editingId = item.id;
	} else if (!item) {
		editor.beginTextDraft(worldPointAtCursor);
	}
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
	const point = screenToWorld(
		event.clientX,
		event.clientY,
		rect,
		editor.camera,
	);
	editor.addFile(path, point);
}

const cursor = $derived.by(() => {
	if (editor.tool === "hand") return "grab";
	if (editor.interaction.type === "panning") return "grabbing";
	if (editor.interaction.type === "translating") return "grabbing";
	if (editor.interaction.type === "brushing") return "crosshair";
	return "default";
});

let disposed = false;

onMount(async () => {
	if (!host) return;
	const instance = new Application();
	try {
		await instance.init({
			antialias: true,
			autoDensity: true,
			backgroundAlpha: 0,
			resizeTo: host,
			resolution: getCanvasResolution(),
		});
	} catch (error) {
		console.error("Canvas failed to initialize", error);
		instance.destroy(true);
		return;
	}
	// The component may have been torn down while init was awaiting.
	if (disposed) {
		instance.destroy(true);
		return;
	}
	app = instance;
	host.appendChild(instance.canvas);
	world = new Container();
	overlay = new Graphics();
	world.addChild(overlay);

	host.addEventListener("pointerdown", handlePointerDown);
	host.addEventListener("pointermove", handlePointerMove);
	host.addEventListener("pointerup", handlePointerUp);
	host.addEventListener("pointercancel", handlePointerUp);
	host.addEventListener("wheel", handleWheel, { passive: false });
	host.addEventListener("dblclick", handleDoubleClick);

	resizeObserver = new ResizeObserver(resizeStage);
	resizeObserver.observe(host);
	resizeStage();
});

$effect(() => {
	editor.items;
	editor.camera;
	editor.selection;
	editor.hoverId;
	editor.marquee;
	editor.bounds;
	assetVersion;
	// Re-render when the theme changes so Pixi picks up new CSS colors.
	getResolvedTheme();
	syncStage();
});

onDestroy(() => {
	disposed = true;
	resizeObserver?.disconnect();
	cancelAnimationFrame(resizeFrame);
	unsubscribeAssets();
	if (host) {
		host.removeEventListener("pointerdown", handlePointerDown);
		host.removeEventListener("pointermove", handlePointerMove);
		host.removeEventListener("pointerup", handlePointerUp);
		host.removeEventListener("pointercancel", handlePointerUp);
		host.removeEventListener("wheel", handleWheel);
		host.removeEventListener("dblclick", handleDoubleClick);
	}
	// Destroy cards first (releasing their texture refs), then the manager.
	const context = buildContext(getPalette());
	for (const entry of cardDisplays.values())
		entry.renderer.destroy?.(entry.container, context);
	cardDisplays.clear();
	assets.destroy();
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
	style:cursor={cursor}
	style:touch-action="none"
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
