import type { BoardOperation } from "@neta-art/cohub";
import { untrack } from "svelte";
import { createCommitQueue } from "$lib/board/board-commit-queue";
import {
	applyBoardOps,
	diffBoardDocuments,
	invertBoardOps,
	reconcileExternal,
} from "$lib/board/board-document";
import {
	angleFromCenter,
	clampZoom,
	fitToContent,
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
	resizeFrameToSize,
	rotateFrames,
	rotationHandlePosition,
	type ScreenPoint,
	scaleFrames,
	screenPoint,
	selectionBounds,
	type WorldPoint,
	worldPoint,
	zoomAround,
} from "$lib/board/board-geometry";
import {
	createArrowBoardItem,
	createDrawBoardItem,
	createFrameBoardItem,
	createGeoBoardItem,
	createMediaBoardItem,
	createNoteBoardItem,
	createTextBoardItem,
	duplicateBoardItem,
	patchItemFrames,
	removeBoardItems,
	titleForBoardItem,
} from "$lib/board/board-items";
import type { ArrowEndpoint, DrawPoint } from "$lib/board/board-schema";
import {
	type AlignMode,
	alignFrames,
	type DistributeAxis,
	distributeFrames,
} from "$lib/board/core/align";
import {
	bindEndpointAt,
	type FrameLookup,
	resolveEndpoint,
	translateArrow,
} from "$lib/board/core/bindings";
import {
	type BoardClipboardPayload,
	defaultPasteOffset,
	encodeClipboard,
	materializeClipboard,
	parseClipboard,
} from "$lib/board/core/clipboard";
import { itemsToSvg } from "$lib/board/core/export-svg";
import {
	shapeBounds,
	shapeCapabilities,
	shapeHitTest,
} from "$lib/board/core/shape-definition";
import {
	arrowBoundsFor,
	arrowHitTest,
	resolveArrowFor,
} from "$lib/board/core/shapes";
import { computeSnap, type SnapGuide } from "$lib/board/core/snapping";
import "$lib/board/core/shapes";
import type {
	BoardArrowItem,
	BoardDocument,
	BoardFrame,
	BoardItem,
	BoardItemStyle,
	BoardViewport,
} from "$lib/board/board-schema";
import {
	createSpatialIndex,
	type SpatialEntry,
} from "$lib/board/board-spatial";
import {
	clampBoardTextFontSize,
	measureBoardText,
} from "$lib/board/core/text-layout";

export type BoardToolId =
	| "select"
	| "hand"
	| "text"
	| "note"
	| "geo"
	| "draw"
	| "arrow"
	| "frame";
export type BoardEmphasis = BoardItemStyle["emphasis"];
export type { AlignMode, DistributeAxis };

/**
 * The synced portion of a board document (everything semantic ops describe).
 * The camera/viewport is deliberately excluded: it is local UI state, never
 * part of a transaction.
 */
type SyncedContent = {
	kind: BoardDocument["kind"];
	version: BoardDocument["version"];
	appearance: BoardDocument["appearance"];
	items: BoardItem[];
};

export type BoardInteraction =
	| { type: "idle" }
	| { type: "panning"; start: ScreenPoint; origin: BoardViewport }
	| {
			type: "translating";
			start: WorldPoint;
			origin: Map<string, BoardFrame>;
			/** Origin arrow items, so free endpoints translate from their gesture-start
			 * positions (an arrow's geometry lives in its endpoints, not its frame). */
			arrowOrigin: Map<string, BoardArrowItem>;
			moved: boolean;
			/** Alt-drag: duplicate on first move, then translate the copies. */
			duplicate: boolean;
	  }
	| {
			type: "resizing";
			handle: ResizeHandle;
			single: BoardFrame | null;
			bounds: Rect;
			origin: Map<string, BoardFrame>;
			moved: boolean;
	  }
	| {
			type: "rotating";
			pivot: WorldPoint;
			startAngle: number;
			origin: Map<string, BoardFrame>;
			moved: boolean;
	  }
	| {
			type: "brushing";
			start: WorldPoint;
			current: WorldPoint;
			additive: boolean;
			/** Selection at brush start, so an additive marquee can add and remove. */
			baseSelection: string[];
	  }
	| {
			type: "drawing";
			/** Raw world-space samples collected so far. */
			points: DrawPoint[];
			color: string;
			size: number;
	  }
	| {
			type: "creatingArrow";
			start: WorldPoint;
			current: WorldPoint;
			color: string;
			/** Binding captured at the start point, if it landed on a shape. */
			startBinding: ArrowEndpoint | null;
	  }
	| {
			type: "creatingBox";
			kind: "note" | "geo" | "frame";
			start: WorldPoint;
			current: WorldPoint;
			color: string;
			geo: string;
	  }
	| {
			type: "draggingArrowHandle";
			arrowId: string;
			which: "start" | "end" | "mid";
			origin: BoardArrowItem;
			moved: boolean;
	  };

/**
 * A pointer sample carrying both coordinate spaces. The stage performs the
 * screen→world conversion exactly once at the boundary; the editor then uses
 * `world` for geometry (hit testing, resize, rotate, translate, marquee) and
 * `screen` for viewport operations (panning, pinch).
 */
export type BoardPointerEvent = {
	pointerId: number;
	screen: ScreenPoint;
	world: WorldPoint;
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	button: number;
	pointerType: string;
	/** Pen pressure 0..1; 0.5 for mouse/touch without pressure support. */
	pressure: number;
};

export type BoardViewState = {
	camera: BoardViewport;
	visibleRect: Rect | null;
	selectedNodes: Array<{ id: string; type: string; title?: string }>;
};

export type BoardEditorOptions = {
	document: BoardDocument;
	/** Stable identity (e.g. file path) used to tell a document switch from a remote refresh. */
	key?: string;
	onCommit: (
		document: BoardDocument,
		ops: BoardOperation[],
	) => void | Promise<void>;
	onViewStateChange?: (state: BoardViewState) => void;
};

const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 10;
const ZOOM_STEP = 1.28;
const CAMERA_ANIMATION_MS = 240;
/** Pointer travel (screen px) before a press becomes a drag. */
const DRAG_THRESHOLD = 3;
/** Snap attraction radius in screen px (scaled to world by zoom). */
const SNAP_THRESHOLD = 8;
const CORNER_HANDLES: ResizeHandle[] = ["nw", "ne", "se", "sw"];

function easeOutCubic(t: number) {
	return 1 - (1 - t) * (1 - t) * (1 - t);
}

function toContent(document: BoardDocument): SyncedContent {
	return {
		kind: document.kind,
		version: document.version,
		appearance: document.appearance,
		items: document.items,
	};
}

export function createBoardEditor(options: BoardEditorOptions) {
	// ─── Reactive state ─────────────────────────────────────────────
	// Synced content and the local camera are held separately so the viewport
	// is never mistaken for persisted state. `document` composes them for
	// consumers that expect a full BoardDocument.
	let synced = $state<SyncedContent>(toContent(options.document));
	let camera = $state<BoardViewport>(options.document.viewport);
	let selection = $state<string[]>([]);
	let tool = $state<BoardToolId>("select");
	let interaction = $state<BoardInteraction>({ type: "idle" });
	let hoverId = $state<string | null>(null);
	let editingId = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let surfaceSize = $state<{ width: number; height: number }>({
		width: 0,
		height: 0,
	});
	let undoStack = $state<BoardOperation[][]>([]);
	let redoStack = $state<BoardOperation[][]>([]);
	let localRev = $state(0);
	let committedRev = $state(0);
	let draftId = $state<string | null>(null);
	/** Bumped on item membership/order changes (not per-frame drags). */
	let structureVersion = $state(0);
	/** Bumped on geometry changes (nudge, align, drag commit). Stage cull cache
	 * keys on this so moved items re-enter/leave the viewport correctly. */
	let geometryVersion = $state(0);

	// Active creation style for the shape tools (color palette id, geo kind, draw
	// stroke size). Held locally — like the camera, this is UI state, never synced.
	let activeColor = $state("brand");
	let activeGeo = $state("rectangle");
	let drawSize = $state(4);
	/** Alignment guides for the in-progress drag, in world space (for rendering). */
	let snapGuides = $state<SnapGuide[]>([]);
	/** Space-bar temporary hand tool (does not change the persistent tool). */
	let spaceHeld = $state(false);
	/** Tool lock: keep the current creation tool after placing a shape. */
	let toolLocked = $state(false);
	/** Internal clipboard fallback when the system clipboard is unavailable. */
	let internalClipboard: BoardClipboardPayload | null = null;
	/** Paste count for progressive offset when pasting repeatedly in place. */
	let pasteCount = 0;

	let cameraAnimation = 0;
	let pinch: { distance: number; midpoint: ScreenPoint; zoom: number } | null =
		null;
	const activePointers = new Map<number, ScreenPoint>();

	// Undo history is local and optimistic: it records user actions as they
	// happen, independent of whether/when they sync. `undoBaseline` is the
	// document at the last recorded step; each step diffs against it.
	let undoBaseline: BoardDocument = {
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
	let externalBaseline: BoardDocument = {
		...toContent(options.document),
		viewport: options.document.viewport,
	};
	// A remote refresh deferred because the user is mid-gesture or editing.
	let pendingRemote: { doc: BoardDocument; key: string | undefined } | null =
		null;

	// Serial persistence: diffs immutable snapshots against a running baseline.
	const queue = createCommitQueue(async (document, ops) => {
		await options.onCommit(document, ops);
	});
	queue.reset({
		...toContent(options.document),
		viewport: options.document.viewport,
	});

	// Spatial index over item bounding boxes. Full rebuilds for membership
	// changes; dirty-entry upserts during gestures so a drag never pays O(n).
	const spatial = createSpatialIndex();
	let spatialVersion = 0;
	let indexedVersion = -1;
	let itemsById = new Map<string, BoardItem>();
	/** Pending dirty ids for incremental spatial updates (null = full rebuild). */
	let spatialDirty: Set<string> | null = null;

	function bumpSpatial(dirtyIds?: Iterable<string>) {
		spatialVersion += 1;
		if (!dirtyIds) {
			spatialDirty = null;
			return;
		}
		if (spatialDirty === null) return; // already needs full rebuild
		for (const id of dirtyIds) spatialDirty.add(id);
	}

	function bumpStructure() {
		structureVersion += 1;
	}

	function bumpGeometry() {
		geometryVersion += 1;
	}

	function ensureSpatial() {
		if (indexedVersion === spatialVersion) return;
		const current = synced.items;
		const dirty = spatialDirty;
		spatialDirty = new Set();
		indexedVersion = spatialVersion;

		if (dirty === null || itemsById.size === 0) {
			// Full rebuild path (membership change or first index).
			const entries: SpatialEntry[] = [];
			itemsById = new Map();
			current.forEach((item, index) => {
				itemsById.set(item.id, item);
				entries.push({
					id: item.id,
					order: index,
					rect: itemBounds(item.frame),
				});
			});
			spatial.rebuild(entries);
			return;
		}

		// Incremental: rebuild the id map order and upsert only dirty entries.
		const nextById = new Map<string, BoardItem>();
		const upserts = new Map<string, SpatialEntry | null>();
		current.forEach((item, index) => {
			nextById.set(item.id, item);
			if (dirty.has(item.id)) {
				upserts.set(item.id, {
					id: item.id,
					order: index,
					rect: itemBounds(item.frame),
				});
			}
		});
		for (const id of dirty) {
			if (!nextById.has(id)) upserts.set(id, null);
		}
		itemsById = nextById;
		spatial.upsert(upserts);
	}

	// ─── Derived ────────────────────────────────────────────────────
	const document = $derived<BoardDocument>({ ...synced, viewport: camera });
	const items = $derived(synced.items);
	const dirty = $derived(localRev > committedRev);
	const selectedFrames = $derived(
		selection
			.map((id) => synced.items.find((item) => item.id === id)?.frame)
			.filter((frame): frame is BoardFrame => Boolean(frame)),
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
	function setItems(
		next: BoardItem[],
		structural = true,
		dirtyIds?: Iterable<string>,
	) {
		synced = { ...synced, items: next };
		bumpSpatial(dirtyIds);
		if (structural) bumpStructure();
		// Membership changes and targeted geometry patches both move world bounds.
		if (structural || dirtyIds) bumpGeometry();
		localRev += 1;
	}

	function isLocked(item: BoardItem): boolean {
		return item.locked === true;
	}

	/** Filter a selection down to unlocked items (locked shapes stay put). */
	function unlockedIds(ids: Iterable<string>): string[] {
		const result: string[] = [];
		for (const id of ids) {
			const item = synced.items.find((entry) => entry.id === id);
			if (item && !isLocked(item)) result.push(id);
		}
		return result;
	}

	/**
	 * Record the current document as one undo step (diffed against the last
	 * recorded step). Purely local and synchronous — it does not wait for sync,
	 * so an action is undoable even if its upload is still pending or fails.
	 */
	function recordUndoStep() {
		const ops = diffBoardDocuments(undoBaseline, document);
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
						: "Failed to sync board";
			}
		});
	}

	function retrySave() {
		saveError = null;
		requestCommit();
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
		const next = applyBoardOps(document, invertBoardOps(ops));
		setItems(next.items);
		undoBaseline = document;
		requestCommit();
	}

	function redo() {
		const ops = redoStack.at(-1);
		if (!ops) return;
		redoStack = redoStack.slice(0, -1);
		undoStack = [...undoStack, ops];
		const next = applyBoardOps(document, ops);
		setItems(next.items);
		undoBaseline = document;
		requestCommit();
	}

	// ─── Camera (local UI state) ────────────────────────────────────
	function setCamera(viewport: BoardViewport) {
		camera = viewport;
	}

	function cancelCameraAnimation() {
		if (cameraAnimation) cancelAnimationFrame(cameraAnimation);
		cameraAnimation = 0;
	}

	function animateCamera(target: BoardViewport) {
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
	/**
	 * After placing a shape, decide whether to leave the creation tool.
	 * Matches tldraw's feel: drawing tools stay hot so you can keep going;
	 * stamp tools (note/geo/frame) also stay unless the user explicitly
	 * switches to Select. Tool-lock is still honoured as a hard stay.
	 * Text is handled separately (enters edit, then may return on commit).
	 */
	function maybeReturnToSelect() {
		if (toolLocked) return;
		// Continuous / stamp tools stay on themselves — never bounce to Select.
		if (
			tool === "draw" ||
			tool === "arrow" ||
			tool === "note" ||
			tool === "geo" ||
			tool === "frame" ||
			tool === "text"
		)
			return;
		tool = "select";
	}

	function addItemAt(item: BoardItem, opts?: { select?: boolean }) {
		setItems([...synced.items, item]);
		// Keep continuous drawing free of a sticky selection chrome; stamp tools
		// still select the new shape so the user can immediately restyle it.
		const shouldSelect = opts?.select ?? (tool !== "draw" && tool !== "arrow");
		selection = shouldSelect ? [item.id] : [];
		commitAction();
		maybeReturnToSelect();
	}

	function addFile(
		path: string,
		at: WorldPoint,
		snapshot?: {
			title?: string;
			mimeType?: string;
			size?: number;
			mtimeMs?: number;
			naturalWidth?: number;
			naturalHeight?: number;
		},
	) {
		const item = createMediaBoardItem(path, at.x, at.y, snapshot);
		if (!item) return false;
		addItemAt(item);
		return true;
	}

	function addText(text: string, at: WorldPoint) {
		addItemAt(createTextBoardItem(text, at.x, at.y));
	}

	function addNote(at: WorldPoint) {
		addItemAt(createNoteBoardItem(at.x, at.y, activeColor));
	}

	function addGeo(at: WorldPoint) {
		addItemAt(createGeoBoardItem(activeGeo, at.x, at.y, activeColor));
	}

	function addFrame(at: WorldPoint) {
		addItemAt(createFrameBoardItem(at.x, at.y, activeColor));
	}

	/**
	 * Finish a note/geo/frame drag-create. A short click places the default-sized
	 * shape; a drag creates a sized box from the press corner.
	 */
	function commitBoxCreate(state: {
		kind: "note" | "geo" | "frame";
		start: WorldPoint;
		current: WorldPoint;
		color: string;
		geo: string;
	}) {
		const dx = state.current.x - state.start.x;
		const dy = state.current.y - state.start.y;
		const dist = Math.hypot(dx, dy);
		const threshold = 6 / Math.max(camera.zoom, 0.0001);
		if (dist <= threshold) {
			if (state.kind === "note") addNote(state.start);
			else if (state.kind === "geo") {
				addItemAt(
					createGeoBoardItem(
						state.geo,
						state.start.x,
						state.start.y,
						state.color,
					),
				);
			} else addFrame(state.start);
			return;
		}
		const x = Math.min(state.start.x, state.current.x);
		const y = Math.min(state.start.y, state.current.y);
		const width = Math.max(24, Math.abs(dx));
		const height = Math.max(24, Math.abs(dy));
		const frame = { x, y, width, height, rotation: 0 };
		if (state.kind === "note") {
			const item = createNoteBoardItem(x, y, state.color);
			if (item.type === "note") item.frame = frame;
			addItemAt(item);
			return;
		}
		if (state.kind === "geo") {
			const item = createGeoBoardItem(state.geo, x, y, state.color);
			if (item.type === "geo") item.frame = frame;
			addItemAt(item);
			return;
		}
		const item = createFrameBoardItem(x, y, state.color);
		if (item.type === "frame") {
			item.frame = {
				...frame,
				width: Math.max(48, width),
				height: Math.max(48, height),
			};
		}
		addItemAt(item);
	}

	/** Commit a finished freehand stroke as a draw item (drops empty strokes). */
	function commitDraw(points: DrawPoint[], color: string, size: number) {
		if (points.length === 0) return;
		addItemAt(createDrawBoardItem(points, color, size));
	}

	/** Commit a finished arrow (drops degenerate zero-length arrows). */
	function commitArrow(
		start: WorldPoint,
		end: WorldPoint,
		color: string,
		startBinding: ArrowEndpoint | null,
		endBinding: ArrowEndpoint | null,
	) {
		if (Math.hypot(end.x - start.x, end.y - start.y) < 2) return;
		addItemAt(
			createArrowBoardItem(
				start,
				end,
				color,
				startBinding ?? undefined,
				endBinding ?? undefined,
			),
		);
	}

	/**
	 * Start an inline text note as a local-only draft (double-click on empty
	 * board). It is not marked dirty, recorded in undo, or synced until the
	 * edit is confirmed non-empty — so an abandoned empty note leaves no trace.
	 */
	function beginTextDraft(at: WorldPoint) {
		const item = createTextBoardItem("", at.x, at.y);
		synced = { ...synced, items: [...synced.items, item] };
		bumpSpatial();
		bumpStructure();
		draftId = item.id;
		selection = [item.id];
		editingId = item.id;
	}

	/** Finish an inline text edit, handling drafts and empty results. */
	function commitTextEdit(id: string, text: string) {
		const isDraft = id === draftId;
		const target = synced.items.find((item) => item.id === id);
		// An emptied *text* item (or an abandoned draft) is removed; a note/geo
		// keeps its shape and simply loses its label.
		const shouldDelete =
			text.trim() === "" && (isDraft || target?.type === "text");
		if (shouldDelete) {
			if (isDraft) {
				// Never synced — drop it without an op.
				synced = {
					...synced,
					items: removeBoardItems(synced.items, new Set([id])),
				};
				bumpSpatial();
				bumpStructure();
			} else {
				deleteItem(id);
			}
		} else {
			updateText(id, text);
		}
		editingId = null;
		draftId = null;
		// Text is the one creation tool that feels "done" after commit — return to
		// Select so the next tap moves things, unless the user locked the tool.
		if (tool === "text" && !toolLocked) tool = "select";
		// Apply any remote refresh deferred for the duration of this edit.
		flushPendingRemote();
	}

	/**
	 * Ids of unlocked arrows bound to any of the given shapes (for cascade
	 * delete). Locked arrows are never auto-deleted — the lock is absolute.
	 */
	function boundArrowIds(ids: Set<string>): Set<string> {
		const arrows = new Set<string>();
		for (const item of synced.items) {
			if (item.type !== "arrow" || isLocked(item)) continue;
			if (
				(item.start.kind === "binding" && ids.has(item.start.target)) ||
				(item.end.kind === "binding" && ids.has(item.end.target))
			)
				arrows.add(item.id);
		}
		return arrows;
	}

	function deleteSelection() {
		const movable = unlockedIds(selection);
		if (movable.length === 0) return;
		const ids = new Set(movable);
		for (const arrowId of boundArrowIds(ids)) ids.add(arrowId);
		setItems(removeBoardItems(synced.items, ids));
		selection = selection.filter((id) => !ids.has(id));
		editingId = null;
		commitAction();
	}

	function deleteItem(id: string) {
		const target = synced.items.find((item) => item.id === id);
		if (!target || isLocked(target)) return;
		const ids = new Set([id]);
		for (const arrowId of boundArrowIds(ids)) ids.add(arrowId);
		setItems(removeBoardItems(synced.items, ids));
		selection = selection.filter((selectedId) => !ids.has(selectedId));
		if (editingId && ids.has(editingId)) editingId = null;
		commitAction();
	}

	function materializeDuplicates(
		sourceIds: string[],
		/** 0 for Alt-drag (drag provides the offset); default displaces the copy. */
		offset?: number,
	): BoardItem[] {
		const sourceSet = new Set(sourceIds);
		const sources = synced.items.filter((item) => sourceSet.has(item.id));
		if (sources.length === 0) return [];

		// Pair each source with its copy so arrow bindings can remapped when the
		// target is also being duplicated (same behaviour as clipboard paste).
		const pairs = sources.map((item) => ({
			source: item,
			copy:
				offset === undefined
					? duplicateBoardItem(item)
					: duplicateBoardItem(item, offset),
		}));
		const idMap = new Map(
			pairs.map(({ source, copy }) => [source.id, copy.id] as const),
		);

		const remapEndpoint = (
			endpoint: BoardArrowItem["start"],
		): BoardArrowItem["start"] => {
			if (endpoint.kind !== "binding") return endpoint;
			const mapped = idMap.get(endpoint.target);
			return mapped ? { ...endpoint, target: mapped } : endpoint;
		};

		const lookup = frameLookup();
		// Bindings remapped onto clones must resolve against the clone frames.
		const cloneFrames = new Map(
			pairs.map(({ copy }) => [copy.id, copy.frame] as const),
		);
		const resolveFrame = (id: string) => cloneFrames.get(id) ?? lookup(id);

		return pairs.map(({ copy }) => {
			if (copy.type !== "arrow") return copy;
			const remapped: BoardArrowItem = {
				...copy,
				start: remapEndpoint(copy.start),
				end: remapEndpoint(copy.end),
			};
			const nextBounds = arrowBoundsFor(remapped, resolveFrame);
			return nextBounds
				? { ...remapped, frame: { ...nextBounds, rotation: 0 } }
				: remapped;
		});
	}

	function duplicateSelection() {
		if (selection.length === 0) return;
		const fixed = materializeDuplicates(selection);
		if (fixed.length === 0) return;
		setItems([...synced.items, ...fixed]);
		selection = fixed.map((copy) => copy.id);
		commitAction();
	}

	function nudgeSelection(dx: number, dy: number, large: boolean) {
		const movable = unlockedIds(selection);
		if (movable.length === 0) return;
		const step = large ? NUDGE_STEP_LARGE : NUDGE_STEP;
		const ids = new Set(movable);
		const frames = new Map<string, BoardFrame>();
		for (const item of synced.items) {
			if (!ids.has(item.id)) continue;
			frames.set(item.id, {
				...item.frame,
				x: item.frame.x + dx * step,
				y: item.frame.y + dy * step,
			});
		}
		setItems(patchItemFrames(synced.items, frames), false, ids);
		refreshBoundArrowFrames(ids);
		commitAction();
	}

	function alignSelection(mode: AlignMode) {
		const movable = unlockedIds(selection);
		if (movable.length < 2) return;
		const frames = framesFor(movable);
		const patches = alignFrames(frames, mode);
		if (patches.size === 0) return;
		setItems(patchItemFrames(synced.items, patches), false, patches.keys());
		refreshBoundArrowFrames(new Set(patches.keys()));
		bumpStructure();
		commitAction();
	}

	function distributeSelection(axis: DistributeAxis) {
		const movable = unlockedIds(selection);
		if (movable.length < 3) return;
		const frames = framesFor(movable);
		const patches = distributeFrames(frames, axis);
		if (patches.size === 0) return;
		setItems(patchItemFrames(synced.items, patches), false, patches.keys());
		refreshBoundArrowFrames(new Set(patches.keys()));
		bumpStructure();
		commitAction();
	}

	function toggleSelectionLock() {
		if (selection.length === 0) return;
		const ids = new Set(selection);
		const shouldLock = selectedItems.some((item) => !item.locked);
		setItems(
			synced.items.map((item) =>
				ids.has(item.id)
					? shouldLock
						? { ...item, locked: true }
						: { ...item, locked: false }
					: item,
			),
		);
		commitAction();
	}

	function copySelection(): BoardClipboardPayload | null {
		if (selection.length === 0) return null;
		const ids = new Set(selection);
		const items = synced.items.filter((item) => ids.has(item.id));
		const payload = encodeClipboard(items);
		if (payload) {
			internalClipboard = payload;
			pasteCount = 0;
		}
		return payload;
	}

	function cutSelection(): BoardClipboardPayload | null {
		const payload = copySelection();
		if (payload) deleteSelection();
		return payload;
	}

	function pasteClipboard(raw?: unknown, at?: WorldPoint) {
		// Always re-validate: external clipboard is untrusted, and even the internal
		// payload goes through parse for a single code path.
		const parsed =
			parseClipboard(raw) ??
			(raw == null ? parseClipboard(internalClipboard) : null);
		if (!parsed) return;
		pasteCount += 1;
		const offset = at
			? { x: at.x, y: at.y }
			: {
					x: parsed.origin.x + defaultPasteOffset(pasteCount).x,
					y: parsed.origin.y + defaultPasteOffset(pasteCount).y,
				};
		const items = materializeClipboard(parsed, offset);
		if (items.length === 0) return;
		// Drop bindings whose targets aren't on the board and aren't in the paste.
		const known = new Set([
			...synced.items.map((item) => item.id),
			...items.map((item) => item.id),
		]);
		const fixed = items.map((item) => {
			if (item.type !== "arrow") return item;
			const start =
				item.start.kind === "binding" && !known.has(item.start.target)
					? ({
							kind: "point",
							x: item.frame.x,
							y: item.frame.y + item.frame.height / 2,
						} as const)
					: item.start;
			const end =
				item.end.kind === "binding" && !known.has(item.end.target)
					? ({
							kind: "point",
							x: item.frame.x + item.frame.width,
							y: item.frame.y + item.frame.height / 2,
						} as const)
					: item.end;
			return { ...item, start, end };
		});
		setItems([...synced.items, ...fixed]);
		selection = fixed.map((item) => item.id);
		commitAction();
	}

	function exportSelectionSvg(): string {
		const ids =
			selection.length > 0
				? new Set(selection)
				: new Set(synced.items.map((item) => item.id));
		const items = synced.items.filter((item) => ids.has(item.id));
		return itemsToSvg(items, frameLookup());
	}

	function setSelectionEmphasis(emphasis: BoardEmphasis) {
		const movable = unlockedIds(selection);
		if (movable.length === 0) return;
		const ids = new Set(movable);
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

	/**
	 * Set the palette color on the selected color-bearing shapes (note, geo, draw,
	 * arrow). Shapes without a color field are left untouched.
	 */
	function setSelectionColor(color: string) {
		const movable = unlockedIds(selection);
		if (movable.length === 0) return;
		const ids = new Set(movable);
		let changed = false;
		const next = synced.items.map((item) => {
			if (!ids.has(item.id) || isLocked(item)) return item;
			if (
				item.type === "text" ||
				item.type === "note" ||
				item.type === "geo" ||
				item.type === "draw" ||
				item.type === "arrow" ||
				item.type === "frame"
			) {
				changed = true;
				return { ...item, color };
			}
			return item;
		});
		if (!changed) return;
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

	function finalizeTextResize(
		gesture: Extract<BoardInteraction, { type: "resizing" }>,
	) {
		const originById = gesture.origin;
		const next = synced.items.map((item) => {
			if (item.type !== "text") return item;
			const origin = originById.get(item.id);
			const current = item.frame;
			if (!origin) return item;
			const scale = current.width / Math.max(0.0001, origin.width);
			const fontSize = clampBoardTextFontSize(item.fontSize * scale);
			const measured = measureBoardText(item.text, fontSize);
			if (gesture.single) {
				return {
					...item,
					fontSize,
					frame: resizeFrameToSize(
						origin,
						gesture.handle,
						measured.width,
						measured.height,
					),
				};
			}
			const center = rectCenter(current);
			return {
				...item,
				fontSize,
				frame: {
					...current,
					x: center.x - measured.width / 2,
					y: center.y - measured.height / 2,
					width: measured.width,
					height: measured.height,
				},
			};
		});
		if (next.some((item, index) => item !== synced.items[index]))
			setItems(next, false, originById.keys());
	}

	function updateText(id: string, text: string) {
		const target = synced.items.find((item) => item.id === id);
		if (
			!target ||
			(target.type !== "text" &&
				target.type !== "note" &&
				target.type !== "geo")
		)
			return;
		if (target.text === text) return;
		setItems(
			synced.items.map((item) => {
				if (item.id !== id) return item;
				if (item.type === "note" || item.type === "geo")
					return { ...item, text };
				if (item.type !== "text") return item;
				const size = measureBoardText(text, item.fontSize);
				return {
					...item,
					text,
					frame: {
						...item.frame,
						width: size.width,
						height: size.height,
					},
				};
			}),
		);
		commitAction();
	}

	// ─── Hit testing (world space) ──────────────────────────────────
	function topItemAt(point: WorldPoint): BoardItem | null {
		// The index yields AABB candidates topmost-first; refine with a shape-aware
		// exact test (rotated boxes, geo outlines, strokes, arrow curves) and take
		// the first match.
		ensureSpatial();
		const lookup = frameLookup();
		for (const id of spatial.idsAtPoint(point)) {
			const item = itemsById.get(id);
			if (!item) continue;
			const hit =
				item.type === "arrow"
					? arrowHitTest(item, lookup, point)
					: shapeHitTest(item, point);
			if (hit) return item;
		}
		return null;
	}

	/** Frame lookup over the current items, for resolving arrow bindings. */
	function frameLookup(): FrameLookup {
		ensureSpatial();
		return (id) => itemsById.get(id)?.frame;
	}

	/** Ids of items whose bounds intersect a world-space rect (viewport culling). */
	function idsInRect(rect: Rect): string[] {
		ensureSpatial();
		return spatial.idsInRect(rect);
	}

	function handleAt(point: WorldPoint): ResizeHandle | null {
		if (!bounds) return null;
		// Locked selection: no resize handles.
		if (selection.length === 1) {
			const item = selectedItems[0];
			if (!item || isLocked(item) || !shapeCapabilities(item).canResize)
				return null;
		}
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
		const rect: BoardFrame = { ...bounds, rotation: 0 };
		for (const handle of CORNER_HANDLES) {
			const position = frameHandlePosition(rect, handle);
			if (Math.hypot(position.x - point.x, position.y - point.y) <= radius)
				return handle;
		}
		return null;
	}

	function rotationHandleHit(point: WorldPoint): boolean {
		if (selection.length === 0 || !bounds) return false;
		if (selectedItems.some(isLocked)) return false;
		if (
			selection.length === 1 &&
			selectedItems[0] &&
			!shapeCapabilities(selectedItems[0]).canRotate
		)
			return false;
		const position = rotationHandlePosition(bounds, camera.zoom);
		const radius = HANDLE_HIT_RADIUS / camera.zoom;
		return Math.hypot(position.x - point.x, position.y - point.y) <= radius;
	}

	/**
	 * Hit-test arrow endpoint handles for a single selected arrow. Returns which
	 * endpoint is under the pointer, or null.
	 */
	function arrowHandleAt(point: WorldPoint): "start" | "end" | "mid" | null {
		if (selection.length !== 1) return null;
		const item = selectedItems[0];
		if (item?.type !== "arrow") return null;
		if (isLocked(item)) return null;
		const lookup = frameLookup();
		const resolved = resolveArrowFor(item, lookup);
		if (!resolved) return null;
		const radius = (HANDLE_HIT_RADIUS + 2) / camera.zoom;
		const distStart = Math.hypot(
			resolved.start.x - point.x,
			resolved.start.y - point.y,
		);
		const distEnd = Math.hypot(
			resolved.end.x - point.x,
			resolved.end.y - point.y,
		);
		const distMid = Math.hypot(
			resolved.control.x - point.x,
			resolved.control.y - point.y,
		);
		// Prefer endpoints over mid when they overlap.
		if (distStart <= radius && distStart <= distEnd && distStart <= distMid)
			return "start";
		if (distEnd <= radius && distEnd <= distMid) return "end";
		if (distMid <= radius) return "mid";
		return null;
	}

	/** Bind-candidate under a point, excluding the arrow being edited. */
	function bindTargetAt(
		point: WorldPoint,
		excludeId?: string,
	): { id: string; frame: BoardFrame } | null {
		const item = topItemAt(point);
		if (!item || item.id === excludeId) return null;
		if (!shapeCapabilities(item).canBind) return null;
		return { id: item.id, frame: item.frame };
	}

	/**
	 * When moving frames, also move unlocked items whose center currently lies
	 * inside a selected frame. Membership is spatial (no parentId).
	 */
	function expandFrameChildren(ids: string[]): string[] {
		const selected = new Set(ids);
		const frames = synced.items.filter(
			(item) =>
				item.type === "frame" && selected.has(item.id) && !isLocked(item),
		);
		if (frames.length === 0) return ids;
		const extra: string[] = [];
		for (const item of synced.items) {
			if (selected.has(item.id) || isLocked(item)) continue;
			if (item.type === "frame") continue;
			const cx = item.frame.x + item.frame.width / 2;
			const cy = item.frame.y + item.frame.height / 2;
			for (const frame of frames) {
				const f = frame.frame;
				if (
					cx >= f.x &&
					cx <= f.x + f.width &&
					cy >= f.y &&
					cy <= f.y + f.height
				) {
					extra.push(item.id);
					break;
				}
			}
		}
		return extra.length ? [...ids, ...extra] : ids;
	}

	function framesFor(ids: string[]): Map<string, BoardFrame> {
		const frames = new Map<string, BoardFrame>();
		for (const item of synced.items) {
			if (ids.includes(item.id)) frames.set(item.id, { ...item.frame });
		}
		return frames;
	}

	/** Origin snapshot of the selected arrow items (geometry lives in endpoints). */
	function arrowsFor(ids: string[]): Map<string, BoardArrowItem> {
		const arrows = new Map<string, BoardArrowItem>();
		for (const item of synced.items) {
			if (item.type === "arrow" && ids.includes(item.id))
				arrows.set(item.id, item);
		}
		return arrows;
	}

	/**
	 * Snap a set of frames being translated against the other items on the board
	 * (and the grid when visible). Returns the corrective delta and the guide
	 * lines to render. Threshold scales with zoom so it feels constant on screen.
	 */
	function computeTranslationSnap(moved: Map<string, BoardFrame>) {
		const movingBounds = selectionBounds([...moved.values()]);
		if (!movingBounds) return { dx: 0, dy: 0, guides: [] as SnapGuide[] };
		const targets: Rect[] = [];
		for (const item of synced.items) {
			if (moved.has(item.id)) continue;
			if (!shapeCapabilities(item).canSnap) continue;
			targets.push(shapeBounds(item));
		}
		const grid = gridSnapSize();
		return computeSnap(movingBounds, targets, {
			threshold: SNAP_THRESHOLD / Math.max(camera.zoom, 0.0001),
			gridSize: grid,
		});
	}

	/** Grid size for snapping only when a visible grid is enabled. */
	function gridSnapSize(): number {
		const grid = document.appearance.grid;
		return grid?.visible === true ? (grid.size ?? 0) : 0;
	}

	/**
	 * Recompute the bounding frames of arrows bound to any of the given shapes.
	 * Arrow endpoints resolve live in the renderer, but the persisted frame (used
	 * for culling and hit testing) must be refreshed when a bound target moves or
	 * resizes, or the arrow would be culled/tested against a stale box.
	 */
	function refreshBoundArrowFrames(changedIds: Set<string>) {
		if (changedIds.size === 0) return;
		const lookup = frameLookup();
		const patches = new Map<string, BoardFrame>();
		for (const item of synced.items) {
			if (item.type !== "arrow") continue;
			const start = item.start;
			const end = item.end;
			const affected =
				(start.kind === "binding" && changedIds.has(start.target)) ||
				(end.kind === "binding" && changedIds.has(end.target));
			if (!affected) continue;
			const nextBounds = arrowBoundsFor(item, lookup);
			if (nextBounds) patches.set(item.id, { ...nextBounds, rotation: 0 });
		}
		if (patches.size > 0)
			setItems(patchItemFrames(synced.items, patches), false, patches.keys());
	}

	/** Patch arrow bend and recompute its frame from live geometry. */
	function applyArrowBend(arrowId: string, bend: number) {
		const lookup = frameLookup();
		setItems(
			synced.items.map((item) => {
				if (item.id !== arrowId || item.type !== "arrow") return item;
				const next: BoardArrowItem = { ...item, bend };
				const nextBounds = arrowBoundsFor(next, lookup);
				return nextBounds
					? { ...next, frame: { ...nextBounds, rotation: 0 } }
					: next;
			}),
			false,
			[arrowId],
		);
	}

	/** Patch one arrow endpoint and recompute its frame from live geometry. */
	function applyArrowEndpoint(
		arrowId: string,
		which: "start" | "end",
		endpoint: ArrowEndpoint,
	) {
		const lookup = frameLookup();
		setItems(
			synced.items.map((item) => {
				if (item.id !== arrowId || item.type !== "arrow") return item;
				const next: BoardArrowItem = {
					...item,
					[which]: endpoint,
				};
				const nextBounds = arrowBoundsFor(next, lookup);
				return nextBounds
					? { ...next, frame: { ...nextBounds, rotation: 0 } }
					: next;
			}),
			false,
			[arrowId],
		);
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

	function pointerDown(event: BoardPointerEvent) {
		cancelCameraAnimation();
		activePointers.set(event.pointerId, event.screen);
		if (activePointers.size === 2) {
			beginPinch();
			return;
		}
		if (activePointers.size > 2) return;

		const additive = event.shiftKey || event.metaKey || event.ctrlKey;
		// Hand tool, temporary Space hand, or middle mouse — pan.
		// (Alt is reserved for drag-duplicate; no longer pans.)
		if (tool === "hand" || spaceHeld || event.button === 1) {
			interaction = {
				type: "panning",
				start: event.screen,
				origin: { ...camera },
			};
			return;
		}

		// Creation tools take over the primary pointer before any of the
		// select-tool handle/hit logic below.
		if (tool === "draw") {
			interaction = {
				type: "drawing",
				points: [{ x: event.world.x, y: event.world.y, p: event.pressure }],
				color: activeColor,
				size: drawSize,
			};
			return;
		}
		if (tool === "arrow") {
			const target = topItemAt(event.world);
			const startBinding =
				target && shapeCapabilities(target).canBind
					? bindEndpointAt(event.world, { id: target.id, frame: target.frame })
					: null;
			interaction = {
				type: "creatingArrow",
				start: event.world,
				current: event.world,
				color: activeColor,
				startBinding,
			};
			return;
		}
		if (tool === "note" || tool === "geo" || tool === "frame") {
			interaction = {
				type: "creatingBox",
				kind: tool,
				start: event.world,
				current: event.world,
				color: activeColor,
				geo: activeGeo,
			};
			return;
		}
		if (tool === "text") {
			beginTextDraft(event.world);
			return;
		}

		// Arrow endpoint handles take priority over box resize/rotate.
		const arrowHandle = arrowHandleAt(event.world);
		if (arrowHandle) {
			const arrow = selectedItems[0];
			if (arrow && arrow.type === "arrow") {
				interaction = {
					type: "draggingArrowHandle",
					arrowId: arrow.id,
					which: arrowHandle,
					origin: arrow,
					moved: false,
				};
				return;
			}
		}

		if (rotationHandleHit(event.world) && bounds) {
			const movable = unlockedIds(selection);
			if (movable.length === 0) return;
			const pivot = rectCenter(bounds);
			interaction = {
				type: "rotating",
				pivot,
				startAngle: angleFromCenter(pivot, event.world),
				origin: framesFor(movable),
				moved: false,
			};
			return;
		}

		const handle = handleAt(event.world);
		if (handle && bounds) {
			const movable = unlockedIds(selection);
			if (movable.length === 0) return;
			interaction = {
				type: "resizing",
				handle,
				single:
					movable.length === 1
						? (() => {
								const frame = framesFor(movable).get(movable[0] ?? "");
								return frame ? { ...frame } : null;
							})()
						: null,
				bounds,
				origin: framesFor(movable),
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
			const movable = unlockedIds(selection);
			// Locked-only selection: allow re-select but not translate.
			if (movable.length === 0) {
				interaction = { type: "idle" };
				return;
			}
			const withChildren = expandFrameChildren(movable);
			interaction = {
				type: "translating",
				start: event.world,
				origin: framesFor(withChildren),
				arrowOrigin: arrowsFor(withChildren),
				moved: false,
				duplicate: event.altKey,
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

	function pointerMove(event: BoardPointerEvent) {
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
			let dx = event.world.x - interaction.start.x;
			let dy = event.world.y - interaction.start.y;
			// Ignore sub-threshold jitter so a plain click never mutates frames
			// (which would otherwise leave the board permanently "Pending").
			if (!interaction.moved) {
				if (Math.hypot(dx, dy) <= DRAG_THRESHOLD / camera.zoom) return;
				// Alt-drag: spawn duplicates once, then translate the copies.
				if (interaction.duplicate) {
					// In-place clones (offset 0); the drag delta provides the visual shift.
					const clones = materializeDuplicates(
						[...interaction.origin.keys()],
						0,
					);
					if (clones.length > 0) {
						setItems([...synced.items, ...clones]);
						selection = clones.map((copy) => copy.id);
						interaction = {
							...interaction,
							origin: framesFor(selection),
							arrowOrigin: arrowsFor(selection),
							duplicate: false,
							moved: true,
						};
					} else {
						interaction.moved = true;
					}
				} else {
					interaction.moved = true;
				}
			}
			// Shift locks movement to the dominant axis.
			if (event.shiftKey) {
				if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
				else dx = 0;
			}
			const lookup = frameLookup();
			const preview = new Map<string, BoardFrame>();
			for (const [id, frame] of interaction.origin) {
				const arrow = interaction.arrowOrigin.get(id);
				preview.set(
					id,
					arrow
						? translateArrow(arrow, dx, dy, lookup).frame
						: { ...frame, x: frame.x + dx, y: frame.y + dy },
				);
			}
			// Ctrl/Meta opts out of snapping (Alt is drag-duplicate).
			let sx = 0;
			let sy = 0;
			if (!event.metaKey && !event.ctrlKey) {
				const snap = computeTranslationSnap(preview);
				sx = snap.dx;
				sy = snap.dy;
				snapGuides = snap.guides;
			} else {
				snapGuides = [];
			}
			const tx = dx + sx;
			const ty = dy + sy;
			const arrowPatches = new Map<string, BoardArrowItem>();
			const frames = new Map<string, BoardFrame>();
			for (const [id, frame] of interaction.origin) {
				const arrow = interaction.arrowOrigin.get(id);
				if (arrow) arrowPatches.set(id, translateArrow(arrow, tx, ty, lookup));
				else frames.set(id, { ...frame, x: frame.x + tx, y: frame.y + ty });
			}
			const dirty = [...interaction.origin.keys()];
			setItems(
				synced.items.map((item) => {
					const patchedArrow = arrowPatches.get(item.id);
					if (patchedArrow) return patchedArrow;
					const frame = frames.get(item.id);
					return frame ? { ...item, frame } : item;
				}),
				false,
				dirty,
			);
			refreshBoundArrowFrames(new Set(dirty));
			return;
		}

		if (interaction.type === "resizing") {
			interaction.moved = true;
			const frames = new Map<string, BoardFrame>();
			if (interaction.single) {
				const id = [...interaction.origin.keys()][0];
				const item = id
					? synced.items.find((candidate) => candidate.id === id)
					: null;
				if (id) {
					const resized = resizeFrame(
						interaction.single,
						interaction.handle,
						event.world,
						undefined,
						item?.type === "text" || event.shiftKey,
					);
					frames.set(id, resized);
				}
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
			setItems(
				synced.items.map((item) => {
					const frame = frames.get(item.id);
					if (!frame) return item;
					return { ...item, frame };
				}),
				false,
				frames.keys(),
			);
			refreshBoundArrowFrames(new Set(interaction.origin.keys()));
			return;
		}

		if (interaction.type === "rotating") {
			interaction.moved = true;
			let delta =
				angleFromCenter(interaction.pivot, event.world) -
				interaction.startAngle;
			// Shift snaps rotation to 15° increments.
			if (event.shiftKey) delta = Math.round(delta / 15) * 15;
			const rotated = rotateFrames(
				[...interaction.origin.values()],
				interaction.pivot,
				delta,
			);
			const frames = new Map<string, BoardFrame>();
			let index = 0;
			for (const id of interaction.origin.keys()) {
				const frame = rotated[index];
				if (frame) frames.set(id, frame);
				index += 1;
			}
			setItems(patchItemFrames(synced.items, frames), false, frames.keys());
			refreshBoundArrowFrames(new Set(interaction.origin.keys()));
			return;
		}

		if (interaction.type === "draggingArrowHandle") {
			interaction.moved = true;
			const arrowId = interaction.arrowId;
			const which = interaction.which;

			// Mid handle bends the quadratic control point.
			if (which === "mid") {
				const origin = interaction.origin;
				const lookup = frameLookup();
				const start = resolveEndpoint(origin.start, lookup);
				const end = resolveEndpoint(origin.end, lookup);
				if (!start || !end) return;
				const dx = end.x - start.x;
				const dy = end.y - start.y;
				const length = Math.hypot(dx, dy) || 1;
				// Signed distance from chord to pointer along the perpendicular.
				const mid = worldPoint((start.x + end.x) / 2, (start.y + end.y) / 2);
				const nx = -dy / length;
				const ny = dx / length;
				const bend =
					((event.world.x - mid.x) * nx + (event.world.y - mid.y) * ny) /
					length;
				const clamped = Math.max(-0.85, Math.min(0.85, bend));
				applyArrowBend(arrowId, clamped);
				snapGuides = [];
				return;
			}

			const target = bindTargetAt(event.world, arrowId);
			const endpoint = bindEndpointAt(event.world, target);
			// Optional snap of free endpoints to nearby shape edges.
			let point = event.world;
			if (endpoint.kind === "point" && !event.metaKey && !event.ctrlKey) {
				const snap = computeSnap(
					{ x: point.x, y: point.y, width: 0, height: 0 },
					synced.items
						.filter(
							(item) => item.id !== arrowId && shapeCapabilities(item).canSnap,
						)
						.map((item) => shapeBounds(item)),
					{
						threshold: SNAP_THRESHOLD / Math.max(camera.zoom, 0.0001),
						gridSize: gridSnapSize(),
					},
				);
				point = worldPoint(point.x + snap.dx, point.y + snap.dy);
				snapGuides = snap.guides;
				if (!target) {
					const snappedTarget = bindTargetAt(point, arrowId);
					const snapped = bindEndpointAt(point, snappedTarget);
					applyArrowEndpoint(arrowId, which, snapped);
					return;
				}
			} else {
				snapGuides = [];
			}
			applyArrowEndpoint(
				arrowId,
				which,
				target ? endpoint : { kind: "point", x: point.x, y: point.y },
			);
			return;
		}

		if (interaction.type === "brushing") {
			interaction = { ...interaction, current: event.world };
			const rect = marquee;
			if (!rect) return;
			ensureSpatial();
			const hits: string[] = [];
			for (const id of spatial.idsInRect(rect)) {
				const item = itemsById.get(id);
				if (item && rectsIntersect(itemBounds(item.frame), rect)) hits.push(id);
			}
			selection = interaction.additive
				? [...new Set([...interaction.baseSelection, ...hits])]
				: hits;
			return;
		}

		if (interaction.type === "drawing") {
			// Append the sample; skip near-duplicate points to keep the path light.
			const last = interaction.points.at(-1);
			if (
				last &&
				Math.hypot(event.world.x - last.x, event.world.y - last.y) <
					0.5 / Math.max(camera.zoom, 0.0001)
			)
				return;
			interaction = {
				...interaction,
				points: [
					...interaction.points,
					{ x: event.world.x, y: event.world.y, p: event.pressure },
				],
			};
			return;
		}

		if (interaction.type === "creatingArrow") {
			interaction = { ...interaction, current: event.world };
			return;
		}

		if (interaction.type === "creatingBox") {
			interaction = { ...interaction, current: event.world };
			return;
		}
	}

	function pointerUp(event: BoardPointerEvent) {
		activePointers.delete(event.pointerId);
		if (activePointers.size < 2) pinch = null;
		if (activePointers.size > 0) return;

		// Snapshot the gesture before clearing it. Deferred remotes must land
		// first so the local commit is recorded as the latest undo step.
		const gesture = interaction;
		snapGuides = [];
		interaction = { type: "idle" };
		flushPendingRemote();

		if (gesture.type === "translating" && gesture.moved) {
			refreshBoundArrowFrames(new Set(selection));
			bumpStructure();
			commitAction();
		} else if (gesture.type === "resizing" && gesture.moved) {
			finalizeTextResize(gesture);
			refreshBoundArrowFrames(new Set(selection));
			bumpStructure();
			commitAction();
		} else if (gesture.type === "rotating" && gesture.moved) {
			normalizeRotations();
			refreshBoundArrowFrames(new Set(selection));
			bumpStructure();
			commitAction();
		} else if (gesture.type === "draggingArrowHandle" && gesture.moved) {
			bumpStructure();
			commitAction();
		} else if (gesture.type === "brushing" && !gesture.additive) {
			// A click on empty space (no real drag) clears the selection.
			const dx = gesture.current.x - gesture.start.x;
			const dy = gesture.current.y - gesture.start.y;
			if (Math.hypot(dx, dy) <= 1 / camera.zoom) selection = [];
		} else if (gesture.type === "drawing") {
			commitDraw(gesture.points, gesture.color, gesture.size);
		} else if (gesture.type === "creatingArrow") {
			const target = topItemAt(gesture.current);
			const endBinding =
				target && shapeCapabilities(target).canBind
					? bindEndpointAt(gesture.current, {
							id: target.id,
							frame: target.frame,
						})
					: null;
			commitArrow(
				gesture.start,
				gesture.current,
				gesture.color,
				gesture.startBinding,
				endBinding,
			);
		} else if (gesture.type === "creatingBox") {
			commitBoxCreate(gesture);
		}
	}

	function normalizeRotations() {
		const ids = new Set(selection);
		const frames = new Map<string, BoardFrame>();
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
			// Trackpad pinch / ctrl-wheel: denser steps so small gestures feel snappy.
			// Clamp the per-event factor so a single huge tick never jumps the camera.
			const factor = Math.exp(-deltaY * 0.0045);
			const clamped = Math.min(1.35, Math.max(1 / 1.35, factor));
			setCamera(zoomAround(camera, point, camera.zoom * clamped));
		} else {
			// Slightly faster pan so two-finger scroll keeps up with zoom.
			setCamera(panBy(camera, -deltaX * 1.15, -deltaY * 1.15));
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
			const title = titleForBoardItem(item).trim();
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
	function loadDocument(next: BoardDocument, key?: string) {
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
	 *   applyBoardOps: for a given node a delete beats a concurrent patch, and
	 *   local changes are applied last (local wins on same-field edits).
	 * - Document switch: adopt the new document as-is and drop the previous
	 *   document's local state (its changes belong to that document, not this one).
	 */
	function applyRemote(
		next: BoardDocument,
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
		bumpSpatial();
		bumpStructure();
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
		// Local history is document-scoped. Same-document remotes rebase content
		// but keep undo/redo; only a document switch drops it.
		if (!sameDocument) {
			undoStack = [];
			redoStack = [];
		}
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
		get snapGuides() {
			return snapGuides;
		},
		get structureVersion() {
			return structureVersion;
		},
		get geometryVersion() {
			return geometryVersion;
		},
		get activeColor() {
			return activeColor;
		},
		get activeGeo() {
			return activeGeo;
		},
		get drawSize() {
			return drawSize;
		},
		get spaceHeld() {
			return spaceHeld;
		},
		get toolLocked() {
			return toolLocked;
		},
		get selectionLocked() {
			return (
				selectedItems.length > 0 && selectedItems.every((item) => item.locked)
			);
		},
		set tool(value: BoardToolId) {
			tool = value;
			// Entering a freehand tool should clear sticky selection chrome
			// so the next stroke isn't fighting handles (tldraw does the same).
			if (value === "draw" || value === "arrow") {
				selection = [];
				editingId = null;
			}
		},
		set editingId(value: string | null) {
			editingId = value;
		},
		set surfaceSize(value: { width: number; height: number }) {
			surfaceSize = value;
		},
		set activeColor(value: string) {
			activeColor = value;
		},
		set activeGeo(value: string) {
			activeGeo = value;
		},
		set drawSize(value: number) {
			drawSize = value;
		},
		set spaceHeld(value: boolean) {
			spaceHeld = value;
		},
		set toolLocked(value: boolean) {
			toolLocked = value;
		},
		zoomIn,
		zoomOut,
		resetZoom,
		fitView,
		zoomAt,
		setCamera,
		viewCenter,
		itemAt: topItemAt,
		idsInRect,
		setSelection,
		clearSelection,
		selectAll,
		addFile,
		addText,
		addNote,
		addGeo,
		addFrame,
		beginTextDraft,
		commitTextEdit,
		deleteSelection,
		deleteItem,
		duplicateSelection,
		nudgeSelection,
		alignSelection,
		distributeSelection,
		toggleSelectionLock,
		copySelection,
		cutSelection,
		pasteClipboard,
		exportSelectionSvg,
		setSelectionEmphasis,
		setSelectionColor,
		bringToFront,
		sendToBack,
		updateText,
		retrySave,
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

export type BoardEditor = ReturnType<typeof createBoardEditor>;
