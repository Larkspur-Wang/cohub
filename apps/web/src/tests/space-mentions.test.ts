import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildSpaceMentionUri,
	extractSpaceMentionsFromText,
	formatSpaceMentionTextForDisplay,
	parseCohubSpaceUrls,
	replaceCohubSpaceUrls,
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

test("tokenizeSpaceMentionText ignores mentions embedded in URLs", () => {
	const uri = buildSpaceMentionUri(spaceId);
	const text = `https://sessions.cohub.run/dev/fs-cache@[Core API](${uri})`;

	assert.deepEqual(tokenizeSpaceMentionText(text), [{ type: "text", text }]);
});

test("formatSpaceMentionTextForDisplay renders mention markdown as friendly text", () => {
	const uri = buildSpaceMentionUri(spaceId);

	assert.equal(
		formatSpaceMentionTextForDisplay(`Review @[Core API](${uri}) next.`),
		"Review @Core API next.",
	);
});

test("replaceCohubSpaceUrls keeps asset URLs with embedded space path intact", () => {
	const text = `https://sessions.cohub.run/dev/fs-cache/spaces/${spaceId}/files/06295bac606fe091/image.png`;

	assert.deepEqual(parseCohubSpaceUrls(text), []);
	assert.equal(
		replaceCohubSpaceUrls(text, () => "Core API"),
		text,
	);
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
