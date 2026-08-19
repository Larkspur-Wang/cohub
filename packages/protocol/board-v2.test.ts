import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BOARD_PROTOCOL_VERSION,
	parseBoardCompositionInput,
	upgradeBoardSnapshot,
} from "./src/index.js";

test("authoring sources reject unsafe workspace paths", async () => {
	const { BoardAuthoringItemSchema } = await import("./src/index.js");
	const item = (path: string) => ({
		id: "image",
		type: "image",
		frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
		props: {},
		source: { kind: "space-file", path },
	});
	assert.equal(BoardAuthoringItemSchema.safeParse(item("assets/image.png")).success, true);
	assert.equal(BoardAuthoringItemSchema.safeParse(item("../secret.png")).success, false);
	assert.equal(BoardAuthoringItemSchema.safeParse(item("/etc/passwd")).success, false);
});

test("Composition inspect output can be applied without server revision", () => {
	const input = parseBoardCompositionInput({
		id: "intro",
		name: "Intro",
		timeline: { duration: 100, tracks: [], clips: [], markers: [] },
		playback: { loop: false, endBehavior: "hold", reducedMotion: { mode: "base" } },
		metadata: {},
		revision: 7,
	});
	assert.equal("revision" in input, false);
});

test("v1 snapshots upgrade through one explicit protocol ingress", () => {
	const upgraded = upgradeBoardSnapshot({
		kind: "cohub.board.snapshot",
		version: 1,
		capturedAt: "2026-01-01T00:00:00.000Z",
		board: { id: "board", metadata: {} },
		nodes: [],
		connections: [],
		effects: [{ id: "pulse", target: { type: "node", nodeId: "title" } }],
		sequences: [{ id: "intro", name: "Intro", duration: 100, seed: "seed", restPose: {}, metadata: {}, revision: 1 }],
		clips: [{ id: "reveal", sequenceId: "intro", kind: "text.reveal", target: { type: "node", nodeId: "title" }, params: {}, keyframes: [] }],
		playback: null,
	});
	assert.equal(upgraded.version, BOARD_PROTOCOL_VERSION);
	assert.equal(upgraded.compositions[0]?.id, "intro");
	assert.deepEqual(upgraded.compositions[0]?.timeline.clips[0]?.target, { type: "item", itemId: "title" });
	assert.deepEqual(upgraded.effects[0]?.target, { type: "item", itemId: "title" });
});
