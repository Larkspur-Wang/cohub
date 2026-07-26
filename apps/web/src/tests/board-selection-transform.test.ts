import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardFrame, BoardItem } from "@neta-art/cohub-board";
import { rotationHandlePosition, worldPoint } from "@neta-art/cohub-board";
import "$lib/board/core/shapes";
import {
	resizeCursorForHandle,
	resolveSelectionTransform,
	selectionTransformControlAt,
} from "$lib/board/core/selection-transform";

const frame: BoardFrame = {
	x: 0,
	y: 0,
	width: 100,
	height: 100,
	rotation: 0,
};
const bounds = { x: 0, y: 0, width: 100, height: 100 };

function text(locked = false): BoardItem {
	return {
		id: "text",
		type: "text",
		text: "Hello",
		color: "neutral",
		fontSize: 24,
		frame,
		locked,
	};
}

function note(): BoardItem {
	return {
		id: "note",
		type: "note",
		text: "Note",
		color: "amber",
		frame,
	};
}

function arrow(): BoardItem {
	return {
		id: "arrow",
		type: "arrow",
		start: { kind: "point", x: 0, y: 0 },
		end: { kind: "point", x: 100, y: 100 },
		bend: 0,
		color: "brand",
		size: 2,
		arrowStart: false,
		arrowEnd: true,
		label: "",
		frame,
	};
}

test("selection transform maps shape capabilities to concise controls", () => {
	const textTransform = resolveSelectionTransform([text()], bounds);
	assert.equal(textTransform?.resizeMode, "uniform");
	assert.equal(textTransform?.canRotate, true);

	const noteTransform = resolveSelectionTransform([note()], bounds);
	assert.equal(noteTransform?.resizeMode, "free");
	assert.equal(noteTransform?.canRotate, true);

	const lockedTransform = resolveSelectionTransform([text(true)], bounds);
	assert.equal(lockedTransform?.resizeMode, "none");
	assert.equal(lockedTransform?.canRotate, false);
});

test("group transforms use the strict capability intersection", () => {
	const scalable = resolveSelectionTransform([text(), note()], bounds);
	assert.equal(scalable?.resizeMode, "uniform");
	assert.equal(scalable?.canRotate, true);

	const withArrow = resolveSelectionTransform([note(), arrow()], bounds);
	assert.equal(withArrow?.resizeMode, "none");
	assert.equal(withArrow?.canRotate, false);
});

test("uniform shapes expose corners but not edge stretching", () => {
	const transform = resolveSelectionTransform([text()], bounds);
	assert.deepEqual(
		selectionTransformControlAt(transform, worldPoint(0, 0), 1, "mouse"),
		{ kind: "resize", handle: "nw" },
	);
	assert.equal(
		selectionTransformControlAt(transform, worldPoint(100, 50), 1, "mouse"),
		null,
	);
});

test("free shapes expose continuous edges and a separate rotation handle", () => {
	const transform = resolveSelectionTransform([note()], bounds);
	assert.deepEqual(
		selectionTransformControlAt(transform, worldPoint(100, 35), 1, "mouse"),
		{ kind: "resize", handle: "e" },
	);
	const rotation = rotationHandlePosition(frame, 1);
	assert.deepEqual(
		selectionTransformControlAt(transform, rotation, 1, "mouse"),
		{ kind: "rotate" },
	);
});

test("resize cursors follow the node's visual axes", () => {
	assert.equal(resizeCursorForHandle("e", 0), "ew-resize");
	assert.equal(resizeCursorForHandle("e", 45), "nwse-resize");
	assert.equal(resizeCursorForHandle("e", 90), "ns-resize");
	assert.equal(resizeCursorForHandle("e", 135), "nesw-resize");
	assert.equal(resizeCursorForHandle("nw", -45), "ew-resize");
});

test("touch controls enlarge hit targets without changing geometry", () => {
	const transform = resolveSelectionTransform([text()], bounds);
	assert.equal(
		selectionTransformControlAt(transform, worldPoint(-14, -14), 1, "mouse"),
		null,
	);
	assert.deepEqual(
		selectionTransformControlAt(transform, worldPoint(-14, -14), 1, "touch"),
		{ kind: "resize", handle: "nw" },
	);
});
