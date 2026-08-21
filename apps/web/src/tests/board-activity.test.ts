import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardDocument } from "@neta-art/cohub/board";
import {
	createBoardAutomationActivity,
	mergeBoardAutomationActivity,
} from "../lib/board/board-activity.ts";

const document: BoardDocument = {
	kind: "cohub.board",
	version: 1,
	appearance: {
		theme: "clean",
		background: { kind: "solid" },
		grid: { visible: false, size: 24, opacity: 0.12 },
		mood: "clean",
	},
	viewport: { x: 0, y: 0, zoom: 1 },
	items: [
		{
			id: "title",
			type: "text",
			text: "Title",
			color: "neutral",
			fontSize: 24,
			frame: { x: 20, y: 30, width: 200, height: 40, rotation: 0 },
		},
	],
	connections: [],
};

test("semantic changed item ids produce an Agent activity focus", () => {
	const activity = createBoardAutomationActivity(document, {
		boardId: "board",
		actorId: "agent",
		txId: "tx",
		itemIds: ["title"],
		source: { toolCallId: "tool", via: "sdk" },
		timestamp: 10,
	});
	assert.equal(activity?.kind, "agent");
	assert.deepEqual(activity?.focus, {
		x: 20,
		y: 30,
		width: 200,
		height: 40,
		rotation: 0,
	});
});

test("CLI activities merge by board and actor", () => {
	const activity = createBoardAutomationActivity(document, {
		boardId: "board",
		actorId: "user",
		txId: "tx",
		itemIds: ["title"],
		source: { via: "cli" },
		timestamp: 20,
	});
	assert.ok(activity);
	assert.equal(
		mergeBoardAutomationActivity([activity], { ...activity, updatedAt: 30 })
			.length,
		1,
	);
});
