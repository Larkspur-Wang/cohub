import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidCachedGenerationModel } from "../lib/stores/generation-models-validation";

test("rejects invalid parameter type", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: { steps: { type: "unknown" } },
		}),
		false,
	);
});

test("rejects string parameter with number enum", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: { style: { type: "string", enum: [1, 2] } },
		}),
		false,
	);
});

test("rejects number parameter with string enum", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: { steps: { type: "number", enum: ["low", "high"] } },
		}),
		false,
	);
});

test("rejects invalid dimension separator", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				size: { type: "string", dimensions: { separator: ":" } },
			},
		}),
		false,
	);
});

test("rejects invalid content type", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [{ type: "document" }] },
		}),
		false,
	);
});

test("rejects invalid source type", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [{ type: "image", sources: ["file", "url"] }] },
		}),
		false,
	);
});

test("rejects invalid merge type", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [{ type: "text", merge: "join" }] },
		}),
		false,
	);
});

test("rejects null meta field", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			meta: { fields: { task_id: null } },
		}),
		false,
	);
});

test("accepts valid minimal model", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
		}),
		true,
	);
});

test("accepts valid model with typed parameters", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				prompt: { type: "string", default: "hello" },
				steps: { type: "integer", min: 1, max: 100 },
				temperature: { type: "number", default: 0.7 },
				enabled: { type: "boolean", optional: true },
			},
		}),
		true,
	);
});

test("accepts valid model with string enum", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				style: { type: "string", enum: ["natural", "vivid"] },
			},
		}),
		true,
	);
});

test("accepts valid model with dimensions", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				size: {
					type: "string",
					dimensions: { separator: "x", min: 256, multipleOf: 64 },
				},
			},
		}),
		true,
	);
});

test("accepts dimensions without an optional separator", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				size: { type: "string", dimensions: { min: 256, max: 1024 } },
			},
		}),
		true,
	);
});

test("accepts valid model with content specs", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: {
				input: [
					{ type: "text", required: true, max: 1 },
					{ type: "image", sources: ["url", "base64"], min: 1, max: 5 },
					{ type: "video", roles: ["reference"], roleRequired: true },
				],
			},
		}),
		true,
	);
});

test("accepts valid model with meta spec", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			meta: {
				fields: {
					task_id: { type: "string" },
					config: { type: "object", optional: true },
				},
				taskField: "task_id",
				taskVariants: {
					remix: {
						description: "Remix mode",
						required: ["source"],
						requiredContent: ["image"],
						sendTask: true,
					},
				},
			},
		}),
		true,
	);
});

test("rejects boolean parameter with dimensions", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				enabled: { type: "boolean", dimensions: { separator: "x" } },
			},
		}),
		false,
	);
});

test("rejects boolean parameter with min/max", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				enabled: { type: "boolean", min: 0, max: 1 },
			},
		}),
		false,
	);
});

test("rejects string parameter with numeric min/max", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				name: { type: "string", min: 1, max: 100 },
			},
		}),
		false,
	);
});

test("rejects number parameter with dimensions", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				steps: { type: "number", dimensions: { separator: "x" } },
			},
		}),
		false,
	);
});

test("rejects empty model id", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "",
			schema: "neta.generation.model.v1",
			content: { input: [] },
		}),
		false,
	);
});

test("rejects empty schema", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "",
			content: { input: [] },
		}),
		false,
	);
});

test("rejects non-string title", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			title: {},
		}),
		false,
	);
});

test("rejects non-string description", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			description: [],
		}),
		false,
	);
});

test("rejects non-boolean hidden", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			hidden: "true",
		}),
		false,
	);
});

test("rejects non-boolean allowUnknownParameters", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			allowUnknownParameters: 1,
		}),
		false,
	);
});

test("accepts valid model with all top-level fields", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			title: "Test Model",
			description: "A test model",
			hidden: true,
			allowUnknownParameters: false,
			content: { input: [] },
		}),
		true,
	);
});

test("rejects number parameter with enum", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				steps: { type: "number", enum: [10, 20, 30] },
			},
		}),
		false,
	);
});

test("rejects integer parameter with enum", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				count: { type: "integer", enum: [1, 2, 3] },
			},
		}),
		false,
	);
});

test("rejects boolean parameter with enum", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v1",
			content: { input: [] },
			parameters: {
				enabled: { type: "boolean", enum: [true, false] },
			},
		}),
		false,
	);
});

test("rejects invalid schema version", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "neta.generation.model.v2",
			content: { input: [] },
		}),
		false,
	);
});

test("rejects arbitrary non-empty schema", () => {
	assert.equal(
		isValidCachedGenerationModel({
			model: "test",
			schema: "some.other.schema",
			content: { input: [] },
		}),
		false,
	);
});
