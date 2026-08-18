import assert from "node:assert/strict";
import { test } from "node:test";
import {
	mergeComposerTurnSources,
	resolveComposerSelectionFromTurn,
	resolveLastAgentTurnModel,
	shouldClearComposerDraftAfterSend,
} from "../lib/features/session-chat/session-utils";

const catalog = [
	{
		provider: "cohub",
		id: "agent-model",
		model: { name: "Agent model" },
	},
];

test("create mode retains the composer draft for repeated generations", () => {
	assert.equal(shouldClearComposerDraftAfterSend("create"), false);
	assert.equal(shouldClearComposerDraftAfterSend("agent"), true);
});

test("mergeComposerTurnSources prefers a full turn over an incomplete index item", () => {
	assert.deepEqual(
		mergeComposerTurnSources(
			[
				{
					id: "turn-1",
					sequence: 1,
					executionKind: "direct_generation",
					provider: "generation",
					model: "image-model",
				},
			],
			[
				{
					id: "turn-1",
					sequence: 1,
					provider: null,
					model: "image-model",
				},
			],
		),
		[
			{
				id: "turn-1",
				sequence: 1,
				executionKind: "direct_generation",
				provider: "generation",
				model: "image-model",
			},
		],
	);
});

test("resolveComposerSelectionFromTurn keeps create mode and model together", () => {
	assert.deepEqual(
		resolveComposerSelectionFromTurn(
			{
				executionKind: "direct_generation",
				provider: "generation",
				model: "image-model",
			},
			catalog,
		),
		{ mode: "create", modelId: "image-model" },
	);
});

test("resolveComposerSelectionFromTurn keeps agent mode and model together", () => {
	assert.deepEqual(
		resolveComposerSelectionFromTurn(
			{
				executionKind: "agent",
				provider: "cohub",
				model: "agent-model",
			},
			catalog,
		),
		{
			mode: "agent",
			model: {
				provider: "cohub",
				id: "agent-model",
				name: "Agent model",
			},
		},
	);
});

test("resolveLastAgentTurnModel ignores a newer direct generation turn", () => {
	const model = resolveLastAgentTurnModel(
		[
			{
				sequence: 1,
				executionKind: "agent",
				provider: "cohub",
				model: "agent-model",
			},
			{
				sequence: 2,
				executionKind: "direct_generation",
				provider: "generation",
				model: "image-model",
			},
		],
		catalog,
	);

	assert.deepEqual(model, {
		provider: "cohub",
		id: "agent-model",
		name: "Agent model",
	});
});

test("resolveLastAgentTurnModel keeps the latest legacy turn without executionKind", () => {
	const model = resolveLastAgentTurnModel(
		[
			{
				sequence: 1,
				executionKind: "agent",
				provider: "cohub",
				model: "older-model",
			},
			{
				sequence: 2,
				provider: "cohub",
				model: "agent-model",
			},
		],
		catalog,
	);

	assert.equal(model?.id, "agent-model");
});
