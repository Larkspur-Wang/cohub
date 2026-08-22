import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildAppMentionHref,
	buildAppMentionMarkdown,
	buildAppMentionUri,
	parseAppMentionUri,
	parseCohubAppUrls,
	replaceCohubWorkUrls,
} from "../lib/mentions/app";
import {
	replaceCohubResourceUrls,
	tokenizeResourceMentionText,
} from "../lib/mentions/resource";
import { buildSpaceMentionMarkdown } from "../lib/mentions/space";

const work = {
	username: "alice",
	spaceSlug: "studio",
	appSlug: "launch",
};
const spaceId = "123e4567-e89b-12d3-a456-426614174000";

test("tokenizeResourceMentionText renders app mentions", () => {
	const uri = buildAppMentionUri(work);
	assert.deepEqual(
		tokenizeResourceMentionText(`Review @[Launch](${uri}) next.`),
		[
			{ type: "text", text: "Review " },
			{
				type: "appMention",
				label: "Launch",
				...work,
				launchSuffix: "",
				raw: `@[Launch](${uri})`,
				uri,
				href: buildAppMentionHref(work),
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
		`Open ${buildSpaceMentionMarkdown({ spaceId, label: "Core API" })} and ${buildAppMentionMarkdown({ ...work, label: "Launch" })}`,
	);
});

test("parseCohubAppUrls preserves public link state", () => {
	assert.deepEqual(
		parseCohubAppUrls(
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
		`Open ${buildAppMentionMarkdown({ ...work, label: "Launch" })}.`,
	);
	assert.equal(
		replaceCohubWorkUrls(url, () => null),
		url,
	);
});

test("Work links with additional subpaths stay intact", () => {
	const links = [
		"https://cohub.run/alice/studio/w/launch/download",
		"/alice/studio/w/launch/settings",
		"/alice/studio/w/launch/",
	];
	const text = links.join(" ");

	assert.deepEqual(parseCohubAppUrls(text), []);
	assert.equal(
		replaceCohubWorkUrls(text, () => "Launch"),
		text,
	);
});

test("parseAppMentionUri rejects invalid public identities", () => {
	assert.equal(parseAppMentionUri("cohub://works/alice/studio/bad.slug"), null);
	assert.equal(parseAppMentionUri("cohub://works/-alice/studio/launch"), null);
	assert.equal(
		parseAppMentionUri("cohub://works/alice--dev/studio/launch"),
		null,
	);
});
