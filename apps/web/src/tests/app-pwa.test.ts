import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppDetailResponse } from "@neta-art/cohub";
import { buildAppPageMeta } from "../lib/app-page-meta";
import { buildAppPwaMeta, resolvePublicAppStartUrl } from "../lib/app-pwa";

function detail(
	overrides: Partial<AppDetailResponse["app"]> = {},
	space: Partial<AppDetailResponse["space"]> = {},
	owner: Partial<AppDetailResponse["owner"]> = {},
): AppDetailResponse {
	return {
		app: {
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
			appScopes: [],
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

test("buildAppPwaMeta prefers work meta title", () => {
	const meta = buildAppPwaMeta(
		detail(
			{ meta: { title: "Launch Board", name: "Ignored" } },
			{ name: "Space Lab" },
		),
	);
	assert.equal(meta.shortName, "Launch Board");
	assert.equal(meta.name, "Launch Board");
	assert.equal(meta.description, "Open Launch Board from Space Lab");
});

test("buildAppPwaMeta uses page description and assets", () => {
	const meta = buildAppPwaMeta(
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

test("buildAppPwaMeta falls back to space name then slug", () => {
	assert.equal(
		buildAppPwaMeta(detail({}, { name: "Space Lab" })).shortName,
		"Space Lab",
	);
	assert.equal(
		buildAppPwaMeta(detail({ slug: "demo_work" })).shortName,
		"Demo Work",
	);
});

test("buildAppPageMeta marks space-visibility works noindex", () => {
	const page = buildAppPageMeta(
		detail({ visibility: "space", meta: { title: "Private Board" } }),
		{ origin: "https://cohub.run", path: "/ada/lab/w/demo" },
	);
	assert.equal(page.robots, "noindex,nofollow");
	assert.equal(page.indexable, false);
	assert.equal(page.canonical, "https://cohub.run/ada/lab/w/demo");
	assert.equal(page.name, "Private Board");
	assert.equal(page.documentTitle, "Private Board");
	assert.match(page.jsonLd, /Private Board/);
});

test("buildAppPageMeta resolves root-relative icons against content URL", () => {
	const page = buildAppPageMeta(
		{
			...detail({
				meta: {
					title: "时光笔记 — 记录灵感，管理待办",
					description: "简洁优雅的待办",
					icon: "/favicon.svg",
					image: "/favicon.svg",
				},
			}),
			contentUrl: "https://works.cohub.run/dev/w/space/demo/abc/index.html",
		},
		{ origin: "https://dev.cohub.run", path: "/tzwm/20/w/h" },
	);
	assert.equal(page.documentTitle, "时光笔记 — 记录灵感，管理待办");
	assert.equal(page.siteName, "Cohub");
	assert.equal(page.minimalBranding, false);
	assert.equal(
		page.iconUrl,
		"https://works.cohub.run/dev/w/space/demo/abc/favicon.svg",
	);
	// SVG is fine for tab icons but not used as og:image — fall back to host default.
	assert.equal(page.imageUrl, "https://dev.cohub.run/pwa/icon-512x512.png");
	assert.equal(page.twitterCard, "summary");
});

test("buildAppPageMeta surfaces lang and theme-color from work meta", () => {
	const page = buildAppPageMeta(
		detail({
			meta: {
				title: "时光笔记",
				lang: "zh-CN",
				themeColor: "#c76b3a",
			},
		}),
		{ origin: "https://dev.cohub.run", path: "/tzwm/20/w/h" },
	);
	assert.equal(page.lang, "zh-CN");
	assert.equal(page.ogLocale, "zh_CN");
	assert.equal(page.themeColor, "#c76b3a");
	assert.match(page.jsonLd, /"inLanguage":"zh-CN"/);
});

test("buildAppPageMeta keeps raster og:image and skips svg share images", () => {
	const withPng = buildAppPageMeta(
		{
			...detail({
				meta: {
					title: "Lab",
					icon: "/favicon.svg",
					image: "/cover.png",
				},
			}),
			contentUrl: "https://works.cohub.run/dev/w/space/demo/abc/index.html",
		},
		{ origin: "https://dev.cohub.run", path: "/tzwm/20/w/lab" },
	);
	assert.equal(
		withPng.iconUrl,
		"https://works.cohub.run/dev/w/space/demo/abc/favicon.svg",
	);
	assert.equal(
		withPng.imageUrl,
		"https://works.cohub.run/dev/w/space/demo/abc/cover.png",
	);
	assert.equal(withPng.twitterCard, "summary_large_image");
});

test("buildAppPageMeta default branding is light host; hideCohubBar is minimal", () => {
	const withTitle = buildAppPageMeta(
		detail({ meta: { title: "Launch Board" } }),
		{ origin: "https://cohub.run", path: "/ada/lab/w/demo" },
	);
	assert.equal(withTitle.documentTitle, "Launch Board");
	assert.equal(withTitle.siteName, "Cohub");
	assert.equal(withTitle.minimalBranding, false);

	const generic = buildAppPageMeta(detail({ slug: "demo_work", meta: null }), {
		origin: "https://cohub.run",
		path: "/ada/lab/w/demo",
	});
	assert.equal(generic.documentTitle, "Demo Work · Cohub");
	assert.equal(generic.siteName, "Cohub");

	const minimal = buildAppPageMeta(
		detail({
			slug: "demo_work",
			meta: {
				title: "Launch Board",
				presentation: { hideCohubBar: true },
			},
		}),
		{ origin: "https://cohub.run", path: "/ada/lab/w/demo" },
	);
	assert.equal(minimal.documentTitle, "Launch Board");
	assert.equal(minimal.siteName, "Launch Board");
	assert.equal(minimal.minimalBranding, true);
	assert.match(minimal.jsonLd, /"name":"Launch Board"/);

	const minimalGeneric = buildAppPageMeta(
		detail({
			slug: "demo_work",
			meta: { presentation: { hideCohubBar: true } },
		}),
		{ origin: "https://cohub.run", path: "/ada/lab/w/demo" },
	);
	// Minimal never appends host, even without an explicit title.
	assert.equal(minimalGeneric.documentTitle, "Demo Work");
	assert.equal(minimalGeneric.siteName, "Demo Work");
});

test("resolvePublicAppStartUrl accepts only same-origin public work paths", () => {
	const valid = resolvePublicAppStartUrl(
		new URL(
			"https://cohub.run/app.webmanifest?start_url=%2Fada%2Flab%2Fw%2Fdemo",
		),
	);
	assert.equal(valid.startUrl, "/ada/lab/w/demo");
	assert.equal(valid.path?.appSlug, "demo");

	const crossOrigin = resolvePublicAppStartUrl(
		new URL(
			"https://cohub.run/app.webmanifest?start_url=https%3A%2F%2Fevil.test%2Fada%2Flab%2Fw%2Fdemo",
		),
	);
	assert.equal(crossOrigin.startUrl, "/");
	assert.equal(crossOrigin.path, null);

	const invalidUrl = resolvePublicAppStartUrl(
		new URL("https://cohub.run/app.webmanifest?start_url=http%3A%2F%2F%5B"),
	);
	assert.equal(invalidUrl.startUrl, "/");
	assert.equal(invalidUrl.path, null);
});
