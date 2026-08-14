import assert from "node:assert/strict";
import test from "node:test";
import { isValidCachedGenerationModel } from "$lib/stores/generation-models-validation";

function declaration(overrides: Record<string, unknown> = {}) {
	return {
		schema: "neta.generation.model.v1",
		model: "test",
		content: { input: [] },
		...overrides,
	};
}

test("accepts valid cached model declarations", () => {
	const cases = [
		declaration(),
		declaration({
			title: "Test model",
			description: "Description",
			hidden: true,
			allowUnknownParameters: false,
			content: {
				input: [
					{ type: "text", required: true, max: 1 },
					{
						type: "image",
						sources: ["url", "base64"],
						roles: ["reference"],
						roleRequired: true,
					},
				],
			},
			parameters: {
				prompt: { type: "string", default: "hello", enum: ["hello"] },
				size: { type: "string", dimensions: { min: 256, multipleOf: 64 } },
				steps: { type: "integer", min: 1, max: 100 },
				temperature: { type: "number", default: 0.7 },
				enabled: { type: "boolean", optional: true },
			},
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
	];

	for (const value of cases)
		assert.equal(isValidCachedGenerationModel(value), true);
});

test("rejects malformed cached model declarations", () => {
	const cases: Array<[string, unknown]> = [
		["record", null],
		["schema", declaration({ schema: "neta.generation.model.v2" })],
		["model", declaration({ model: "" })],
		["title", declaration({ title: {} })],
		["description", declaration({ description: [] })],
		["hidden", declaration({ hidden: "true" })],
		["unknown parameters flag", declaration({ allowUnknownParameters: 1 })],
		["content", declaration({ content: { input: "text" } })],
		["content type", declaration({ content: { input: [{ type: "file" }] } })],
		[
			"content source",
			declaration({
				content: { input: [{ type: "image", sources: ["file"] }] },
			}),
		],
		[
			"content role",
			declaration({ content: { input: [{ type: "image", roles: [1] }] } }),
		],
		[
			"content merge",
			declaration({ content: { input: [{ type: "text", merge: "join" }] } }),
		],
		[
			"parameter type",
			declaration({ parameters: { value: { type: "unknown" } } }),
		],
		[
			"string enum",
			declaration({ parameters: { value: { type: "string", enum: [1] } } }),
		],
		[
			"string range",
			declaration({ parameters: { value: { type: "string", min: 1 } } }),
		],
		[
			"dimensions",
			declaration({
				parameters: {
					value: { type: "string", dimensions: { separator: ":" } },
				},
			}),
		],
		[
			"numeric enum",
			declaration({ parameters: { value: { type: "number", enum: [1] } } }),
		],
		[
			"numeric dimensions",
			declaration({
				parameters: { value: { type: "integer", dimensions: {} } },
			}),
		],
		[
			"boolean range",
			declaration({ parameters: { value: { type: "boolean", max: 1 } } }),
		],
		[
			"boolean enum",
			declaration({ parameters: { value: { type: "boolean", enum: [true] } } }),
		],
		["meta field", declaration({ meta: { fields: { task_id: null } } })],
		[
			"meta variant",
			declaration({
				meta: { taskVariants: { remix: { requiredContent: ["file"] } } },
			}),
		],
	];

	for (const [name, value] of cases) {
		assert.equal(isValidCachedGenerationModel(value), false, name);
	}
});
