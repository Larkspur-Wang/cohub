import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	BoardConnection,
	BoardDocument,
	BoardItem,
} from "@neta-art/cohub/board";
import { createBoardConnection } from "@neta-art/cohub/board";
import {
	applyBoardOps,
	diffBoardDocuments,
	invertBoardOps,
	parseBoardDocument,
	rebaseOnRemote,
	reconcileExternal,
	serializeBoardDocument,
} from "../lib/board/board-document.ts";

function doc(
	items: BoardItem[],
	connections: BoardConnection[] = [],
): BoardDocument {
	return {
		kind: "cohub.board",
		version: 1,
		appearance: {
			theme: "clean",
			background: { kind: "grid" },
			grid: { visible: true, size: 32, opacity: 0.22 },
			mood: "clean",
		},
		viewport: { x: 0, y: 0, zoom: 1 },
		items,
		connections,
	};
}

const conn = (patch: Partial<BoardConnection> = {}): BoardConnection => ({
	...createBoardConnection({ id: "c1", sourceNodeId: "a", targetNodeId: "b" }),
	...patch,
});

/** Two nodes, so a relation between them is always legal. */
const pair = () => [textItem("a", "a"), textItem("b", "b", 400)];

function textItem(id: string, text: string, x = 0): BoardItem {
	return {
		id,
		type: "text",
		text,
		color: "neutral",
		fontSize: 18,
		frame: { x, y: 0, width: 100, height: 100, rotation: 0 },
	};
}

const texts = (d: BoardDocument) =>
	new Map(
		d.items.map((item) => [item.id, item.type === "text" ? item.text : ""]),
	);

test("diff marks interactive deletes with a structured reason", () => {
	const [op] = diffBoardDocuments(doc([textItem("a", "delete")]), doc([]));
	assert.equal(op?.type, "node.delete");
	if (op?.type === "node.delete")
		assert.equal(op.payload.reason, "user-delete");
});

test("appearance diffs use a metadata merge patch", () => {
	const before = doc([]);
	const after = {
		...before,
		appearance: {
			...before.appearance,
			background: {
				kind: "image" as const,
				imageUrl: "https://cdn.example/background.png",
				fit: "cover" as const,
				opacity: 0.8,
			},
		},
	};
	const ops = diffBoardDocuments(before, after);
	assert.deepEqual(ops, [
		{
			type: "board.patch",
			payload: { patch: { metadataPatch: { appearance: after.appearance } } },
			inverse: { patch: { metadataPatch: { appearance: before.appearance } } },
		},
	]);
	assert.deepEqual(
		applyBoardOps(after, invertBoardOps(ops)).appearance,
		before.appearance,
	);
});

test("document patches preserve items and sync appearance", () => {
	const document = doc([textItem("a", "keep")]);
	const appearance = {
		theme: "clean",
		background: { kind: "solid" as const, color: "#123456" },
		grid: { visible: false, size: 24, opacity: 0.12 },
		mood: "natural" as const,
	};
	const result = applyBoardOps(document, [
		{
			type: "board.patch",
			payload: { patch: { metadata: { appearance } } },
		},
	]);
	assert.deepEqual(result.items, document.items);
	assert.deepEqual(result.appearance, appearance);
});

test("document patch inverse restores the previous meta", () => {
	const [inverse] = invertBoardOps([
		{
			type: "board.patch",
			payload: { patch: { metadata: { modelKind: "next" } } },
			inverse: { patch: { metadata: { modelKind: "previous" } } },
		},
	]);
	assert.deepEqual(inverse, {
		type: "board.patch",
		payload: { patch: { metadata: { modelKind: "previous" } } },
		inverse: { patch: { metadata: { modelKind: "next" } } },
	});
});

test("rebase with no local changes adopts the remote document", () => {
	const baseline = doc([textItem("a", "1")]);
	const remote = doc([textItem("a", "1"), textItem("b", "2")]);
	const { merged, hadLocalChanges } = rebaseOnRemote(
		baseline,
		baseline,
		remote,
	);
	assert.equal(hadLocalChanges, false);
	assert.deepEqual([...texts(merged).keys()], ["a", "b"]);
});

test("rebase preserves a local create alongside a remote create", () => {
	const baseline = doc([textItem("a", "1")]);
	const local = doc([textItem("a", "1"), textItem("local", "L")]);
	const remote = doc([textItem("a", "1"), textItem("remote", "R")]);
	const { merged, hadLocalChanges } = rebaseOnRemote(baseline, local, remote);
	assert.equal(hadLocalChanges, true);
	const map = texts(merged);
	assert.equal(map.get("remote"), "R");
	assert.equal(map.get("local"), "L");
});

test("rebase keeps a local patch on a node the remote also patched (local wins)", () => {
	const baseline = doc([textItem("a", "base")]);
	const local = doc([textItem("a", "local-edit")]);
	const remote = doc([textItem("a", "remote-edit")]);
	const { merged } = rebaseOnRemote(baseline, local, remote);
	// Local changes are applied last, so the local edit wins the same-field race.
	assert.equal(texts(merged).get("a"), "local-edit");
});

test("rebase honours a local delete over a remote patch", () => {
	const baseline = doc([textItem("a", "base"), textItem("b", "keep")]);
	const local = doc([textItem("b", "keep")]); // deleted "a"
	const remote = doc([textItem("a", "remote-edit"), textItem("b", "keep")]);
	const { merged } = rebaseOnRemote(baseline, local, remote);
	assert.equal(texts(merged).has("a"), false);
	assert.equal(texts(merged).get("b"), "keep");
});

test("rebase drops a local patch on a node the remote deleted", () => {
	const baseline = doc([textItem("a", "base"), textItem("b", "keep")]);
	const local = doc([textItem("a", "local-edit"), textItem("b", "keep")]);
	const remote = doc([textItem("b", "keep")]); // deleted "a"
	const { merged } = rebaseOnRemote(baseline, local, remote);
	// Remote delete wins: the local patch has no node to apply to.
	assert.equal(texts(merged).has("a"), false);
	assert.equal(texts(merged).get("b"), "keep");
});

test("rebase preserves unrelated local position changes", () => {
	const baseline = doc([textItem("a", "1", 0)]);
	const local = doc([textItem("a", "1", 250)]); // moved
	const remote = doc([textItem("a", "1", 0), textItem("b", "2")]);
	const { merged } = rebaseOnRemote(baseline, local, remote);
	const a = merged.items.find((item) => item.id === "a");
	assert.equal(a?.frame.x, 250);
	assert.equal(texts(merged).has("b"), true);
});

test("reconcileExternal rebases on a same-document refresh", () => {
	const baseline = doc([textItem("a", "1")]);
	const local = doc([textItem("a", "1"), textItem("local", "L")]);
	const remote = doc([textItem("a", "1"), textItem("remote", "R")]);
	const { merged, hadLocalChanges } = reconcileExternal(
		baseline,
		local,
		remote,
		true,
	);
	assert.equal(hadLocalChanges, true);
	assert.equal(texts(merged).get("local"), "L");
	assert.equal(texts(merged).get("remote"), "R");
});

test("reconcileExternal on a document switch drops the old document's local changes", () => {
	// Document A: baseline has node "a"; the user created an uncommitted "draft".
	const baselineA = doc([textItem("a", "1")]);
	const localA = doc([textItem("a", "1"), textItem("draft", "unsaved")]);
	// Document B: a completely different document.
	const documentB = doc([textItem("b", "2")]);
	const { merged, hadLocalChanges } = reconcileExternal(
		baselineA,
		localA,
		documentB,
		false, // switching documents, not a same-document refresh
	);
	// A's uncommitted "draft" must NOT leak into B.
	assert.equal(hadLocalChanges, false);
	assert.equal(texts(merged).has("draft"), false);
	assert.equal(texts(merged).has("a"), false);
	assert.deepEqual([...texts(merged).keys()], ["b"]);
});

/**
 * Connections are pure references with no geometry, so these focus on the one
 * thing that can silently break: whether a relation edit actually becomes an
 * operation. A change that never reaches the diff would look correct on screen
 * and be lost on reload.
 */

test("creating a relation emits connection.create after the node ops", () => {
	const before = doc(pair());
	const after = doc(pair(), [conn()]);
	const ops = diffBoardDocuments(before, after);
	assert.equal(ops.length, 1);
	assert.equal(ops[0]?.type, "connection.create");
});

test("a new relation is ordered after the nodes it names", () => {
	// The server validates in operation order, so a relation must never precede
	// the creation of its endpoints.
	const ops = diffBoardDocuments(doc([]), doc(pair(), [conn()]));
	const types = ops.map((op) => op.type);
	assert.deepEqual(types, ["node.create", "node.create", "connection.create"]);
});

test("deleting a connected node removes the relation first", () => {
	// Mirror of the rule above: the server rejects a node.delete while a relation
	// still names that node, so the connection.delete has to come first. Emitting
	// them in the other order made every delete of a connected node fail.
	const types = diffBoardDocuments(
		doc(pair(), [conn()]),
		doc([textItem("b", "b", 400)]),
	).map((op) => op.type);
	// Order is what matters, not the exact op list: removing a node can also re-key
	// its surviving siblings, which is unrelated to the referential rule.
	assert.ok(
		types.indexOf("connection.delete") < types.indexOf("node.delete"),
		`connection.delete must precede node.delete, got ${types.join(" -> ")}`,
	);
});

test("deleting a node and all its relations stays a single ordered edit", () => {
	const many = [
		conn({ id: "c1" }),
		conn({ id: "c2", target: { nodeId: "c", anchor: { kind: "auto" } } }),
	];
	const before = doc([...pair(), textItem("c", "c", 800)], many);
	const after = doc([textItem("b", "b", 400), textItem("c", "c", 800)]);
	const types = diffBoardDocuments(before, after).map((op) => op.type);
	// Both relations must be gone before the node they share is removed.
	const lastConnectionDelete = types.lastIndexOf("connection.delete");
	assert.equal(types.filter((t) => t === "connection.delete").length, 2);
	assert.ok(
		lastConnectionDelete < types.indexOf("node.delete"),
		`all connection deletes must precede node.delete, got ${types.join(" -> ")}`,
	);
});

test("changing direction emits a connection.patch carrying just that field", () => {
	const before = doc(pair(), [conn({ direction: "forward" })]);
	const after = doc(pair(), [conn({ direction: "none" })]);
	const ops = diffBoardDocuments(before, after);
	assert.equal(ops.length, 1);
	const op = ops[0];
	assert.equal(op?.type, "connection.patch");
	if (op?.type === "connection.patch") {
		assert.equal(op.payload.connectionId, "c1");
		assert.deepEqual(op.payload.patch, { direction: "none" });
	}
});

test("an untouched relation produces no operation", () => {
	const shared = conn();
	const ops = diffBoardDocuments(doc(pair(), [shared]), doc(pair(), [shared]));
	assert.deepEqual(ops, []);
});

test("deleting a relation emits connection.delete with a restorable inverse", () => {
	const original = conn({ label: "depends on" });
	const ops = diffBoardDocuments(doc(pair(), [original]), doc(pair()));
	assert.equal(ops.length, 1);
	const op = ops[0];
	assert.equal(op?.type, "connection.delete");
	// Undo must restore the whole relation, so the inverse carries the record.
	assert.deepEqual(op?.inverse?.connection, original);
});

test("applyBoardOps round-trips a direction change", () => {
	const before = doc(pair(), [conn({ direction: "forward" })]);
	const after = doc(pair(), [conn({ direction: "both" })]);
	const applied = applyBoardOps(before, diffBoardDocuments(before, after));
	assert.equal(applied.connections[0]?.direction, "both");
});

test("undoing a direction change restores the previous direction", () => {
	const before = doc(pair(), [conn({ direction: "forward" })]);
	const after = doc(pair(), [conn({ direction: "none" })]);
	const ops = diffBoardDocuments(before, after);
	const undone = applyBoardOps(after, invertBoardOps(ops));
	assert.equal(undone.connections[0]?.direction, "forward");
});

test("undoing a relation delete brings the relation back intact", () => {
	const original = conn({ label: "blocks", direction: "backward" });
	const before = doc(pair(), [original]);
	const ops = diffBoardDocuments(before, doc(pair()));
	const undone = applyBoardOps(doc(pair()), invertBoardOps(ops));
	assert.deepEqual(undone.connections, [original]);
});

test("a relation whose node is gone is dropped rather than kept dangling", () => {
	// Concurrent edits can produce this: the relation is local, the node deletion
	// is remote. The merged document must stay internally valid.
	const merged = applyBoardOps(doc([textItem("a", "a")], [conn()]), []);
	assert.deepEqual(merged.connections, []);
});

test("rebase keeps a local relation across a remote node edit", () => {
	const baseline = doc(pair());
	const local = doc(pair(), [conn()]);
	const remote = doc([textItem("a", "edited"), textItem("b", "b", 400)]);
	const { merged, hadLocalChanges } = rebaseOnRemote(baseline, local, remote);
	assert.equal(hadLocalChanges, true);
	assert.equal(merged.connections.length, 1);
	// The remote node edit survives too.
	assert.equal(texts(merged).get("a"), "edited");
});

test("rebase drops a local relation whose endpoint the remote deleted", () => {
	const baseline = doc(pair());
	const local = doc(pair(), [conn()]);
	const remote = doc([textItem("a", "a")]);
	const { merged } = rebaseOnRemote(baseline, local, remote);
	assert.deepEqual(merged.connections, []);
});

test("serialization round-trips relations", () => {
	// A manifest that drops connections would erase the graph on every save/load,
	// with no error to notice it by.
	const original = doc(pair(), [conn({ label: "depends on" })]);
	const result = parseBoardDocument(serializeBoardDocument(original));
	assert.ok(result.ok, "expected the manifest to parse");
	if (!result.ok) return;
	const { connections } = result.document;
	assert.equal(connections.length, 1);
	assert.equal(connections[0]?.label, "depends on");
	assert.equal(connections[0]?.source.nodeId, "a");
	assert.equal(connections[0]?.target.nodeId, "b");
});

test("serialized output carries a connections field even when empty", () => {
	const wire = JSON.parse(serializeBoardDocument(doc(pair())));
	assert.deepEqual(wire.connections, []);
});

/**
 * Undo/redo replays operations through applyBoardOps and writes the result back.
 * These cover the whole cycle for a step that spans both halves of the document,
 * which is what deleting a connected node produces.
 */

test("undo of a connected-node delete restores the node and the relation together", () => {
	const original = conn({ label: "blocks" });
	const before = doc(pair(), [original]);
	// What the editor does: drop the node and every relation touching it.
	const after = doc([textItem("b", "b", 400)]);
	const ops = diffBoardDocuments(before, after);

	const undone = applyBoardOps(after, invertBoardOps(ops));
	assert.deepEqual(
		undone.items.map((item) => item.id).sort(),
		["a", "b"],
		"both nodes should come back",
	);
	assert.deepEqual(
		undone.connections,
		[original],
		"the relation must come back in the same step, not be lost",
	);
});

test("redo of a connected-node delete removes both halves again", () => {
	const before = doc(pair(), [conn()]);
	const after = doc([textItem("b", "b", 400)]);
	const ops = diffBoardDocuments(before, after);
	const undone = applyBoardOps(after, invertBoardOps(ops));
	const redone = applyBoardOps(undone, ops);
	assert.deepEqual(
		redone.items.map((item) => item.id),
		["b"],
	);
	assert.deepEqual(redone.connections, []);
});

test("undo/redo of a relation-only delete leaves the nodes untouched", () => {
	// Deleting an edge must not disturb the nodes it happened to join.
	const original = conn();
	const before = doc(pair(), [original]);
	const after = doc(pair());
	const ops = diffBoardDocuments(before, after);

	const undone = applyBoardOps(after, invertBoardOps(ops));
	assert.equal(undone.items.length, 2);
	assert.deepEqual(undone.connections, [original]);

	const redone = applyBoardOps(undone, ops);
	assert.equal(redone.items.length, 2);
	assert.deepEqual(redone.connections, []);
});

test("a relation created then undone does not linger", () => {
	const before = doc(pair());
	const after = doc(pair(), [conn()]);
	const ops = diffBoardDocuments(before, after);
	const undone = applyBoardOps(after, invertBoardOps(ops));
	assert.deepEqual(undone.connections, []);
	// And redo brings it back.
	assert.equal(applyBoardOps(undone, ops).connections.length, 1);
});

test("undo of a relation edit restores every changed field at once", () => {
	// One user action changes several fields; undo has to be one step, not one per
	// field.
	const original = conn({
		direction: "forward",
		label: "",
		relation: "related",
	});
	const edited = conn({
		direction: "both",
		label: "depends on",
		relation: "depends-on",
	});
	const ops = diffBoardDocuments(
		doc(pair(), [original]),
		doc(pair(), [edited]),
	);
	const undone = applyBoardOps(doc(pair(), [edited]), invertBoardOps(ops));
	assert.deepEqual(undone.connections, [original]);
});
