import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChannelEnvelope } from "@neta-art/cohub-protocol/realtime";
import { SessionGenerationStreamClient } from "../src/session-generation-stream.js";
import { WebsocketClient } from "../src/websocket.js";

function createPatchEnvelope(input: {
	id: string;
	seq: number;
	baseSeq: number;
	text: string;
}): ChannelEnvelope {
	return {
		id: input.id,
		timestamp: Date.now(),
		domain: "session",
		type: "session.turn.patch",
		spaceId: "space-1",
		sessionId: "session-1",
		payload: {
			turnId: "turn-1",
			messageId: "turn:turn-1:assistant:0",
			messageOrdinal: 0,
			sourceMessageId: "turn:turn-1:assistant:0",
			anchorUserMessageId: "user-1",
			seq: input.seq,
			baseSeq: input.baseSeq,
			ops: [
				{
					o: "add",
					p: "/message/content/blocks/0",
					v: { type: "text", text: input.text },
				},
			],
		},
	};
}

test("generation subscriptions keep independent stream reducer state", () => {
	const websocket = new WebsocketClient({
		url: "ws://localhost",
		getAccessToken: () => "token",
	});
	websocket.state = "open";
	const generation = new SessionGenerationStreamClient(
		websocket,
		"space-1",
		"session-1",
	);
	const emit = (
		websocket as unknown as { emit(type: "event", event: ChannelEnvelope): void }
	).emit.bind(websocket);

	const firstTexts: string[] = [];
	const stopFirst = generation.subscribe({
		state: (event) => {
			const block = event.state.contentBlocks[0];
			if (block?.type === "text") firstTexts.push(block.text);
		},
	});
	emit("event", createPatchEnvelope({ id: "p1", seq: 1, baseSeq: 0, text: "one" }));
	stopFirst();

	const secondTexts: string[] = [];
	const outOfSyncReasons: string[] = [];
	const stopSecond = generation.subscribe({
		state: (event) => {
			const block = event.state.contentBlocks[0];
			if (block?.type === "text") secondTexts.push(block.text);
		},
		outOfSync: (event) => outOfSyncReasons.push(event.reason),
	});
	emit("event", createPatchEnvelope({ id: "p2", seq: 1, baseSeq: 0, text: "two" }));
	stopSecond();

	assert.deepEqual(firstTexts, ["one"]);
	assert.deepEqual(secondTexts, ["two"]);
	assert.deepEqual(outOfSyncReasons, []);
});
