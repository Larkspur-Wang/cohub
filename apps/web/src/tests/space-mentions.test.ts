import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildSpaceMentionUri,
	extractSpaceMentionsFromText,
	tokenizeSpaceMentionText,
} from "../lib/mentions/space";

const spaceId = "123e4567-e89b-12d3-a456-426614174000";

test("tokenizeSpaceMentionText renders space mentions as semantic tokens", () => {
	const uri = buildSpaceMentionUri(spaceId);
	const tokens = tokenizeSpaceMentionText(`Review @[Core API](${uri}) next.`);

	assert.deepEqual(tokens, [
		{ type: "text", text: "Review " },
		{
			type: "spaceMention",
			label: "Core API",
			spaceId,
			raw: `@[Core API](${uri})`,
			uri,
			href: `/spaces/${spaceId}`,
		},
		{ type: "text", text: " next." },
	]);
});

test("extractSpaceMentionsFromText keeps one mention per space", () => {
	const uri = buildSpaceMentionUri(spaceId);
	const mentions = extractSpaceMentionsFromText(
		`@[Core API](${uri}) and @[Core API](${uri})`,
	);

	assert.equal(mentions.length, 1);
	assert.equal(mentions[0]?.label, "Core API");
	assert.equal(mentions[0]?.spaceId, spaceId);
});
