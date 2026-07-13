import assert from "node:assert/strict";
import { test } from "node:test";
import {
	isValidPortKey,
	parsePreviewParam,
	withPreviewParam,
} from "../lib/features/space/modules/workspace-preview-route.ts";

test("route back clearing preview is expressible as null ref", () => {
	const open = withPreviewParam("/spaces/s/sessions/a", null, {
		kind: "file",
		key: "a.md",
	});
	const closed = withPreviewParam(
		"/spaces/s/sessions/a",
		new URL(open, "https://x").search,
		null,
	);
	assert.equal(closed, "/spaces/s/sessions/a");
	assert.equal(parsePreviewParam(null), null);
});

test("port deep-link keys must be trusted numeric ports", () => {
	assert.equal(isValidPortKey("5173"), true);
	assert.equal(parsePreviewParam("port:80@evil"), null);
});
