import assert from "node:assert/strict";
import { test } from "node:test";
import {
	resolveComposerSelectionFromTurn,
	resolveLastAgentTurnModel,
} from "../lib/features/session-chat/session-utils";

const catalog = [
	{
		provider: "cohub",
		id: "agent-model",
		model: { name: "Agent model" },
	},
];

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
