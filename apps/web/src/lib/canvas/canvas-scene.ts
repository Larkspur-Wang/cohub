import type { Container, Graphics } from "pixi.js";
import {
	frameHandlePosition,
	type Point,
	RESIZE_HANDLES,
	type Rect,
	rotationHandlePosition,
} from "$lib/canvas/canvas-geometry";
import type { CanvasFrame, CanvasItem } from "$lib/canvas/canvas-schema";
import type {
	CanvasCardRenderer,
	CanvasRenderContext,
	CanvasRenderPalette,
	getCanvasCardRenderer,
} from "$lib/canvas/renderers/canvas-renderer-registry";

type CardEntry = {
	item: CanvasItem;
	container: Container;
	renderer: CanvasCardRenderer;
	/** Last visibility applied; a change forces a renderer update. */
	visible: boolean;
	/** Last global frame signature seen by this card (selection/hover/theme/…). */
	frameSig: string;
};

export type SceneSyncInput = {
	items: CanvasItem[];
	context: CanvasRenderContext;
	/**
	 * Ids whose cards should be rendered this frame, or null to disable culling
	 * (render everything — used until the surface has a real size).
	 */
	visibleIds: Set<string> | null;
	/** Ids always rendered regardless of culling (selected, editing). */
	pinnedIds: Set<string>;
	/**
	 * A signature of the global render signals that are not carried by an item's
	 * identity (selection, hover, texture availability, theme). When it is stable
	 * and an item is unchanged, that card's renderer update is skipped — so a drag
	 * refreshes only the dragged cards and a pan refreshes none.
	 */
	frameSig: string;
};

export type SceneOverlayInput = {
	zoom: number;
	marquee: Rect | null;
	bounds: Rect | null;
	selection: string[];
	/** Frame of the single selected item (drives resize handles), or null. */
	singleFrame: CanvasFrame | null;
};

export type CanvasScene = {
	sync: (input: SceneSyncInput) => void;
	drawOverlay: (input: SceneOverlayInput, palette: CanvasRenderPalette) => void;
	destroy: (context: CanvasRenderContext) => void;
};

/**
 * Owns the Pixi display list for canvas cards and the selection overlay.
 *
 * Rendering is split into two concerns that run at very different rates:
 * - **Structure** (add / remove / z-order): only reconciled when the item
 *   sequence actually changes. This is what removes the old per-frame
 *   `setChildIndex` pass, which was O(N²) on every camera or hover change.
 * - **Appearance** (position, visibility, selection state): applied every
 *   frame, but only cards inside the viewport (plus pinned ones) pay for a
 *   renderer update — off-screen cards are simply hidden, so Pixi skips them
 *   entirely and we skip their JS-side redraw.
 */
export function createCanvasScene(options: {
	world: Container;
	overlay: Graphics;
	getRenderer: typeof getCanvasCardRenderer;
}): CanvasScene {
	const { world, overlay, getRenderer } = options;
	const cards = new Map<string, CardEntry>();
	// Texture reference ownership: cardId → texture key currently held. The scene
	// acquires a ref when a card becomes visible and releases it when hidden or
	// removed, so the asset manager's reference count tracks *displayed* images.
	// Off-screen textures drop to zero refs and enter the cooling pool (LRU).
	const heldKeys = new Map<string, string>();
	// The id sequence currently reflected in the child order. Compared by value
	// each sync so a pure drag (same ids, same order) skips the z-order rebuild.
	let renderedOrder: string[] = [];

	function setHeldKey(
		context: CanvasRenderContext,
		cardId: string,
		desiredKey: string | null,
	) {
		const heldKey = heldKeys.get(cardId) ?? null;
		if (desiredKey === heldKey) return;
		if (heldKey) context.releaseTexture(heldKey);
		if (desiredKey) context.acquireTexture(desiredKey);
		if (desiredKey) heldKeys.set(cardId, desiredKey);
		else heldKeys.delete(cardId);
	}

	function sync(input: SceneSyncInput) {
		const { items, context, visibleIds, pinnedIds, frameSig } = input;
		let structureChanged = false;

		const nextIds = new Set(items.map((item) => item.id));
		for (const [id, entry] of cards) {
			if (nextIds.has(id)) continue;
			world.removeChild(entry.container);
			entry.renderer.destroy?.(entry.container, context);
			cards.delete(id);
			setHeldKey(context, id, null);
			structureChanged = true;
		}

		const nextOrder: string[] = [];
		const justCreated = new Set<string>();
		for (const item of items) {
			nextOrder.push(item.id);
			const renderer = getRenderer(item, context);
			const existing = cards.get(item.id);
			if (existing && existing.renderer.id === renderer.id) continue;
			if (existing) {
				world.removeChild(existing.container);
				existing.renderer.destroy?.(existing.container, context);
			}
			const container = renderer.create(item, context);
			cards.set(item.id, {
				item,
				container,
				renderer,
				visible: false,
				frameSig: "",
			});
			world.addChild(container);
			justCreated.add(item.id);
			structureChanged = true;
		}

		const orderChanged =
			nextOrder.length !== renderedOrder.length ||
			nextOrder.some((id, index) => renderedOrder[index] !== id);
		if (structureChanged || orderChanged) {
			let index = 0;
			for (const id of nextOrder) {
				const entry = cards.get(id);
				if (entry) world.setChildIndex(entry.container, index);
				index += 1;
			}
			if (overlay.parent === world)
				world.setChildIndex(overlay, world.children.length - 1);
			renderedOrder = nextOrder;
		}

		// Appearance pass: cull to the viewport and refresh only the cards that
		// actually changed. A card needs an update when its item identity changed
		// (e.g. it is being dragged), its visibility flipped, or a global signal
		// shifted (frameSig). Otherwise its existing display is still correct and
		// we skip the renderer call entirely.
		for (const item of items) {
			const entry = cards.get(item.id);
			if (!entry) continue;
			const visible =
				visibleIds === null ||
				visibleIds.has(item.id) ||
				pinnedIds.has(item.id);
			entry.container.visible = visible;
			// Texture ref follows visibility: visible cards pin their texture; hidden
			// cards release it into the cooling pool.
			const desiredKey = visible ? context.imageKey(item) : null;
			setHeldKey(context, item.id, desiredKey);
			const changed =
				visible !== entry.visible ||
				item !== entry.item ||
				frameSig !== entry.frameSig;
			entry.visible = visible;
			entry.item = item;
			entry.frameSig = frameSig;
			// A freshly created container is already synced by create(); skip a
			// redundant immediate update.
			if (visible && changed && !justCreated.has(item.id))
				entry.renderer.update(entry.container, item, context);
		}
	}

	function drawOverlay(input: SceneOverlayInput, palette: CanvasRenderPalette) {
		overlay.clear();
		const { zoom, marquee, bounds, selection, singleFrame } = input;
		const inv = 1 / zoom;
		const brand = palette.brand;

		if (marquee) {
			overlay
				.rect(marquee.x, marquee.y, marquee.width, marquee.height)
				.fill({ color: brand, alpha: 0.08 });
			overlay
				.rect(marquee.x, marquee.y, marquee.width, marquee.height)
				.stroke({ color: brand, width: inv, alpha: 0.7 });
		}

		if (!bounds || selection.length === 0) return;

		overlay
			.rect(bounds.x, bounds.y, bounds.width, bounds.height)
			.stroke({ color: brand, width: 1.5 * inv, alpha: 0.95 });

		const source: CanvasFrame = singleFrame ?? { ...bounds, rotation: 0 };
		const handles = singleFrame
			? RESIZE_HANDLES
			: (["nw", "ne", "se", "sw"] as const);
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
		const topCenter: Point = {
			x: bounds.x + bounds.width / 2,
			y: bounds.y,
		};
		overlay
			.moveTo(topCenter.x, topCenter.y)
			.lineTo(rotation.x, rotation.y)
			.stroke({ color: brand, width: inv, alpha: 0.8 });
		overlay
			.circle(rotation.x, rotation.y, 5 * inv)
			.fill({ color: palette.surface })
			.stroke({ color: brand, width: 1.5 * inv });
	}

	function destroy(context: CanvasRenderContext) {
		for (const entry of cards.values())
			entry.renderer.destroy?.(entry.container, context);
		cards.clear();
		for (const key of heldKeys.values()) context.releaseTexture(key);
		heldKeys.clear();
		renderedOrder = [];
	}

	return { sync, drawOverlay, destroy };
}
