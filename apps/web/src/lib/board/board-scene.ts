import type { Container, Graphics } from "pixi.js";
import {
	frameHandlePosition,
	type Point,
	RESIZE_HANDLES,
	type Rect,
	rotationHandlePosition,
} from "$lib/board/board-geometry";
import type { BoardFrame, BoardItem } from "$lib/board/board-schema";
import type {
	BoardCardRenderer,
	BoardRenderContext,
	BoardRenderPalette,
	getBoardCardRenderer,
} from "$lib/board/renderers/board-renderer-registry";

type CardEntry = {
	item: BoardItem;
	container: Container;
	renderer: BoardCardRenderer;
	/** Last visibility applied; a change forces a renderer update. */
	visible: boolean;
	/** Last per-card selection state seen by this card. */
	selected: boolean;
	/** Last per-card hover state seen by this card. */
	hovered: boolean;
	/** Last global signal (asset readiness / theme) seen by this card. */
	globalSig: string;
};

export type SceneSyncInput = {
	items: BoardItem[];
	context: BoardRenderContext;
	/**
	 * Ids whose cards should be rendered this frame, or null to disable culling
	 * (render everything — used until the surface has a real size).
	 */
	visibleIds: Set<string> | null;
	/** Ids always rendered regardless of culling (selected, editing). */
	pinnedIds: Set<string>;
	/**
	 * A signature of the *global* render signals that affect every card equally
	 * (asset readiness, theme). Selection and hover are tracked per card, so a
	 * hover change refreshes only the two affected cards rather than the whole
	 * viewport — the previous global signature redraw every visible card.
	 */
	globalSig: string;
};

export type SceneOverlayInput = {
	zoom: number;
	marquee: Rect | null;
	bounds: Rect | null;
	selection: string[];
	/** Frame of the single selected item (drives resize handles), or null. */
	singleFrame: BoardFrame | null;
	/** When true, hide box resize/rotation handles (e.g. arrows, locked). */
	hideBoxHandles?: boolean;
	/** World-space arrow endpoint handles to draw as circles. */
	arrowEndpoints?: Array<{ x: number; y: number }>;
};

export type BoardSceneNode = {
	item: BoardItem;
	container: Container;
};

export type BoardScene = {
	sync: (input: SceneSyncInput) => void;
	getNode: (nodeId: string) => BoardSceneNode | null;
	drawOverlay: (input: SceneOverlayInput, palette: BoardRenderPalette) => void;
	destroy: (context: BoardRenderContext) => void;
};

/**
 * Owns the Pixi display list for board cards and the selection overlay.
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
export function createBoardScene(options: {
	world: Container;
	overlay: Graphics;
	getRenderer: typeof getBoardCardRenderer;
}): BoardScene {
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
		context: BoardRenderContext,
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
		const { items, context, visibleIds, pinnedIds, globalSig } = input;
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
				selected: false,
				hovered: false,
				globalSig: "",
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
		// (it is being dragged), its visibility flipped, its own selection/hover
		// state flipped, or a global signal shifted. A hover therefore touches two
		// cards, a selection change touches the affected few, and a pure pan/drag
		// touches none beyond the dragged card.
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
			const selected = context.selectedIds.has(item.id);
			const hovered = context.hoveredId === item.id;
			const changed =
				visible !== entry.visible ||
				item !== entry.item ||
				selected !== entry.selected ||
				hovered !== entry.hovered ||
				globalSig !== entry.globalSig;
			entry.visible = visible;
			entry.item = item;
			entry.selected = selected;
			entry.hovered = hovered;
			entry.globalSig = globalSig;
			// A freshly created container is already synced by create(); skip a
			// redundant immediate update.
			if (visible && changed && !justCreated.has(item.id))
				entry.renderer.update(entry.container, item, context);
		}
	}

	function drawOverlay(input: SceneOverlayInput, palette: BoardRenderPalette) {
		overlay.clear();
		const {
			zoom,
			marquee,
			bounds,
			selection,
			singleFrame,
			hideBoxHandles,
			arrowEndpoints,
		} = input;
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

		// Arrow endpoints (or other custom handles) take priority over box chrome.
		if (arrowEndpoints && arrowEndpoints.length > 0) {
			const r = 5 * inv;
			for (const point of arrowEndpoints) {
				overlay
					.circle(point.x, point.y, r)
					.fill({ color: palette.surface, alpha: 1 })
					.stroke({ color: brand, width: 1.5 * inv });
			}
			return;
		}

		if (hideBoxHandles) return;

		const source: BoardFrame = singleFrame ?? { ...bounds, rotation: 0 };
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

	function destroy(context: BoardRenderContext) {
		for (const entry of cards.values())
			entry.renderer.destroy?.(entry.container, context);
		cards.clear();
		for (const key of heldKeys.values()) context.releaseTexture(key);
		heldKeys.clear();
		renderedOrder = [];
	}

	return {
		sync,
		getNode: (nodeId) => {
			const entry = cards.get(nodeId);
			return entry ? { item: entry.item, container: entry.container } : null;
		},
		drawOverlay,
		destroy,
	};
}
