import type { CanvasSemanticOp } from "@neta-art/cohub";
import { untrack } from "svelte";
import { createCommitQueue } from "$lib/canvas/canvas-commit-queue";
import {
	applyCanvasOps,
	diffCanvasDocuments,
	invertCanvasOps,
	reconcileExternal,
} from "$lib/canvas/canvas-document";
import {
	angleFromCenter,
	clampZoom,
	fitToContent,
	frameContainsPoint,
	frameHandlePosition,
	HANDLE_HIT_RADIUS,
	itemBounds,
	normalizeRotation,
	panBy,
	pointToWorld,
	RESIZE_HANDLES,
	type Rect,
	type ResizeHandle,
	rectCenter,
	rectsIntersect,
	resizeFrame,
	rotateFrames,
	rotationHandlePosition,
	type ScreenPoint,
	scaleFrames,
	screenPoint,
	selectionBounds,
	type WorldPoint,
	zoomAround,
} from "$lib/canvas/canvas-geometry";
import {
	createRemoteUrlCanvasItem,
	createSpaceFileCanvasItem,
	createTextCanvasItem,
	duplicateCanvasItem,
	patchItemFrames,
	removeCanvasItems,
	titleForCanvasItem,
} from "$lib/canvas/canvas-items";
import type {
	CanvasFrame,
	CanvasItem,
	CanvasItemStyle,
	CanvasViewport,
	CovasDocument,
} from "$lib/canvas/canvas-schema";

export type CanvasToolId = "select" | "hand";
export type CanvasEmphasis = CanvasItemStyle["emphasis"];

/**
 * The synced portion of a canvas document (everything semantic ops describe).
 * The camera/viewport is deliberately excluded: it is local UI state, never
 * part of a transaction.
 */
type SyncedContent = {
	kind: CovasDocument["kind"];
	version: CovasDocument["version"];
	appearance: CovasDocument["appearance"];
	items: CanvasItem[];
};

export type CanvasInteraction =
	| { type: "idle" }
	| { type: "panning"; start: ScreenPoint; origin: CanvasViewport }
	| {
			type: "translating";
			start: WorldPoint;
			origin: Map<string, CanvasFrame>;
			moved: boolean;
	  }
	| {
			type: "resizing";
			handle: ResizeHandle;
			single: CanvasFrame | null;
			bounds: Rect;
			origin: Map<string, CanvasFrame>;
			moved: boolean;
	  }
	| {
			type: "rotating";
			pivot: WorldPoint;
			startAngle: number;
			origin: Map<string, CanvasFrame>;
			moved: boolean;
	  }
	| {
			type: "brushing";
			start: WorldPoint;
			current: WorldPoint;
			additive: boolean;
			/** Selection at brush start, so an additive marquee can add and remove. */
			baseSelection: string[];
	  };

/**
 * A pointer sample carrying both coordinate spaces. The stage performs the
 * screen→world conversion exactly once at the boundary; the editor then uses
 * `world` for geometry (hit testing, resize, rotate, translate, marquee) and
 * `screen` for viewport operations (panning, pinch).
 */
export type CanvasPointerEvent = {
	pointerId: number;
	screen: ScreenPoint;
	world: WorldPoint;
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	button: number;
	pointerType: string;
};

export type CanvasViewState = {
	camera: CanvasViewport;
	visibleRect: Rect | null;
	selectedNodes: Array<{ id: string; type: string; title?: string }>;
};

export type CanvasEditorOptions = {
	document: CovasDocument;
	/** Stable identity (e.g. file path) used to tell a document switch from a remote refresh. */
	key?: string;
	onCommit: (
		document: CovasDocument,
		ops: CanvasSemanticOp[],
	) => void | Promise<void>;
	onViewStateChange?: (state: CanvasViewState) => void;
};

const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 10;
const ZOOM_STEP = 1.2;
const CAMERA_ANIMATION_MS = 240;
/** Pointer travel (screen px) before a press becomes a drag. */
const DRAG_THRESHOLD = 3;
const CORNER_HANDLES: ResizeHandle[] = ["nw", "ne", "se", "sw"];

function easeOutCubic(t: number) {
	return 1 - (1 - t) * (1 - t) * (1 - t);
}

function toContent(document: CovasDocument): SyncedContent {
	return {
		kind: document.kind,
		version: document.version,
		appearance: document.appearance,
		items: document.items,
	};
}

export function createCanvasEditor(options: CanvasEditorOptions) {
	// ─── Reactive state ─────────────────────────────────────────────
	// Synced content and the local camera are held separately so the viewport
	// is never mistaken for persisted state. `document` composes them for
	// consumers that expect a full CovasDocument.
	let synced = $state<SyncedContent>(toContent(options.document));
	let camera = $state<CanvasViewport>(options.document.viewport);
	let selection = $state<string[]>([]);
	let tool = $state<CanvasToolId>("select");
	let interaction = $state<CanvasInteraction>({ type: "idle" });
	let hoverId = $state<string | null>(null);
	let editingId = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let surfaceSize = $state<{ width: number; height: number }>({
		width: 0,
		height: 0,
	});
	let undoStack = $state<CanvasSemanticOp[][]>([]);
	let redoStack = $state<CanvasSemanticOp[][]>([]);
	let localRev = $state(0);
	let committedRev = $state(0);
	let draftId = $state<string | null>(null);

	let cameraAnimation = 0;
	let pinch: { distance: number; midpoint: ScreenPoint; zoom: number } | null =
		null;
	const activePointers = new Map<number, ScreenPoint>();

	// Undo history is local and optimistic: it records user actions as they
	// happen, independent of whether/when they sync. `undoBaseline` is the
	// document at the last recorded step; each step diffs against it.
	let undoBaseline: CovasDocument = {
		...toContent(options.document),
		viewport: options.document.viewport,
	};
	// Bumped on genuine external loads so stale in-flight commit results are ignored.
	let syncGeneration = 0;
	// Identity of the loaded document, to distinguish a document switch (reset
	// camera) from a remote refresh of the same document (keep camera).
	let currentKey: string | undefined = options.key;
	// The last document state the server is known to have (our last successful
	// commit, or the last external refresh). Rebase diffs local changes against it.
	let externalBaseline: CovasDocument = {
		...toContent(options.document),
		viewport: options.document.viewport,
	};
	// A remote refresh deferred because the user is mid-gesture or editing.
	let pendingRemote: { doc: CovasDocument; key: string | undefined } | null =
		null;

	// Serial persistence: diffs immutable snapshots against a running baseline.
	const queue = createCommitQueue(async (document, ops) => {
		await options.onCommit(document, ops);
	});
	queue.reset({ ...synced, viewport: camera });

	// ─── Derived ────────────────────────────────────────────────────
	const document = $derived<CovasDocument>({ ...synced, viewport: camera });
	const items = $derived(synced.items);
	const dirty = $derived(localRev > committedRev);
	const selectedFrames = $derived(
		selection
			.map((id) => synced.items.find((item) => item.id === id)?.frame)
			.filter((frame): frame is CanvasFrame => Boolean(frame)),
	);
	const bounds = $derived(selectionBounds(selectedFrames));
	const selectedItems = $derived(
		synced.items.filter((item) => selection.includes(item.id)),
	);
	const marquee = $derived.by<Rect | null>(() => {
		if (interaction.type !== "brushing") return null;
		const start = interaction.start;
		const current = interaction.current;
		return {
			x: Math.min(start.x, current.x),
			y: Math.min(start.y, current.y),
			width: Math.abs(current.x - start.x),
			height: Math.abs(current.y - start.y),
		};
	});

	// ─── Mutation + persistence ─────────────────────────────────────
	function setItems(next: CanvasItem[]) {
		synced = { ...synced, items: next };
		localRev += 1;
	}

	/**
	 * Record the current document as one undo step (diffed against the last
	 * recorded step). Purely local and synchronous — it does not wait for sync,
	 * so an action is undoable even if its upload is still pending or fails.
	 */
	function recordUndoStep() {
		const ops = diffCanvasDocuments(undoBaseline, document);
		if (ops.length === 0) return;
		undoStack = [...undoStack, ops];
		redoStack = [];
		undoBaseline = document;
	}

	/** Sync the current document to the server (no undo semantics here). */
	function requestCommit() {
		const snapshot = document;
		const rev = localRev;
		const gen = syncGeneration;
		void queue.commit(snapshot).then((outcome) => {
			// A genuine external load happened since; this result is stale.
			if (gen !== syncGeneration) return;
			if (outcome.ok) {
				committedRev = Math.max(committedRev, rev);
				// The server now has this snapshot; it is the new rebase baseline.
				externalBaseline = snapshot;
				saveError = null;
			} else {
				saveError =
					outcome.error instanceof Error
						? outcome.error.message
						: "Failed to sync canvas";
			}
		});
	}

	/** A user action: record an undo step, then sync. */
	function commitAction() {
		recordUndoStep();
		requestCommit();
	}

	function undo() {
		const ops = undoStack.at(-1);
		if (!ops) return;
		undoStack = undoStack.slice(0, -1);
		redoStack = [...redoStack, ops];
		const next = applyCanvasOps(document, invertCanvasOps(ops));
		setItems(next.items);
		undoBaseline = document;
		requestCommit();
	}

	function redo() {
		const ops = redoStack.at(-1);
		if (!ops) return;
		redoStack = redoStack.slice(0, -1);
		undoStack = [...undoStack, ops];
		const next = applyCanvasOps(document, ops);
		setItems(next.items);
		undoBaseline = document;
		requestCommit();
	}

	// ─── Camera (local UI state) ────────────────────────────────────
	function setCamera(viewport: CanvasViewport) {
		camera = viewport;
	}

	function cancelCameraAnimation() {
		if (cameraAnimation) cancelAnimationFrame(cameraAnimation);
		cameraAnimation = 0;
	}

	function animateCamera(target: CanvasViewport) {
		cancelCameraAnimation();
		const from = { ...camera };
		const started = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - started) / CAMERA_ANIMATION_MS);
			const eased = easeOutCubic(t);
			setCamera({
				x: from.x + (target.x - from.x) * eased,
				y: from.y + (target.y - from.y) * eased,
				zoom: from.zoom + (target.zoom - from.zoom) * eased,
			});
			cameraAnimation = t < 1 ? requestAnimationFrame(step) : 0;
		};
		cameraAnimation = requestAnimationFrame(step);
	}

	function surfaceCenter(): ScreenPoint {
		return screenPoint(surfaceSize.width / 2, surfaceSize.height / 2);
	}

	function viewCenter(): WorldPoint {
		return pointToWorld(surfaceCenter(), camera);
	}

	function zoomAt(point: ScreenPoint, factor: number, animate = false) {
		const target = zoomAround(camera, point, camera.zoom * factor);
		if (animate) animateCamera(target);
		else setCamera(target);
	}

	function zoomIn() {
		zoomAt(surfaceCenter(), ZOOM_STEP, true);
	}

	function zoomOut() {
		zoomAt(surfaceCenter(), 1 / ZOOM_STEP, true);
	}

	function resetZoom() {
		animateCamera({ ...camera, zoom: 1 });
	}

	function fitView() {
		const content = selectionBounds(synced.items.map((item) => item.frame));
		if (!content || surfaceSize.width === 0) {
			animateCamera({ x: 0, y: 0, zoom: 1 });
			return;
		}
		animateCamera(fitToContent(content, surfaceSize));
	}

	// ─── Selection ──────────────────────────────────────────────────
	function setSelection(ids: string[]) {
		selection = ids;
	}

	function clearSelection() {
		selection = [];
	}

	function selectAll() {
		selection = synced.items.map((item) => item.id);
	}

	// ─── Commands ───────────────────────────────────────────────────
	function addItemAt(item: CanvasItem) {
		setItems([...synced.items, item]);
		selection = [item.id];
		commitAction();
	}

	function addFile(path: string, at: WorldPoint) {
		addItemAt(createSpaceFileCanvasItem(path, at.x, at.y));
	}

	function addUrl(url: string, at: WorldPoint) {
		addItemAt(createRemoteUrlCanvasItem(url, at.x, at.y));
	}

	function addText(text: string, at: WorldPoint) {
		addItemAt(createTextCanvasItem(text, at.x, at.y));
	}

	/**
	 * Start an inline text note as a local-only draft (double-click on empty
	 * canvas). It is not marked dirty, recorded in undo, or synced until the
	 * edit is confirmed non-empty — so an abandoned empty note leaves no trace.
	 */
	function beginTextDraft(at: WorldPoint) {
		const item = createTextCanvasItem("", at.x, at.y);
		synced = { ...synced, items: [...synced.items, item] };
		draftId = item.id;
		selection = [item.id];
		editingId = item.id;
	}

	/** Finish an inline text edit, handling drafts and empty results. */
	function commitTextEdit(id: string, text: string) {
		const isDraft = id === draftId;
		if (text.trim() === "") {
			if (isDraft) {
				// Never synced — drop it without an op.
				synced = {
					...synced,
					items: removeCanvasItems(synced.items, new Set([id])),
				};
			} else {
				deleteItem(id);
			}
		} else {
			updateText(id, text);
		}
		editingId = null;
		draftId = null;
		// Apply any remote refresh deferred for the duration of this edit.
		flushPendingRemote();
	}

	function deleteSelection() {
		if (selection.length === 0) return;
		setItems(removeCanvasItems(synced.items, new Set(selection)));
		selection = [];
		editingId = null;
		commitAction();
	}

	function deleteItem(id: string) {
		setItems(removeCanvasItems(synced.items, new Set([id])));
		selection = selection.filter((selectedId) => selectedId !== id);
		if (editingId === id) editingId = null;
		commitAction();
	}

	function duplicateSelection() {
		if (selection.length === 0) return;
		const ids = new Set(selection);
		const copies = synced.items
			.filter((item) => ids.has(item.id))
			.map(duplicateCanvasItem);
		if (copies.length === 0) return;
		setItems([...synced.items, ...copies]);
		selection = copies.map((copy) => copy.id);
		commitAction();
	}

	function nudgeSelection(dx: number, dy: number, large: boolean) {
		if (selection.length === 0) return;
		const step = large ? NUDGE_STEP_LARGE : NUDGE_STEP;
		const ids = new Set(selection);
		const frames = new Map<string, CanvasFrame>();
		for (const item of synced.items) {
			if (!ids.has(item.id)) continue;
			frames.set(item.id, {
				...item.frame,
				x: item.frame.x + dx * step,
				y: item.frame.y + dy * step,
			});
		}
		setItems(patchItemFrames(synced.items, frames));
		commitAction();
	}

	function setSelectionEmphasis(emphasis: CanvasEmphasis) {
		if (selection.length === 0) return;
		const ids = new Set(selection);
		const next = synced.items.map((item) =>
			ids.has(item.id)
				? {
						...item,
						style: {
							...item.style,
							variant: item.style?.variant ?? "default",
							size: item.style?.size ?? "md",
							effects: item.style?.effects ?? [],
							emphasis,
						},
					}
				: item,
		);
		setItems(next);
		commitAction();
	}

	function bringToFront() {
		if (selection.length === 0) return;
		const ids = new Set(selection);
		const rest = synced.items.filter((item) => !ids.has(item.id));
		const chosen = synced.items.filter((item) => ids.has(item.id));
		setItems([...rest, ...chosen]);
		commitAction();
	}

	function sendToBack() {
		if (selection.length === 0) return;
		const ids = new Set(selection);
		const chosen = synced.items.filter((item) => ids.has(item.id));
		const rest = synced.items.filter((item) => !ids.has(item.id));
		setItems([...chosen, ...rest]);
		commitAction();
	}

	function updateText(id: string, text: string) {
		const target = synced.items.find((item) => item.id === id);
		if (target?.type !== "text" || target.text === text) return;
		setItems(
			synced.items.map((item) =>
				item.id === id && item.type === "text" ? { ...item, text } : item,
			),
		);
		commitAction();
	}

	// ─── Hit testing (world space) ──────────────────────────────────
	function topItemAt(point: WorldPoint): CanvasItem | null {
		for (let index = synced.items.length - 1; index >= 0; index--) {
			const item = synced.items[index];
			if (item && frameContainsPoint(item.frame, point)) return item;
		}
		return null;
	}

	function handleAt(point: WorldPoint): ResizeHandle | null {
		if (!bounds) return null;
		const radius = HANDLE_HIT_RADIUS / camera.zoom;
		if (selection.length === 1) {
			const frame = selectedFrames[0];
			if (!frame) return null;
			for (const handle of RESIZE_HANDLES) {
				const position = frameHandlePosition(frame, handle);
				if (Math.hypot(position.x - point.x, position.y - point.y) <= radius)
					return handle;
			}
			return null;
		}
		const rect: CanvasFrame = { ...bounds, rotation: 0 };
		for (const handle of CORNER_HANDLES) {
			const position = frameHandlePosition(rect, handle);
			if (Math.hypot(position.x - point.x, position.y - point.y) <= radius)
				return handle;
		}
		return null;
	}

	function rotationHandleHit(point: WorldPoint): boolean {
		if (selection.length === 0 || !bounds) return false;
		const position = rotationHandlePosition(bounds, camera.zoom);
		const radius = HANDLE_HIT_RADIUS / camera.zoom;
		return Math.hypot(position.x - point.x, position.y - point.y) <= radius;
	}

	function framesFor(ids: string[]): Map<string, CanvasFrame> {
		const frames = new Map<string, CanvasFrame>();
		for (const item of synced.items) {
			if (ids.includes(item.id)) frames.set(item.id, { ...item.frame });
		}
		return frames;
	}

	// ─── Pointer interaction state machine ─────────────────────────
	function beginPinch() {
		const points = [...activePointers.values()];
		const [a, b] = points;
		if (!a || !b) return;
		pinch = {
			distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
			midpoint: screenPoint((a.x + b.x) / 2, (a.y + b.y) / 2),
			zoom: camera.zoom,
		};
		interaction = { type: "idle" };
	}

	function pointerDown(event: CanvasPointerEvent) {
		cancelCameraAnimation();
		activePointers.set(event.pointerId, event.screen);
		if (activePointers.size === 2) {
			beginPinch();
			return;
		}
		if (activePointers.size > 2) return;

		const additive = event.shiftKey || event.metaKey || event.ctrlKey;

		if (tool === "hand" || event.button === 1 || event.altKey) {
			interaction = {
				type: "panning",
				start: event.screen,
				origin: { ...camera },
			};
			return;
		}

		if (rotationHandleHit(event.world) && bounds) {
			const pivot = rectCenter(bounds);
			interaction = {
				type: "rotating",
				pivot,
				startAngle: angleFromCenter(pivot, event.world),
				origin: framesFor(selection),
				moved: false,
			};
			return;
		}

		const handle = handleAt(event.world);
		if (handle && bounds) {
			interaction = {
				type: "resizing",
				handle,
				single:
					selection.length === 1 && selectedFrames[0]
						? { ...selectedFrames[0] }
						: null,
				bounds,
				origin: framesFor(selection),
				moved: false,
			};
			return;
		}

		const item = topItemAt(event.world);
		if (item) {
			if (additive) {
				selection = selection.includes(item.id)
					? selection.filter((id) => id !== item.id)
					: [...selection, item.id];
			} else if (!selection.includes(item.id)) {
				selection = [item.id];
			}
			interaction = {
				type: "translating",
				start: event.world,
				origin: framesFor(selection),
				moved: false,
			};
			return;
		}

		interaction = {
			type: "brushing",
			start: event.world,
			current: event.world,
			additive,
			baseSelection: selection,
		};
	}

	function pointerMove(event: CanvasPointerEvent) {
		if (activePointers.has(event.pointerId))
			activePointers.set(event.pointerId, event.screen);

		if (pinch && activePointers.size >= 2) {
			const points = [...activePointers.values()];
			const [a, b] = points;
			if (a && b) {
				const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
				const midpoint = screenPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
				const zoom = clampZoom(pinch.zoom * (distance / pinch.distance));
				const zoomed = zoomAround(camera, midpoint, zoom);
				setCamera(
					panBy(
						zoomed,
						midpoint.x - pinch.midpoint.x,
						midpoint.y - pinch.midpoint.y,
					),
				);
				pinch = { ...pinch, midpoint };
			}
			return;
		}

		if (interaction.type === "idle") {
			hoverId = topItemAt(event.world)?.id ?? null;
			return;
		}

		if (interaction.type === "panning") {
			setCamera(
				panBy(
					interaction.origin,
					event.screen.x - interaction.start.x,
					event.screen.y - interaction.start.y,
				),
			);
			return;
		}

		if (interaction.type === "translating") {
			const dx = event.world.x - interaction.start.x;
			const dy = event.world.y - interaction.start.y;
			// Ignore sub-threshold jitter so a plain click never mutates frames
			// (which would otherwise leave the canvas permanently "Pending").
			if (!interaction.moved) {
				if (Math.hypot(dx, dy) <= DRAG_THRESHOLD / camera.zoom) return;
				interaction.moved = true;
			}
			const frames = new Map<string, CanvasFrame>();
			for (const [id, frame] of interaction.origin) {
				frames.set(id, { ...frame, x: frame.x + dx, y: frame.y + dy });
			}
			setItems(patchItemFrames(synced.items, frames));
			return;
		}

		if (interaction.type === "resizing") {
			interaction.moved = true;
			const frames = new Map<string, CanvasFrame>();
			if (interaction.single) {
				const id = [...interaction.origin.keys()][0];
				if (id)
					frames.set(
						id,
						resizeFrame(interaction.single, interaction.handle, event.world),
					);
			} else {
				const scaled = scaleFrames(
					[...interaction.origin.values()],
					interaction.bounds,
					interaction.handle,
					event.world,
				);
				let index = 0;
				for (const id of interaction.origin.keys()) {
					const frame = scaled[index];
					if (frame) frames.set(id, frame);
					index += 1;
				}
			}
			setItems(patchItemFrames(synced.items, frames));
			return;
		}

		if (interaction.type === "rotating") {
			interaction.moved = true;
			const delta =
				angleFromCenter(interaction.pivot, event.world) -
				interaction.startAngle;
			const rotated = rotateFrames(
				[...interaction.origin.values()],
				interaction.pivot,
				delta,
			);
			const frames = new Map<string, CanvasFrame>();
			let index = 0;
			for (const id of interaction.origin.keys()) {
				const frame = rotated[index];
				if (frame) frames.set(id, frame);
				index += 1;
			}
			setItems(patchItemFrames(synced.items, frames));
			return;
		}

		if (interaction.type === "brushing") {
			interaction = { ...interaction, current: event.world };
			const rect = marquee;
			if (!rect) return;
			const hits = synced.items
				.filter((item) => rectsIntersect(itemBounds(item.frame), rect))
				.map((item) => item.id);
			selection = interaction.additive
				? [...new Set([...interaction.baseSelection, ...hits])]
				: hits;
		}
	}

	function pointerUp(event: CanvasPointerEvent) {
		activePointers.delete(event.pointerId);
		if (activePointers.size < 2) pinch = null;
		if (activePointers.size > 0) return;

		if (interaction.type === "translating" && interaction.moved) {
			commitAction();
		} else if (interaction.type === "resizing" && interaction.moved) {
			commitAction();
		} else if (interaction.type === "rotating" && interaction.moved) {
			normalizeRotations();
			commitAction();
		} else if (interaction.type === "brushing" && !interaction.additive) {
			// A click on empty space (no real drag) clears the selection.
			const dx = interaction.current.x - interaction.start.x;
			const dy = interaction.current.y - interaction.start.y;
			if (Math.hypot(dx, dy) <= 1 / camera.zoom) selection = [];
		}
		interaction = { type: "idle" };
		// Apply any remote refresh deferred for the duration of this gesture.
		flushPendingRemote();
	}

	function normalizeRotations() {
		const ids = new Set(selection);
		const frames = new Map<string, CanvasFrame>();
		for (const item of synced.items) {
			if (!ids.has(item.id) || !item.frame.rotation) continue;
			const normalized = normalizeRotation(item.frame.rotation);
			if (normalized !== item.frame.rotation)
				frames.set(item.id, { ...item.frame, rotation: normalized });
		}
		if (frames.size > 0) setItems(patchItemFrames(synced.items, frames));
	}

	// ─── Wheel ──────────────────────────────────────────────────────
	function wheel(
		point: ScreenPoint,
		deltaX: number,
		deltaY: number,
		zoomKey: boolean,
	) {
		if (zoomKey) {
			setCamera(
				zoomAround(camera, point, camera.zoom * Math.exp(-deltaY * 0.002)),
			);
		} else {
			setCamera(panBy(camera, -deltaX, -deltaY));
		}
	}

	// ─── View state reporting ───────────────────────────────────────
	function emitViewState() {
		if (!options.onViewStateChange) return;
		const visibleRect =
			surfaceSize.width > 0 && surfaceSize.height > 0
				? {
						x: -camera.x / camera.zoom,
						y: -camera.y / camera.zoom,
						width: surfaceSize.width / camera.zoom,
						height: surfaceSize.height / camera.zoom,
					}
				: null;
		const selectedNodes = selectedItems.flatMap((item) => {
			const title = titleForCanvasItem(item).trim();
			return [{ id: item.id, type: item.type, ...(title ? { title } : {}) }];
		});
		options.onViewStateChange({ camera, visibleRect, selectedNodes });
	}

	$effect(() => {
		camera;
		surfaceSize;
		selectedItems;
		emitViewState();
	});

	// ─── Lifecycle ──────────────────────────────────────────────────
	function loadDocument(next: CovasDocument, key?: string) {
		// Ignore our own committed snapshots echoed back through the prop; only
		// genuine external documents replace local state.
		if (untrack(() => queue.isEcho(next))) return;
		const sameDocument = key !== undefined && key === currentKey;
		// Defer a same-document refresh while a gesture or text edit is in
		// progress: applying it now would leave the in-flight interaction
		// pointing at replaced nodes. It is applied (rebased) once the
		// interaction ends, via flushPendingRemote().
		if (sameDocument && (interaction.type !== "idle" || editingId)) {
			pendingRemote = { doc: next, key };
			return;
		}
		applyRemote(next, key, sameDocument);
	}

	/**
	 * Adopt an external document.
	 * - Same-document refresh: preserve uncommitted local changes by rebasing
	 *   them onto the remote document (diff against the last known server state,
	 *   re-apply on top), then sync the result. Conflict policy follows
	 *   applyCanvasOps: for a given node a delete beats a concurrent patch, and
	 *   local changes are applied last (local wins on same-field edits).
	 * - Document switch: adopt the new document as-is and drop the previous
	 *   document's local state (its changes belong to that document, not this one).
	 */
	function applyRemote(
		next: CovasDocument,
		key: string | undefined,
		sameDocument: boolean,
	) {
		currentKey = key;
		// A fresh external document supersedes any deferred refresh.
		pendingRemote = null;
		const { merged, hadLocalChanges } = reconcileExternal(
			externalBaseline,
			document,
			next,
			sameDocument,
		);
		synced = toContent(merged);
		// A document switch resets the camera; a same-document refresh keeps it.
		if (!sameDocument) camera = next.viewport;
		// The remote document is the server truth we rebased onto; the commit
		// outcome advances the baseline to `merged` once it lands.
		externalBaseline = next;
		undoBaseline = merged;
		syncGeneration += 1;
		queue.reset({ ...toContent(next), viewport: camera });
		if (hadLocalChanges) {
			localRev = 1;
			committedRev = 0;
			requestCommit();
		} else {
			localRev = 0;
			committedRev = 0;
		}
		// Undo history does not survive a rebase.
		undoStack = [];
		redoStack = [];
		// Keep the selection for items that still exist after a same-document
		// refresh; a document switch starts fresh.
		if (sameDocument) {
			const surviving = new Set(merged.items.map((item) => item.id));
			selection = selection.filter((id) => surviving.has(id));
		} else {
			selection = [];
		}
		editingId = null;
		draftId = null;
		saveError = null;
	}

	/** Apply a remote refresh deferred during a gesture or edit. */
	function flushPendingRemote() {
		if (!pendingRemote) return;
		const pending = pendingRemote;
		pendingRemote = null;
		const sameDocument =
			pending.key !== undefined && pending.key === currentKey;
		applyRemote(pending.doc, pending.key, sameDocument);
	}

	function destroy() {
		cancelCameraAnimation();
		activePointers.clear();
	}

	return {
		get document() {
			return document;
		},
		get items() {
			return items;
		},
		get camera() {
			return camera;
		},
		get selection() {
			return selection;
		},
		get selectedItems() {
			return selectedItems;
		},
		get bounds() {
			return bounds;
		},
		get marquee() {
			return marquee;
		},
		get tool() {
			return tool;
		},
		get interaction() {
			return interaction;
		},
		get hoverId() {
			return hoverId;
		},
		get editingId() {
			return editingId;
		},
		get dirty() {
			return dirty;
		},
		get saveError() {
			return saveError;
		},
		get canUndo() {
			return undoStack.length > 0;
		},
		get canRedo() {
			return redoStack.length > 0;
		},
		get hasContent() {
			return synced.items.length > 0;
		},
		set tool(value: CanvasToolId) {
			tool = value;
		},
		set editingId(value: string | null) {
			editingId = value;
		},
		set surfaceSize(value: { width: number; height: number }) {
			surfaceSize = value;
		},
		zoomIn,
		zoomOut,
		resetZoom,
		fitView,
		zoomAt,
		setCamera,
		viewCenter,
		itemAt: topItemAt,
		setSelection,
		clearSelection,
		selectAll,
		addFile,
		addUrl,
		addText,
		beginTextDraft,
		commitTextEdit,
		deleteSelection,
		deleteItem,
		duplicateSelection,
		nudgeSelection,
		setSelectionEmphasis,
		bringToFront,
		sendToBack,
		updateText,
		undo,
		redo,
		pointerDown,
		pointerMove,
		pointerUp,
		wheel,
		loadDocument,
		destroy,
	};
}

export type CanvasEditor = ReturnType<typeof createCanvasEditor>;
