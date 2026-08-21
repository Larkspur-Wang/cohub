import assert from "node:assert/strict";
import { test } from "node:test";
import {
	applyBoardSemanticCommands,
	type BoardDocument,
	boardDocumentToSemanticCommands,
} from "@neta-art/cohub/board";
import {
	createEmptyBoardDocument,
	parseBoardDocument,
	reconcileExternal,
	serializeBoardDocument,
} from "../lib/board/board-document.ts";

function text(id: string, value: string, x = 0) {
	return {
		id,
		type: "text" as const,
		text: value,
		color: "neutral",
		fontSize: 24,
		frame: { x, y: 0, width: 120, height: 40, rotation: 0 },
	};
}

function doc(items = [text("a", "A")]): BoardDocument {
	return { ...createEmptyBoardDocument(), items };
}

test("semantic document commands round-trip create, patch, reorder and delete", () => {
	const before = doc([text("a", "A"), text("b", "B", 200)]);
	const after = doc([text("b", "Updated", 220), text("c", "C", 400)]);
	const commands = boardDocumentToSemanticCommands(before, after);
	assert.ok(commands.some((command) => command.type === "item.patch"));
	assert.ok(commands.some((command) => command.type === "item.create"));
	assert.ok(commands.some((command) => command.type === "item.delete"));
	assert.deepEqual(
		applyBoardSemanticCommands(before, commands).items,
		after.items,
	);
});

test("reconcile rebases local semantic changes onto a remote snapshot", () => {
	const baseline = doc([text("a", "A")]);
	const local = doc([text("a", "Local")]);
	const remote = doc([text("a", "A"), text("b", "Remote", 200)]);
	const result = reconcileExternal(baseline, local, remote, true);
	assert.equal(result.hadLocalChanges, true);
	assert.deepEqual(
		result.merged.items.map((item) => item.id),
		["a", "b"],
	);
	assert.equal(
		result.merged.items[0]?.type === "text" && result.merged.items[0].text,
		"Local",
	);
});

test("document switches do not leak local edits", () => {
	const baseline = doc([text("a", "A")]);
	const local = doc([text("a", "Local")]);
	const remote = doc([text("z", "Other")]);
	assert.deepEqual(reconcileExternal(baseline, local, remote, false), {
		merged: remote,
		hadLocalChanges: false,
	});
});

test("document serialization preserves unknown extension items", () => {
	const content = JSON.stringify({
		...createEmptyBoardDocument(),
		items: [
			{
				id: "x",
				type: "extension.diagram.node",
				kindVersion: 1,
				frame: { x: 0, y: 0, width: 80, height: 80, rotation: 0 },
				props: { future: true },
			},
		],
	});
	const parsed = parseBoardDocument(content);
	assert.equal(parsed.ok, true);
	if (!parsed.ok) return;
	const roundTrip = parseBoardDocument(serializeBoardDocument(parsed.document));
	assert.equal(roundTrip.ok, true);
});
