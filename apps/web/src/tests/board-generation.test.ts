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
import { isValidCachedGenerationModel } from "$lib/stores/generation-models-validation";

const model: PublicGenerationDeclaration = {
	schema: "neta.generation.model.v1",
	model: "media-model",
	content: {
		input: [
			{ type: "text", required: true },
			{
				type: "image",
				required: false,
				max: 2,
				sources: ["url"],
				roles: ["reference_image"],
			},
		],
	},
};

test("builds generation content from prompt and original reference URLs", () => {
	assert.deepEqual(
		buildBoardGenerationContent("  Refine this  ", [
			{
				id: "image-1",
				type: "image",
				url: "https://cdn.example.com/source.png",
				label: "Source",
				role: "reference_image",
			},
		]),
		[
			{ type: "text", text: "Refine this" },
			{
				type: "image",
				source: { type: "url", url: "https://cdn.example.com/source.png" },
				meta: { role: "reference_image" },
			},
		],
	);
});

test("validates model input limits without rewriting references", () => {
	const references = [
		{
			id: "image-1",
			type: "image" as const,
			url: "https://cdn.example.com/source.png",
			label: "Source",
		},
	];
	assert.equal(modelAcceptsGenerationReferences(model, references), true);
	assert.equal(
		validateBoardGeneration({ model, prompt: "Generate", references }),
		null,
	);
	assert.equal(
		validateBoardGeneration({ model, prompt: "", references }),
		"Add text input.",
	);
});

test("rejects prompt input for media-only models", () => {
	const mediaOnlyModel = {
		...model,
		content: {
			input: [
				{
					type: "image" as const,
					required: true,
					sources: ["url" as const],
				},
			],
		},
	} satisfies PublicGenerationDeclaration;
	const references = [
		{
			id: "image-1",
			type: "image" as const,
			url: "https://example.com/source.png",
			label: "Source",
		},
	];

	assert.equal(
		validateBoardGeneration({
			model: mediaOnlyModel,
			prompt: "Unexpected prompt",
			references,
		}),
		"The selected model does not support text input.",
	);
	assert.equal(
		validateBoardGeneration({
			model: mediaOnlyModel,
			prompt: "",
			references,
		}),
		null,
	);
});

test("filters models whose required metadata the board composer cannot express", () => {
	const metaModel = {
		...model,
		meta: {
			fields: {
				task_id: { type: "string" as const },
				title: { type: "string" as const, optional: true },
			},
		},
	} satisfies PublicGenerationDeclaration;
	assert.equal(supportsBoardGenerationComposer(metaModel), false);
	assert.equal(
		validateBoardGeneration({
			model: metaModel,
			prompt: "Generate",
			references: [],
		}),
		"This model requires additional metadata.",
	);
	assert.equal(
		supportsBoardGenerationComposer({
			...model,
			meta: {
				fields: {
					title: { type: "string", optional: true },
				},
			},
		}),
		true,
	);
});

test("Qwen reference voice models require audio and enforce Audio 3 text length", () => {
	const qwenModel = {
		...model,
		model: "qwen-audio-3.0-tts-flash",
		content: {
			input: [
				{ type: "text" as const, required: true, min: 1, max: 1 },
				{
					type: "audio" as const,
					required: false,
					max: 1,
					sources: ["url" as const],
				},
			],
		},
		meta: {
			fields: {
				voice_prompt: { type: "string" as const, optional: true },
			},
		},
	} satisfies PublicGenerationDeclaration;
	const audio = {
		id: "audio-1",
		type: "audio" as const,
		url: "https://example.com/voice.mp3",
		label: "Voice",
	};
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

test("validates required, dimensional, and numeric model parameters", () => {
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
	} satisfies PublicGenerationDeclaration;
	assert.equal(
		validateBoardGenerationParameters(parameterModel, {}),
		"Set steps.",
	);
	assert.equal(
		validateBoardGenerationParameters(parameterModel, {
			steps: 4,
			size: "1000x1000",
		}),
		"size must use multiples of 16.",
	);
	assert.equal(
		validateBoardGenerationParameters(parameterModel, {
			steps: 4,
			size: "1024x768",
		}),
		null,
	);
	assert.equal(
		validateBoardGenerationParameters(parameterModel, { steps: 2.5 }),
		"steps must be a valid integer.",
	);
});

test("minimum applies even when the content type is not required", () => {
	const optionalPairModel = {
		...model,
		content: {
			input: [
				{ type: "text" as const, required: true },
				{
					type: "image" as const,
					required: false,
					min: 2,
					max: 4,
					sources: ["url" as const],
				},
			],
		},
	} satisfies PublicGenerationDeclaration;
	assert.equal(
		validateBoardGeneration({
			model: optionalPairModel,
			prompt: "Generate",
			references: [],
		}),
		"Add at least 2 image inputs.",
	);
	assert.equal(
		validateBoardGeneration({
			model: optionalPairModel,
			prompt: "Generate",
			references: [
				{
					id: "image-1",
					type: "image",
					url: "https://example.com/a.png",
					label: "A",
				},
			],
		}),
		"Add at least 2 image inputs.",
	);
});

test("content is required only when the declaration says so", () => {
	const optionalTextModel = {
		...model,
		content: {
			input: [
				{ type: "text" as const },
				{
					type: "image" as const,
					required: false,
					max: 2,
					sources: ["url" as const],
				},
			],
		},
	} satisfies PublicGenerationDeclaration;
	assert.equal(
		validateBoardGeneration({
			model: optionalTextModel,
			prompt: "",
			references: [
				{
					id: "image-1",
					type: "image",
					url: "https://example.com/a.png",
					label: "A",
				},
			],
		}),
		null,
	);
});

test("restores only HTTP references and normalizes draft roles", () => {
	assert.deepEqual(
		parseBoardGenerationReferences([
			{
				id: "bad",
				type: "image",
				url: "javascript:alert(1)",
				label: "Bad",
			},
			{
				id: "good",
				type: "image",
				url: " https://example.com/source.png ",
				label: "Source",
				role: " reference_image ",
			},
			{
				id: "role-type",
				type: "audio",
				url: "https://example.com/voice.mp3",
				label: "Voice",
				role: 42,
			},
		]),
		[
			{
				id: "good",
				type: "image",
				url: "https://example.com/source.png",
				label: "Source",
				role: "reference_image",
			},
			{
				id: "role-type",
				type: "audio",
				url: "https://example.com/voice.mp3",
				label: "Voice",
			},
		],
	);
	assert.equal(
		validateBoardGeneration({
			model,
			prompt: "Generate",
			references: [
				{
					id: "image-1",
					type: "image",
					url: "https://example.com/source.png",
					label: "Source",
					role: "unsupported",
				},
			],
		}),
		"Choose a valid role for each image reference.",
	);
});

test("accepts only remote HTTP reference URLs", () => {
	assert.equal(
		normalizeGenerationReferenceUrl("https://example.com/a.png"),
		"https://example.com/a.png",
	);
	assert.equal(
		normalizeGenerationReferenceUrl("data:image/png;base64,abc"),
		null,
	);
});

test("creates a compact pending task snapshot", () => {
	assert.deepEqual(
		pendingGenerationTaskSnapshot({
			prompt: "  Product   photo ",
			model: "media-model",
			now: "2026-08-14T10:00:00.000Z",
		}),
		{
			taskType: "generation",
			status: "pending",
			title: "Product photo",
			model: "media-model",
			promptExcerpt: "Product photo",
			outputCount: 0,
			updatedAt: "2026-08-14T10:00:00.000Z",
		},
	);
});

test("rejects corrupted model cache with invalid content specs", () => {
	const validModel = {
		schema: "neta.generation.model.v1" as const,
		model: "valid-model",
		content: {
			input: [
				{
					type: "image",
					sources: ["url"],
					roles: ["reference"],
					min: 1,
					max: 4,
					required: false,
					roleRequired: true,
				},
			],
		},
	};

	const corruptedModels = [
		{
			schema: "neta.generation.model.v1",
			model: "corrupt-sources",
			content: { input: [{ type: "image", sources: 42 }] },
		},
		{
			schema: "neta.generation.model.v1",
			model: "corrupt-roles",
			content: { input: [{ type: "image", roles: "not-array" }] },
		},
		{
			schema: "neta.generation.model.v1",
			model: "corrupt-min",
			content: { input: [{ type: "image", min: "1" }] },
		},
		{
			schema: "neta.generation.model.v1",
			model: "corrupt-required",
			content: { input: [{ type: "text", required: "yes" }] },
		},
		{
			model: "missing-content",
			schema: "neta.generation.model.v1",
		},
		{
			schema: "neta.generation.model.v1",
			model: "corrupt-input",
			content: { input: "not-array" },
		},
		{
			schema: "neta.generation.model.v1",
			model: "corrupt-sources-member",
			content: { input: [{ type: "image", sources: [42] }] },
		},
		{
			schema: "neta.generation.model.v1",
			model: "corrupt-roles-member",
			content: { input: [{ type: "text", roles: ["user", 42] }] },
		},
		{
			schema: "neta.generation.model.v1",
			model: "corrupt-enum-member",
			content: { input: [] },
			parameters: { format: { type: "string", enum: ["png", null] } },
		},
		{
			schema: "neta.generation.model.v1",
			model: "corrupt-task-variant-required",
			content: { input: [] },
			meta: {
				taskVariants: {
					variant1: { required: [42] },
				},
			},
		},
		{
			schema: "neta.generation.model.v1",
			model: "corrupt-task-variant-required-content",
			content: { input: [] },
			meta: {
				taskVariants: {
					variant1: { requiredContent: ["image", false] },
				},
			},
		},
	] as const;

	assert.ok(
		isValidCachedGenerationModel(validModel),
		"valid model should pass validation",
	);

	for (const corrupt of corruptedModels) {
		assert.ok(
			!isValidCachedGenerationModel(
				corrupt as unknown as PublicGenerationDeclaration,
			),
			`${corrupt.model} should be rejected`,
		);
	}
});
