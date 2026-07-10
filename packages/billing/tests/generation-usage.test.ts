import assert from "node:assert/strict";
import { test } from "node:test";
import {
	contentTypesFromBlocks,
	generationUsageKind,
	normalizePositiveUsd,
	resolveGenerationUsageType,
} from "../src/generation-usage.js";
import { COHUB_BILLING_USAGE_TYPES } from "../src/interfaces.js";

test("resolveGenerationUsageType prefers strict adapter families", () => {
	assert.equal(
		resolveGenerationUsageType({ adapterType: "openai.images", contentTypes: ["video"] }),
		COHUB_BILLING_USAGE_TYPES.generationImage,
	);
	assert.equal(
		resolveGenerationUsageType({ adapterType: "ark.videoGenerations" }),
		COHUB_BILLING_USAGE_TYPES.generationVideo,
	);
	assert.equal(
		resolveGenerationUsageType({ adapterType: "suno.tasks" }),
		COHUB_BILLING_USAGE_TYPES.generationMusic,
	);
	assert.equal(
		resolveGenerationUsageType({ adapterType: "kling.videoGenerations" }),
		COHUB_BILLING_USAGE_TYPES.generationVideo,
	);
});

test("ambiguous adapters prefer content modality over adapter default", () => {
	assert.equal(
		resolveGenerationUsageType({ adapterType: "gemini.generateContent", contentTypes: ["video"] }),
		COHUB_BILLING_USAGE_TYPES.generationVideo,
	);
	assert.equal(
		resolveGenerationUsageType({ adapterType: "gemini.generateContent", contentTypes: ["audio"] }),
		COHUB_BILLING_USAGE_TYPES.generationMusic,
	);
	assert.equal(
		resolveGenerationUsageType({ adapterType: "gemini.generateContent", contentTypes: ["text"] }),
		COHUB_BILLING_USAGE_TYPES.generationImage,
	);
	assert.equal(
		resolveGenerationUsageType({ adapterType: "gemini.generateContent" }),
		COHUB_BILLING_USAGE_TYPES.generationImage,
	);
});

test("resolveGenerationUsageType falls back to content types for unknown adapters", () => {
	assert.equal(
		resolveGenerationUsageType({ contentTypes: ["text", "image"] }),
		COHUB_BILLING_USAGE_TYPES.generationImage,
	);
	assert.equal(
		resolveGenerationUsageType({ contentTypes: ["image", "video"] }),
		COHUB_BILLING_USAGE_TYPES.generationVideo,
	);
	assert.equal(
		resolveGenerationUsageType({ contentTypes: ["audio"] }),
		COHUB_BILLING_USAGE_TYPES.generationMusic,
	);
	assert.equal(
		resolveGenerationUsageType({ contentTypes: ["text"] }),
		COHUB_BILLING_USAGE_TYPES.generation,
	);
	assert.equal(resolveGenerationUsageType({}), COHUB_BILLING_USAGE_TYPES.generation);
});

test("contentTypesFromBlocks extracts block types", () => {
	assert.deepEqual(
		contentTypesFromBlocks([
			{ type: "text", text: "hi" },
			{ type: "image", source: { type: "url", url: "https://example.com/a.png" } },
			null,
			{ type: "  video  " },
		]),
		["text", "image", "video"],
	);
});

test("generationUsageKind maps ledger types onto gate kinds", () => {
	assert.equal(generationUsageKind(COHUB_BILLING_USAGE_TYPES.generationImage), "generation.image");
	assert.equal(generationUsageKind(COHUB_BILLING_USAGE_TYPES.generationVideo), "generation.video");
	assert.equal(generationUsageKind(COHUB_BILLING_USAGE_TYPES.generationMusic), "generation.music");
	assert.equal(generationUsageKind(COHUB_BILLING_USAGE_TYPES.generation), "generation");
	assert.equal(generationUsageKind(COHUB_BILLING_USAGE_TYPES.generationLlm), "llm.turn");
	assert.equal(generationUsageKind(COHUB_BILLING_USAGE_TYPES.generationLlmRaw), "llm.raw_completion");
});

test("normalizePositiveUsd rejects non-positive values", () => {
	assert.equal(normalizePositiveUsd(undefined), 0);
	assert.equal(normalizePositiveUsd(null), 0);
	assert.equal(normalizePositiveUsd(0), 0);
	assert.equal(normalizePositiveUsd(-1), 0);
	assert.equal(normalizePositiveUsd(Number.NaN), 0);
	assert.equal(normalizePositiveUsd(0.123456789), 0.12345679);
});
