import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BOARD_BUILTIN_CAPABILITIES,
	DEFAULT_BOARD_RENDER_LIMITS,
} from "@cohub/protocol";
import { createBoardExtensionRegistry } from "../src/board.js";
import { createBattleFixture } from "./fixtures/battle.js";

test("battle fixture compilation is deterministic", () => {
	const input = { leftImagePath: "assets/left.png", rightImagePath: "assets/right.png" };
	assert.deepEqual(createBattleFixture(input), createBattleFixture(input));
});

test("built-in registry validates and estimates the battle fixture", () => {
	const fixture = createBattleFixture({
		leftImagePath: "assets/left.png",
		rightImagePath: "assets/right.png",
	});
	const registry = createBoardExtensionRegistry();
	const validation = registry.validate({ clips: fixture.clips, effects: fixture.effects });
	assert.equal(validation.valid, true);
	assert.equal(validation.peakCost.particles, 420);
	assert.equal(validation.diagnostics.some((diagnostic) => diagnostic.code.startsWith("UNKNOWN_")), false);
	assert.deepEqual(registry.capabilities(), BOARD_BUILTIN_CAPABILITIES);
});

test("SDK render limits stay aligned with the protocol", async () => {
	const { DEFAULT_BOARD_LIMITS } = await import("../src/board.js");
	assert.deepEqual(DEFAULT_BOARD_LIMITS, DEFAULT_BOARD_RENDER_LIMITS);
});

test("registry reports invalid particle bounds without dropping the clip", () => {
	const fixture = createBattleFixture({
		leftImagePath: "assets/left.png",
		rightImagePath: "assets/right.png",
	});
	const particles = fixture.clips.find((clip) => clip.kind === "effects.particles");
	if (!particles) throw new Error("battle fixture is missing particles");
	const validation = createBoardExtensionRegistry().validate({
		clips: [{ ...particles, params: { count: 100 } }],
	});
	assert.equal(validation.valid, false);
	assert.equal(validation.diagnostics[0]?.code, "PARTICLE_BOUNDS_REQUIRED");
});
