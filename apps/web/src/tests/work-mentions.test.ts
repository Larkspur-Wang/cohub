import assert from "node:assert/strict";
import { test } from "node:test";
import {
	replaceCohubResourceUrls,
	tokenizeResourceMentionText,
} from "../lib/mentions/resource";
import { buildSpaceMentionMarkdown } from "../lib/mentions/space";
import {
	buildWorkMentionHref,
	buildWorkMentionMarkdown,
	buildWorkMentionUri,
	parseCohubWorkUrls,
	parseWorkMentionUri,
	replaceCohubWorkUrls,
} from "../lib/mentions/work";

const work = {
	username: "alice",
	spaceSlug: "studio",
	workSlug: "launch",
};
const spaceId = "123e4567-e89b-12d3-a456-426614174000";

test("tokenizeResourceMentionText renders work mentions", () => {
	const uri = buildWorkMentionUri(work);
	assert.deepEqual(
		tokenizeResourceMentionText(`Review @[Launch](${uri}) next.`),
		[
			{ type: "text", text: "Review " },
			{
				type: "workMention",
				label: "Launch",
				...work,
				launchSuffix: "",
				raw: `@[Launch](${uri})`,
				uri,
				href: buildWorkMentionHref(work),
			},
			{ type: "text", text: " next." },
		],
	);
});

test("tokenizeResourceMentionText keeps malformed Space URIs as text", () => {
	const text = `Review @[Core API](cohub://spaces/${spaceId}/garbage) next.`;
	const tokens = tokenizeResourceMentionText(text);

	assert.equal(
		tokens.every((token) => token.type === "text"),
		true,
	);
	assert.equal(
		tokens.map((token) => (token.type === "text" ? token.text : "")).join(""),
		text,
	);
});

test("replaceCohubResourceUrls converts mixed Space and Work links", () => {
	const text = `Open https://cohub.run/spaces/${spaceId} and https://cohub.run/alice/studio/w/launch`;
	assert.equal(
		replaceCohubResourceUrls(text, {
			space: () => "Core API",
			work: () => "Launch",
		}),
		`Open ${buildSpaceMentionMarkdown({ spaceId, label: "Core API" })} and ${buildWorkMentionMarkdown({ ...work, label: "Launch" })}`,
	);
});

test("parseCohubWorkUrls preserves public link state", () => {
	assert.deepEqual(
		parseCohubWorkUrls(
			"https://cohub.run/alice/studio/w/launch?view=timeline#today",
		),
		[
			{
				raw: "https://cohub.run/alice/studio/w/launch?view=timeline#today",
				...work,
				launchSuffix: "?view=timeline#today",
			},
		],
	);
});

test("replaceCohubWorkUrls converts only resolved works", () => {
	const url = "/alice/studio/w/launch";
	assert.equal(
		replaceCohubWorkUrls(`Open ${url}.`, () => "Launch"),
		`Open ${buildWorkMentionMarkdown({ ...work, label: "Launch" })}.`,
	);
	assert.equal(
		replaceCohubWorkUrls(url, () => null),
		url,
	);
});

test("parseWorkMentionUri rejects invalid public identities", () => {
	assert.equal(
		parseWorkMentionUri("cohub://works/alice/studio/bad.slug"),
		null,
	);
	assert.equal(parseWorkMentionUri("cohub://works/-alice/studio/launch"), null);
	assert.equal(
		parseWorkMentionUri("cohub://works/alice--dev/studio/launch"),
		null,
	);
});
