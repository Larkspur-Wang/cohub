import assert from "node:assert/strict";
import { test } from "node:test";
import { WebsocketClient } from "../src/websocket.js";
import type { ChannelEnvelope } from "@cohub/protocol/realtime";

function createPatchEnvelope(input: {
	seq: number;
	baseSeq: number;
	ops: unknown[];
}): ChannelEnvelope {
	return {
		id: `patch-${input.seq}`,
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
			ops: input.ops,
			_rt: { sid: "stream-1" },
		},
	};
}

test("compact stream resumes after a snapshot-seeded patch", () => {
	const client = new WebsocketClient({
		url: "ws://localhost",
		getAccessToken: () => "token",
	});
	const events: ChannelEnvelope[] = [];
	client.on("event", (event) => events.push(event));

	const handleMessage = (
		client as unknown as { handleMessage(raw: unknown): void }
	).handleMessage.bind(client);

	handleMessage(
		JSON.stringify({
			id: "snapshot-12",
			timestamp: Date.now(),
			domain: "session",
			type: "session.turn.snapshot",
			spaceId: "space-1",
			sessionId: "session-1",
			payload: {
				turnId: "turn-1",
				anchorUserMessageId: "user-1",
				seq: 12,
				current: {
					messageId: "turn:turn-1:assistant:0",
					messageOrdinal: 0,
					content: [{ type: "text", text: "hello" }],
					appendPath: "/message/content/blocks/0/text",
				},
				intermediateMessages: [],
			},
		}),
	);

	handleMessage(
		JSON.stringify(
			createPatchEnvelope({
				seq: 13,
				baseSeq: 12,
				ops: [{ v: " world" }],
			}),
		),
	);
	handleMessage(
		JSON.stringify({
			t: "d",
			sid: "stream-1",
			s: 14,
			b: 13,
			v: "!",
		}),
	);

	const patchSeqs = events
		.filter((event) => event.type === "session.turn.patch")
		.map((event) => event.payload.seq);
	assert.deepEqual(patchSeqs, [13, 14]);
});
