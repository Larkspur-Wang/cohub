import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isAllowedAppOrigin,
	isLegacyAppOriginAllowed,
} from "../lib/features/app/app-origin-allowlist.ts";

describe("isAllowedAppOrigin", () => {
	it("accepts current and legacy Cohub origins", () => {
		for (const origin of [
			"https://cohub.live",
			"https://dev.cohub.live",
			"https://works.cohub.live",
			"https://cohub.run",
			"https://dev.cohub.run",
		]) {
			assert.equal(isAllowedAppOrigin(origin), true, origin);
		}
	});

	it("never lets managed App hosts fall back to the legacy allowlist", () => {
		const appId = "550e8400-e29b-41d4-a716-446655440000";
		const template = "{id}.apps.cohub.live";
		assert.equal(
			isLegacyAppOriginAllowed(`https://${appId}.apps.cohub.live`, template),
			false,
		);
		// Non-App hosts in the same subtree still use the legacy allowlist.
		assert.equal(
			isLegacyAppOriginAllowed("https://www.apps.cohub.live", template),
			true,
		);
		assert.equal(isLegacyAppOriginAllowed("https://neta.art", template), true);
	});

	it("keeps the legacy allowlist while standalone origins are disabled", () => {
		const appId = "550e8400-e29b-41d4-a716-446655440000";
		assert.equal(
			isLegacyAppOriginAllowed(`https://${appId}.apps.cohub.live`, null),
			true,
		);
	});

	it("rejects insecure and lookalike Cohub origins", () => {
		for (const origin of [
			"http://cohub.live",
			"https://cohub.live.evil.example",
			"https://notcohub.live",
			"garbage",
		]) {
			assert.equal(isAllowedAppOrigin(origin), false, origin);
		}
	});
});
