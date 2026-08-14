import assert from "node:assert/strict";
import test from "node:test";
import type { PublicGenerationDeclaration } from "@cohub/protocol/generation";
import {
	buildBoardGenerationContent,
	modelAcceptsGenerationReferences,
	normalizeGenerationReferenceUrl,
	parseBoardGenerationReferences,
	pendingGenerationTaskSnapshot,
	supportsBoardGenerationComposer,
	validateBoardGeneration,
	validateBoardGenerationParameters,
} from "$lib/board/board-generation";

const model: PublicGenerationDeclaration = {
	schema: "neta.generation.model.v1",
	model: "media-model",
	content: {
		input: [
			{ type: "text", required: true },
			{
				type: "image",
				max: 2,
				sources: ["url"],
				roles: ["reference_image"],
			},
		],
	},
};
const image = {
	id: "image-1",
	type: "image" as const,
	url: "https://example.com/source.png",
	label: "Source",
};

function withContent(
	input: PublicGenerationDeclaration["content"]["input"],
): PublicGenerationDeclaration {
	return { ...model, content: { input } };
}

test("builds content and a pending task snapshot", () => {
	assert.deepEqual(
		buildBoardGenerationContent("  Refine this  ", [
			{ ...image, role: "reference_image" },
		]),
		[
			{ type: "text", text: "Refine this" },
			{
				type: "image",
				source: { type: "url", url: image.url },
				meta: { role: "reference_image" },
			},
		],
	);
	assert.deepEqual(
		pendingGenerationTaskSnapshot({
			prompt: "  Product   photo ",
			model: model.model,
			now: "2026-08-14T10:00:00.000Z",
		}),
		{
			taskType: "generation",
			status: "pending",
			title: "Product photo",
			model: model.model,
			promptExcerpt: "Product photo",
			outputCount: 0,
			updatedAt: "2026-08-14T10:00:00.000Z",
		},
	);
});

test("validates generation inputs", () => {
	const mediaOnly = withContent([
		{ type: "image", required: true, sources: ["url"] },
	]);
	const imagePair = withContent([
		{ type: "text", required: true },
		{ type: "image", min: 2, max: 4, sources: ["url"] },
	]);
	const cases = [
		[model, "Generate", [image], null],
		[model, "", [image], "Add text input."],
		[
			model,
			"Generate",
			[{ ...image, role: "unsupported" }],
			"Choose a valid role for each image reference.",
		],
		[
			mediaOnly,
			"Unexpected",
			[image],
			"The selected model does not support text input.",
		],
		[mediaOnly, "", [image], null],
		[imagePair, "Generate", [], "Add at least 2 image inputs."],
		[imagePair, "Generate", [image], "Add at least 2 image inputs."],
	] as const;

	for (const [currentModel, prompt, references, expected] of cases) {
		assert.equal(
			validateBoardGeneration({
				model: currentModel,
				prompt,
				references,
			}),
			expected,
		);
	}
	assert.equal(modelAcceptsGenerationReferences(model, [image]), true);
	assert.equal(
		modelAcceptsGenerationReferences(model, [image, image, image]),
		false,
	);
});

test("filters models requiring unsupported metadata or voice input", () => {
	const metadataModel = {
		...model,
		meta: { fields: { task_id: { type: "string" as const } } },
	};
	const qwenModel = {
		...model,
		model: "qwen-audio-3.0-tts-flash",
		content: {
			input: [
				{ type: "text" as const, required: true },
				{ type: "audio" as const, max: 1, sources: ["url" as const] },
			],
		},
	};
	const audio = {
		id: "audio-1",
		type: "audio" as const,
		url: "https://example.com/voice.mp3",
		label: "Voice",
	};

	assert.equal(supportsBoardGenerationComposer(metadataModel), false);
	assert.equal(supportsBoardGenerationComposer(qwenModel), false);
	assert.equal(supportsBoardGenerationComposer(qwenModel, [audio]), true);
	assert.equal(
		validateBoardGeneration({
			model: qwenModel,
			prompt: "Too short",
			references: [audio],
		}),
		"Enter at least 15 characters for this model.",
	);
});

test("validates generation parameters", () => {
	const parameterModel = {
		...model,
		parameters: {
			size: {
				type: "string" as const,
				optional: true,
				dimensions: { min: 256, max: 1024, multipleOf: 16 },
			},
			steps: { type: "integer" as const, min: 1, max: 10 },
		},
	};
	const cases: Array<[Record<string, unknown>, string | null]> = [
		[{}, "Set steps."],
		[{ steps: 2.5 }, "steps must be a valid integer."],
		[{ steps: 0 }, "steps must be at least 1."],
		[{ steps: 4, size: "1000x1000" }, "size must use multiples of 16."],
		[{ steps: 4, size: "1024x768" }, null],
	];

	for (const [parameters, expected] of cases) {
		assert.equal(
			validateBoardGenerationParameters(parameterModel, parameters),
			expected,
		);
	}
});

test("restores only valid remote references", () => {
	assert.deepEqual(
		parseBoardGenerationReferences([
			{ ...image, id: "bad", url: "javascript:alert(1)" },
			{
				...image,
				url: ` ${image.url} `,
				role: " reference_image ",
			},
			{
				id: "audio-1",
				type: "audio",
				url: "https://example.com/voice.mp3",
				label: "Voice",
				role: 42,
			},
		]),
		[
			{ ...image, role: "reference_image" },
			{
				id: "audio-1",
				type: "audio",
				url: "https://example.com/voice.mp3",
				label: "Voice",
			},
		],
	);
	assert.equal(normalizeGenerationReferenceUrl(image.url), image.url);
	assert.equal(
		normalizeGenerationReferenceUrl("data:image/png;base64,abc"),
		null,
	);
});
