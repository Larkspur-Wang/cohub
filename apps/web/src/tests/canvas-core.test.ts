import assert from "node:assert/strict";
import { test } from "node:test";
import {
	canvasItemToNode,
	canvasNodeToItem,
	createEmptyCovasDocument,
	parseCovasDocument,
	serializeCovasDocument,
} from "../lib/canvas/canvas-document.ts";
import {
	createArrowCanvasItem,
	createDrawCanvasItem,
	createGeoCanvasItem,
	createNoteCanvasItem,
	duplicateCanvasItem,
} from "../lib/canvas/canvas-items.ts";
import {
	CanvasItemSchema,
	CovasDocumentSchema,
	isUnknownItem,
	parseCanvasItemLoose,
	unknownRealType,
} from "../lib/canvas/canvas-schema.ts";
import {
	anchorToWorld,
	arrowBounds,
	bindEndpointAt,
	distanceToArrow,
	resolveArrow,
	translateArrow,
	worldToAnchor,
} from "../lib/canvas/core/bindings.ts";
import {
	buildStrokeOutline,
	computeDrawBounds,
	distanceToStroke,
	simplifyDrawIndices,
} from "../lib/canvas/core/draw-geometry.ts";
import {
	shapeBounds,
	shapeCapabilities,
	shapeHitTest,
} from "../lib/canvas/core/shape-definition.ts";
import { computeSnap } from "../lib/canvas/core/snapping.ts";
import "../lib/canvas/core/shapes.ts";
import { worldPoint } from "../lib/canvas/canvas-geometry.ts";
import type {
	CanvasArrowItem,
	CanvasDrawItem,
	CanvasFrame,
	CanvasGeoItem,
} from "../lib/canvas/canvas-schema.ts";

const frame: CanvasFrame = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };

// ─── Schema: forward-compatible parsing ─────────────────────────────

test("parseCanvasItemLoose validates a known note item", () => {
	const item = parseCanvasItemLoose({
		id: "n1",
		type: "note",
		text: "hi",
		color: "blue",
		frame,
	});
	assert.equal(item.type, "note");
	assert.equal(isUnknownItem(item), false);
});

test("parseCanvasItemLoose preserves an unknown shape type losslessly", () => {
	const raw = {
		id: "x1",
		type: "hologram",
		frame,
		intensity: 0.9,
		nested: { a: 1 },
	};
	const item = parseCanvasItemLoose(raw);
	assert.equal(isUnknownItem(item), true);
	if (isUnknownItem(item)) {
		assert.equal(unknownRealType(item), "hologram");
		assert.equal(item.raw.intensity, 0.9);
		assert.deepEqual(item.raw.nested, { a: 1 });
	}
});

test("a malformed known item degrades to unknown instead of throwing", () => {
	// image without a valid ref should not throw the whole document.
	const item = parseCanvasItemLoose({ id: "r1", type: "image", frame });
	assert.equal(isUnknownItem(item), true);
});

test("CovasDocumentSchema keeps unknown items through a parse round-trip", () => {
	const doc = CovasDocumentSchema.parse({
		kind: "cohub.canvas",
		version: 1,
		viewport: { x: 0, y: 0, zoom: 1 },
		items: [
			{ id: "t1", type: "text", text: "ok", frame },
			{ id: "x1", type: "future-shape", frame, custom: 42 },
		],
	});
	assert.equal(doc.items.length, 2);
	const unknown = doc.items[1];
	assert.equal(isUnknownItem(unknown), true);
	if (isUnknownItem(unknown))
		assert.equal(unknownRealType(unknown), "future-shape");
});

// ─── Node round-trip for new + unknown shapes ───────────────────────

test("note item round-trips through node mapping", () => {
	const item = parseCanvasItemLoose({
		id: "n1",
		type: "note",
		text: "hello",
		color: "green",
		frame,
	});
	const node = canvasItemToNode(item, 0);
	assert.equal(node.type, "note");
	const back = canvasNodeToItem({
		documentId: "d",
		version: 0,
		createdAt: null,
		updatedAt: null,
		deletedAt: null,
		...node,
	});
	assert.equal(back.type, "note");
	if (back.type === "note") {
		assert.equal(back.text, "hello");
		assert.equal(back.color, "green");
	}
});

test("serializing an unknown item merges the current frame/id over raw", () => {
	const unknown = parseCanvasItemLoose({
		id: "x1",
		type: "hologram",
		frame,
		intensity: 0.5,
	});
	const doc = createEmptyCovasDocument();
	// Simulate a move + duplicate-style id change applied to the item (not raw).
	const moved = {
		...unknown,
		id: "x1-copy",
		frame: { x: 500, y: 500, width: 100, height: 100, rotation: 0 },
	} as typeof unknown;
	const withItem = { ...doc, items: [moved] };
	const reparsed = parseCovasDocument(serializeCovasDocument(withItem));
	assert.ok(reparsed.ok);
	if (!reparsed.ok) return;
	const item = reparsed.document.items[0];
	assert.equal(isUnknownItem(item), true);
	if (isUnknownItem(item)) {
		// New id/position survive; the real type and custom field are preserved.
		assert.equal(item.id, "x1-copy");
		assert.equal(item.frame.x, 500);
		assert.equal(unknownRealType(item), "hologram");
		assert.equal(item.raw.intensity, 0.5);
	}
});

test("unknown item round-trips through node mapping without losing fields", () => {
	const item = parseCanvasItemLoose({
		id: "x1",
		type: "hologram",
		frame,
		intensity: 0.7,
	});
	const node = canvasItemToNode(item, 0);
	assert.equal(node.type, "hologram");
	assert.equal((node.data as Record<string, unknown>).intensity, 0.7);
	const back = canvasNodeToItem({
		documentId: "d",
		version: 0,
		createdAt: null,
		updatedAt: null,
		deletedAt: null,
		...node,
	});
	assert.equal(isUnknownItem(back), true);
	if (isUnknownItem(back)) {
		assert.equal(unknownRealType(back), "hologram");
		assert.equal(back.raw.intensity, 0.7);
	}
});

test("unknown locked survives node mapping round-trip", () => {
	const item = parseCanvasItemLoose({
		id: "x1",
		type: "hologram",
		frame,
		intensity: 0.7,
		locked: true,
	});
	assert.equal(item.locked, true);
	const node = canvasItemToNode(item, 0);
	assert.equal((node.data as Record<string, unknown>).locked, true);
	const back = canvasNodeToItem({
		documentId: "d",
		version: 0,
		createdAt: null,
		updatedAt: null,
		deletedAt: null,
		...node,
	});
	assert.equal(isUnknownItem(back), true);
	assert.equal(back.locked, true);
});

// ─── Draw geometry ──────────────────────────────────────────────────

test("computeDrawBounds pads by stroke width", () => {
	const bounds = computeDrawBounds(
		[
			{ x: 0, y: 0, p: 0.5 },
			{ x: 10, y: 0, p: 0.5 },
		],
		4,
	);
	assert.ok(bounds.x < 0);
	assert.ok(bounds.width > 10);
});

test("simplifyDrawIndices keeps endpoints and removes collinear points", () => {
	const points = [
		{ x: 0, y: 0, p: 0.5 },
		{ x: 5, y: 0, p: 0.5 },
		{ x: 10, y: 0, p: 0.5 },
		{ x: 10, y: 10, p: 0.5 },
	];
	const indices = simplifyDrawIndices(points, 0.1);
	assert.equal(indices[0], 0);
	assert.equal(indices[indices.length - 1], 3);
	assert.ok(indices.length < points.length);
});

test("buildStrokeOutline produces a closed ribbon", () => {
	const outline = buildStrokeOutline(
		[
			{ x: 0, y: 0, p: 0.5 },
			{ x: 10, y: 0, p: 0.5 },
		],
		4,
	);
	assert.ok(outline.length >= 4);
});

test("distanceToStroke is small near the line and large far away", () => {
	const points = [
		{ x: 0, y: 0, p: 0.5 },
		{ x: 10, y: 0, p: 0.5 },
	];
	assert.ok(distanceToStroke(points, worldPoint(5, 0.5)) < 1);
	assert.ok(distanceToStroke(points, worldPoint(5, 50)) > 40);
});

// ─── Arrow bindings ─────────────────────────────────────────────────

test("anchorToWorld and worldToAnchor are inverse on an unrotated frame", () => {
	const f: CanvasFrame = {
		x: 100,
		y: 100,
		width: 200,
		height: 100,
		rotation: 0,
	};
	const world = anchorToWorld(f, 0.25, 0.5);
	assert.equal(world.x, 150);
	assert.equal(world.y, 150);
	const anchor = worldToAnchor(f, world);
	assert.ok(Math.abs(anchor.nx - 0.25) < 1e-9);
	assert.ok(Math.abs(anchor.ny - 0.5) < 1e-9);
});

test("anchorToWorld respects frame rotation", () => {
	const f: CanvasFrame = { x: 0, y: 0, width: 100, height: 100, rotation: 90 };
	// Anchor at right-center (1, 0.5) rotates to bottom-center.
	const world = anchorToWorld(f, 1, 0.5);
	assert.ok(Math.abs(world.x - 50) < 1e-6);
	assert.ok(Math.abs(world.y - 100) < 1e-6);
});

test("resolveArrow computes a straight control point when bend is 0", () => {
	const arrow: CanvasArrowItem = {
		id: "a1",
		type: "arrow",
		frame,
		start: { kind: "point", x: 0, y: 0 },
		end: { kind: "point", x: 100, y: 0 },
		bend: 0,
		color: "brand",
		size: 3,
		arrowStart: false,
		arrowEnd: true,
		label: "",
	};
	const resolved = resolveArrow(arrow, () => undefined);
	assert.ok(resolved);
	assert.equal(resolved?.control.x, 50);
	assert.equal(resolved?.control.y, 0);
});

test("a bound arrow tracks its target when the target moves", () => {
	const targetFrame: CanvasFrame = {
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		rotation: 0,
	};
	const arrow: CanvasArrowItem = {
		id: "a1",
		type: "arrow",
		frame,
		start: { kind: "binding", target: "box", nx: 1, ny: 0.5, precise: true },
		end: { kind: "point", x: 300, y: 50 },
		bend: 0,
		color: "brand",
		size: 3,
		arrowStart: false,
		arrowEnd: true,
		label: "",
	};
	const before = resolveArrow(arrow, (id) =>
		id === "box" ? targetFrame : undefined,
	);
	assert.equal(before?.start.x, 100);
	// Move the target +200 in x; the bound endpoint follows.
	const moved = { ...targetFrame, x: 200 };
	const after = resolveArrow(arrow, (id) => (id === "box" ? moved : undefined));
	assert.equal(after?.start.x, 300);
});

test("arrowBounds returns a finite box (regression: maxY init)", () => {
	const arrow: CanvasArrowItem = {
		id: "a1",
		type: "arrow",
		frame,
		start: { kind: "point", x: 0, y: 0 },
		end: { kind: "point", x: 100, y: 40 },
		bend: 0,
		color: "brand",
		size: 3,
		arrowStart: false,
		arrowEnd: true,
		label: "",
	};
	const bounds = arrowBounds(arrow, () => undefined);
	assert.ok(bounds);
	assert.ok(Number.isFinite(bounds?.width));
	assert.ok(Number.isFinite(bounds?.height));
	assert.ok(bounds?.height >= 40);
});

test("distanceToArrow is small near the line", () => {
	const arrow: CanvasArrowItem = {
		id: "a1",
		type: "arrow",
		frame,
		start: { kind: "point", x: 0, y: 0 },
		end: { kind: "point", x: 100, y: 0 },
		bend: 0,
		color: "brand",
		size: 3,
		arrowStart: false,
		arrowEnd: true,
		label: "",
	};
	assert.ok(distanceToArrow(arrow, () => undefined, worldPoint(50, 2)) < 5);
	assert.ok(distanceToArrow(arrow, () => undefined, worldPoint(50, 80)) > 50);
});

test("bindEndpointAt binds when a target is present, else stays free", () => {
	const bound = bindEndpointAt(worldPoint(50, 50), {
		id: "box",
		frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
	});
	assert.equal(bound.kind, "binding");
	const free = bindEndpointAt(worldPoint(50, 50), null);
	assert.equal(free.kind, "point");
});

// ─── Snapping ───────────────────────────────────────────────────────

test("computeSnap snaps a near-aligned edge and emits a guide", () => {
	const moving = { x: 102, y: 0, width: 50, height: 50 };
	const target = { x: 0, y: 0, width: 100, height: 50 };
	const result = computeSnap(moving, [target], { threshold: 8 });
	// moving.x (102) snaps to target right edge (100): dx = -2.
	assert.equal(result.dx, -2);
	assert.equal(
		result.guides.some((g) => g.axis === "x" && g.at === 100),
		true,
	);
});

test("computeSnap returns zero delta beyond the threshold", () => {
	const moving = { x: 200, y: 0, width: 50, height: 50 };
	const target = { x: 0, y: 0, width: 100, height: 50 };
	const result = computeSnap(moving, [target], { threshold: 8 });
	assert.equal(result.dx, 0);
	assert.equal(result.dy, 0);
});

test("computeSnap snaps to grid when enabled", () => {
	const moving = { x: 33, y: 0, width: 10, height: 10 };
	const result = computeSnap(moving, [], { threshold: 8, gridSize: 32 });
	// 33 rounds to 32.
	assert.equal(result.dx, -1);
});

// ─── Shape definitions ──────────────────────────────────────────────

test("geo ellipse hit test rejects corners", () => {
	const geo: CanvasGeoItem = {
		id: "g1",
		type: "geo",
		geo: "ellipse",
		text: "",
		color: "brand",
		fillOpacity: 0.12,
		frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
	};
	// Center hits, corner (outside the ellipse) misses.
	assert.equal(shapeHitTest(geo, worldPoint(50, 50)), true);
	assert.equal(shapeHitTest(geo, worldPoint(2, 2)), false);
});

test("draw hit test is true near the stroke and false far away", () => {
	const draw: CanvasDrawItem = {
		id: "d1",
		type: "draw",
		points: [
			{ x: 0, y: 0, p: 0.5 },
			{ x: 100, y: 0, p: 0.5 },
		],
		color: "brand",
		size: 4,
		frame: { x: 0, y: 0, width: 100, height: 4, rotation: 0 },
	};
	assert.equal(shapeHitTest(draw, worldPoint(50, 2)), true);
	assert.equal(shapeHitTest(draw, worldPoint(50, 60)), false);
});

test("text and note are editable; draw is not resizable", () => {
	assert.equal(
		shapeCapabilities({ id: "t", type: "text", text: "", frame } as never)
			.canEdit,
		true,
	);
	const draw: CanvasDrawItem = {
		id: "d",
		type: "draw",
		points: [],
		color: "brand",
		size: 4,
		frame,
	};
	assert.equal(shapeCapabilities(draw).canResize, false);
});

test("shapeBounds falls back to frame bounds for box shapes", () => {
	const bounds = shapeBounds({
		id: "t",
		type: "text",
		text: "",
		frame,
	} as never);
	assert.equal(bounds.width, 100);
});

// Helper re-export guard: ensure the empty document constructor works.
test("createEmptyCovasDocument yields an empty document", () => {
	const doc = createEmptyCovasDocument();
	assert.equal(doc.items.length, 0);
});

// ─── Item creation helpers ───────────────────────────────────────

test("createNoteCanvasItem defaults to amber and centers on the point", () => {
	const item = createNoteCanvasItem(10, 20);
	assert.equal(item.type, "note");
	if (item.type === "note") {
		assert.equal(item.color, "amber");
		// Frame is centered on the creation point.
		assert.ok(item.frame.x < 10);
		assert.ok(item.frame.y < 20);
	}
});

test("createGeoCanvasItem carries the chosen geometry", () => {
	const item = createGeoCanvasItem("ellipse", 0, 0, "blue");
	assert.equal(item.type, "geo");
	if (item.type === "geo") {
		assert.equal(item.geo, "ellipse");
		assert.equal(item.color, "blue");
	}
});

test("createDrawCanvasItem stores points relative to the bounds frame", () => {
	const world = [
		{ x: 100, y: 100, p: 0.5 },
		{ x: 150, y: 120, p: 0.5 },
	];
	const item = createDrawCanvasItem(world, "brand", 4);
	assert.equal(item.type, "draw");
	if (item.type === "draw") {
		// Frame origin is near the first point (minus stroke padding); local
		// points are small offsets from it.
		assert.ok(item.frame.x < 100);
		assert.ok(item.points[0].x < 10);
		assert.ok(item.points[0].y < 10);
	}
});

test("createArrowCanvasItem builds a frame spanning both endpoints", () => {
	const item = createArrowCanvasItem(
		{ x: 0, y: 0 },
		{ x: 100, y: 50 },
		"brand",
	);
	assert.equal(item.type, "arrow");
	if (item.type === "arrow") {
		assert.equal(item.start.kind, "point");
		assert.equal(item.end.kind, "point");
		assert.ok(item.frame.width >= 100);
		assert.ok(item.frame.height >= 50);
		assert.equal(item.arrowEnd, true);
		assert.equal(item.size, 2.5);
	}
});

test("createArrowCanvasItem honours provided bindings", () => {
	const binding = {
		kind: "binding" as const,
		target: "box",
		nx: 0.5,
		ny: 0.5,
		precise: true,
	};
	const item = createArrowCanvasItem(
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		"brand",
		binding,
	);
	if (item.type === "arrow") assert.equal(item.start.kind, "binding");
});

test("translateArrow moves free endpoints but keeps bindings anchored", () => {
	const arrow: CanvasArrowItem = {
		id: "a1",
		type: "arrow",
		frame,
		start: { kind: "point", x: 0, y: 0 },
		end: { kind: "binding", target: "box", nx: 0.5, ny: 0.5, precise: true },
		bend: 0,
		color: "brand",
		size: 3,
		arrowStart: false,
		arrowEnd: true,
		label: "",
	};
	const moved = translateArrow(arrow, 100, 50, () => undefined);
	// Free start moved by the delta…
	assert.equal(moved.start.kind, "point");
	if (moved.start.kind === "point") {
		assert.equal(moved.start.x, 100);
		assert.equal(moved.start.y, 50);
	}
	// …bound end is unchanged (still anchored to its target).
	assert.equal(moved.end.kind, "binding");
	if (moved.end.kind === "binding") assert.equal(moved.end.target, "box");
});

test("duplicating an arrow offsets its free endpoints (no overlap)", () => {
	const arrow = createArrowCanvasItem(
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		"brand",
	);
	const copy = duplicateCanvasItem(arrow);
	assert.notEqual(copy.id, arrow.id);
	if (copy.type === "arrow" && arrow.type === "arrow") {
		assert.ok(copy.start.kind === "point" && arrow.start.kind === "point");
		if (copy.start.kind === "point" && arrow.start.kind === "point")
			assert.ok(copy.start.x > arrow.start.x);
	}
});

export { CanvasItemSchema };
