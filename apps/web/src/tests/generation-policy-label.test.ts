import assert from "node:assert/strict";
import { test } from "node:test";
import { formatGenerationPolicyLabel } from "../lib/generation-policy-label";

test("auto mode hides label", () => {
	assert.equal(
		formatGenerationPolicyLabel({
			mode: "auto",
			selectedModels: ["flux"],
		}),
		null,
	);
});

test("limited with no models shows Gen 0", () => {
	assert.equal(
		formatGenerationPolicyLabel({
			mode: "limited",
			selectedModels: [],
		}),
		"Gen 0",
	);
});

test("limited prefers short titles for one or two models", () => {
	assert.equal(
		formatGenerationPolicyLabel({
			mode: "limited",
			selectedModels: ["provider/flux-pro"],
			catalog: [{ model: "provider/flux-pro", title: "Flux" }],
		}),
		"Flux",
	);

	assert.equal(
		formatGenerationPolicyLabel({
			mode: "limited",
			selectedModels: ["a", "b"],
			catalog: [
				{ model: "a", title: "Flux" },
				{ model: "b", title: "SD3" },
			],
		}),
		"Flux · SD3",
	);
});

test("limited falls back to model id tail without catalog", () => {
	assert.equal(
		formatGenerationPolicyLabel({
			mode: "limited",
			selectedModels: ["acme/image-v2"],
		}),
		"image-v2",
	);
});

test("limited collapses many or oversized names to Gen N", () => {
	assert.equal(
		formatGenerationPolicyLabel({
			mode: "limited",
			selectedModels: ["a", "b", "c"],
			catalog: [
				{ model: "a", title: "One" },
				{ model: "b", title: "Two" },
				{ model: "c", title: "Three" },
			],
		}),
		"Gen 3",
	);

	assert.equal(
		formatGenerationPolicyLabel({
			mode: "limited",
			selectedModels: ["a", "b"],
			catalog: [
				{ model: "a", title: "Very Long Generation Model Alpha" },
				{ model: "b", title: "Very Long Generation Model Beta" },
			],
		}),
		"Gen 2",
	);
});

test("limited follows catalog order and dedupes", () => {
	assert.equal(
		formatGenerationPolicyLabel({
			mode: "limited",
			selectedModels: ["b", "a", "b"],
			catalog: [
				{ model: "a", title: "Flux" },
				{ model: "b", title: "SD3" },
			],
		}),
		"Flux · SD3",
	);
});

test("limited trims empty ids", () => {
	assert.equal(
		formatGenerationPolicyLabel({
			mode: "limited",
			selectedModels: ["  ", "acme/flux"],
			catalog: [{ model: "acme/flux", title: "Flux" }],
		}),
		"Flux",
	);
});
