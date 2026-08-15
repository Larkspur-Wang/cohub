import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowedWorkOrigin } from "../lib/features/work/work-origin-allowlist.ts";

describe("isAllowedWorkOrigin", () => {
	it("accepts current and legacy Cohub origins", () => {
		for (const origin of [
			"https://cohub.live",
			"https://dev.cohub.live",
			"https://works.cohub.live",
			"https://cohub.run",
			"https://dev.cohub.run",
		]) {
			assert.equal(isAllowedWorkOrigin(origin), true, origin);
		}
	});

	it("rejects insecure and lookalike Cohub origins", () => {
		for (const origin of [
			"http://cohub.live",
			"https://cohub.live.evil.example",
			"https://notcohub.live",
			"garbage",
		]) {
			assert.equal(isAllowedWorkOrigin(origin), false, origin);
		}
	});
});
