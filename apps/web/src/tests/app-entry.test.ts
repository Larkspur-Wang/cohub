import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSpaceLandingRoute } from "../lib/space-routes.ts";

describe("app entry routes", () => {
	it("lands new users on a space session draft", () => {
		assert.equal(
			buildSpaceLandingRoute("space-home"),
			"/spaces/space-home/sessions/new",
		);
	});
});
