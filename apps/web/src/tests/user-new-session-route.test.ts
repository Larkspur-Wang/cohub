import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUserNewSessionRoute } from "../lib/space-routes.ts";

test("buildUserNewSessionRoute stays on sessions inbox", () => {
	assert.equal(
		buildUserNewSessionRoute("space-1"),
		"/sessions/new?space=space-1",
	);
	// URLSearchParams encodes spaces as '+'.
	assert.equal(buildUserNewSessionRoute("a b"), "/sessions/new?space=a+b");
});
