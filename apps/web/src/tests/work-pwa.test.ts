import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkDetailResponse } from "@neta-art/cohub";
import { buildWorkPwaMeta, resolvePublicWorkStartUrl } from "../lib/work-pwa";

function detail(
	overrides: Partial<WorkDetailResponse["work"]> = {},
	space: Partial<WorkDetailResponse["space"]> = {},
): WorkDetailResponse {
	return {
		work: {
			id: "work-1",
			spaceId: "space-1",
			userUuid: "user-1",
			slug: "demo_work",
			status: "published",
			visibility: "public",
			targetType: "directory",
			targetRef: "/dist",
			assetKey: null,
			currentVersionId: null,
			latestVersion: 1,
			publishedAt: null,
			workScopes: [],
			allowedViewerScopes: [],
			meta: null,
			createdAt: null,
			updatedAt: null,
			...overrides,
		},
		space: {
			id: "space-1",
			slug: "lab",
			name: null,
			userUuid: "user-1",
			publicProfile: null,
			...space,
		},
		owner: {
			userUuid: "user-1",
			username: "ada",
			displayName: "Ada",
			avatarUrl: null,
		},
		publicUrl: null,
		content: null,
	};
}

test("buildWorkPwaMeta prefers work meta title", () => {
	const meta = buildWorkPwaMeta(
		detail(
			{ meta: { title: "Launch Board", name: "Ignored" } },
			{ name: "Space Lab" },
		),
	);
	assert.equal(meta.shortName, "Launch Board");
	assert.equal(meta.name, "Launch Board — Cohub Work");
	assert.equal(meta.description, "Open Launch Board from Space Lab");
});

test("buildWorkPwaMeta falls back to space name then slug", () => {
	assert.equal(
		buildWorkPwaMeta(detail({}, { name: "Space Lab" })).shortName,
		"Space Lab",
	);
	assert.equal(
		buildWorkPwaMeta(detail({ slug: "demo_work" })).shortName,
		"Demo Work",
	);
});

test("resolvePublicWorkStartUrl accepts only same-origin public work paths", () => {
	const valid = resolvePublicWorkStartUrl(
		new URL(
			"https://cohub.run/work.webmanifest?start_url=%2Fada%2Flab%2Fw%2Fdemo",
		),
	);
	assert.equal(valid.startUrl, "/ada/lab/w/demo");
	assert.equal(valid.path?.workSlug, "demo");

	const crossOrigin = resolvePublicWorkStartUrl(
		new URL(
			"https://cohub.run/work.webmanifest?start_url=https%3A%2F%2Fevil.test%2Fada%2Flab%2Fw%2Fdemo",
		),
	);
	assert.equal(crossOrigin.startUrl, "/");
	assert.equal(crossOrigin.path, null);

	const invalidUrl = resolvePublicWorkStartUrl(
		new URL("https://cohub.run/work.webmanifest?start_url=http%3A%2F%2F%5B"),
	);
	assert.equal(invalidUrl.startUrl, "/");
	assert.equal(invalidUrl.path, null);
});
