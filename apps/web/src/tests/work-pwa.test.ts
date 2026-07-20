import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkDetailResponse } from "@neta-art/cohub";
import { buildWorkPageMeta } from "../lib/work-page-meta";
import { buildWorkPwaMeta, resolvePublicWorkStartUrl } from "../lib/work-pwa";

function detail(
	overrides: Partial<WorkDetailResponse["work"]> = {},
	space: Partial<WorkDetailResponse["space"]> = {},
	owner: Partial<WorkDetailResponse["owner"]> = {},
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
			...owner,
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

test("buildWorkPwaMeta uses page description and assets", () => {
	const meta = buildWorkPwaMeta(
		detail(
			{
				meta: {
					title: "Launch Board",
					description: "Ship demos from Spaces.",
					icon: "https://cdn.example/icon.png",
					image: "https://cdn.example/cover.png",
				},
			},
			{ name: "Space Lab" },
		),
	);
	assert.equal(meta.description, "Ship demos from Spaces.");
	assert.equal(meta.iconUrl, "https://cdn.example/icon.png");
	assert.equal(meta.imageUrl, "https://cdn.example/cover.png");
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

test("buildWorkPageMeta marks space-visibility works noindex", () => {
	const page = buildWorkPageMeta(
		detail({ visibility: "space", meta: { title: "Private Board" } }),
		{ origin: "https://cohub.run", path: "/ada/lab/w/demo" },
	);
	assert.equal(page.robots, "noindex,nofollow");
	assert.equal(page.indexable, false);
	assert.equal(page.canonical, "https://cohub.run/ada/lab/w/demo");
	assert.equal(page.name, "Private Board");
	assert.equal(page.documentTitle, "Private Board — Cohub Work");
	assert.match(page.jsonLd, /Private Board/);
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
