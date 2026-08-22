import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAppIframeUrl, parseCohubAppUrl } from "../lib/app-url";

test("parseCohubAppUrl preserves launch query and hash", () => {
	assert.deepEqual(
		parseCohubAppUrl(
			"/ada/lab/w/demo?mode=focus&tag=a&tag=b#results",
			"https://cohub.run/spaces/space-1",
		),
		{
			username: "ada",
			spaceSlug: "lab",
			appSlug: "demo",
			search: "?mode=focus&tag=a&tag=b",
			hash: "#results",
		},
	);
});

test("parseCohubAppUrl still rejects cross-origin work URLs", () => {
	assert.equal(
		parseCohubAppUrl(
			"https://example.com/ada/lab/w/demo?mode=focus",
			"https://cohub.run/spaces/space-1",
		),
		null,
	);
});

test("buildAppIframeUrl merges launch state and preserves repeated values", () => {
	assert.equal(
		buildAppIframeUrl(
			"https://works.cohub.run/site/index.html?asset=1&mode=default#overview",
			{
				search:
					"?mode=focus&tag=a&tag=b&empty=&cohub_checkout=success&cohub_order=order-1",
				hash: "#results",
			},
		),
		"https://works.cohub.run/site/index.html?asset=1&mode=focus&tag=a&tag=b&empty=#results",
	);
});

test("buildAppIframeUrl keeps content state when no business state is supplied", () => {
	const contentUrl =
		"https://works.cohub.run/site/index.html?cohub_asset=1#overview";
	assert.equal(
		buildAppIframeUrl(contentUrl, {
			search: "?cohub_checkout=cancel&COHUB_ORDER=order-1",
			hash: "",
		}),
		contentUrl,
	);
	assert.equal(buildAppIframeUrl(contentUrl, null), contentUrl);
});

test("buildAppIframeUrl leaves an invalid content URL unchanged", () => {
	assert.equal(
		buildAppIframeUrl("5173", { search: "?mode=focus", hash: "#results" }),
		"5173",
	);
});
