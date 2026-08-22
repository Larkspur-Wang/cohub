import assert from "node:assert/strict";
import { test } from "node:test";
import { createAppPreviewController } from "../lib/features/space/modules/app-window-controller.svelte.ts";

(globalThis as unknown as { $state: <T>(value: T) => T }).$state = <T>(
	value: T,
) => value;

const WORK_ID = "123e4567-e89b-42d3-a456-426614174000";

const detailFor = (kind: "web" | "port" | "file" | "board" | null) => ({
	app: {
		id: WORK_ID,
		slug: "launch",
		meta: null,
		status: "published",
		latestVersion: 1,
		currentVersionId: "version-1",
		updatedAt: "2026-07-20T00:00:00.000Z",
	},
	space: null,
	owner: null,
	publicUrl: "https://cohub.run/alice/studio/w/launch",
	content: kind ? { kind, url: "https://work.example/index.html" } : null,
});

function createController(
	options: { detail?: unknown; delayMs?: number; fail?: string } = {},
) {
	return createAppPreviewController({
		getSpaceId: () => "space-1",
		loadWork: async () => {
			if (options.delayMs)
				await new Promise((r) => setTimeout(r, options.delayMs));
			if (options.fail) throw new Error(options.fail);
			return (options.detail ?? detailFor("web")) as never;
		},
	});
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("opening a work loads its detail and adopts the published title as the tab label", async () => {
	const controller = createController();
	controller.openApp({ appId: WORK_ID, label: "Work" });
	assert.equal(controller.preview?.loading, true);

	await settle();
	assert.equal(controller.preview?.loading, false);
	assert.equal(controller.preview?.label, "launch");
});

test("reopening a Work from another invocation updates context and remounts", () => {
	const controller = createController();
	controller.openApp({
		appId: WORK_ID,
		invocation: {
			surface: "app",
			source: "desktop_command",
			spaceId: "space-a",
			sessionId: "session-a",
		},
	});
	const firstMountKey = controller.preview?.mountKey;

	controller.openApp({
		appId: WORK_ID,
		invocation: {
			surface: "app",
			source: "desktop_command",
			spaceId: "space-b",
			sessionId: "session-b",
		},
	});

	assert.notEqual(controller.preview?.mountKey, firstMountKey);
	assert.equal(controller.preview?.invocation?.spaceId, "space-b");
	assert.equal(controller.preview?.invocation?.sessionId, "session-b");
});

test("reopening a closed Work gets a fresh surface mount", () => {
	const controller = createController();
	controller.openApp({ appId: WORK_ID });
	const firstMountKey = controller.preview?.mountKey;

	controller.openApp({ appId: WORK_ID });
	assert.equal(controller.preview?.mountKey, firstMountKey);

	controller.closeApp(WORK_ID);
	controller.openApp({ appId: WORK_ID });
	assert.notEqual(controller.preview?.mountKey, firstMountKey);
});

test("refreshing an open Work reloads its detail and remounts the surface", async () => {
	let detail = detailFor("web");
	let loads = 0;
	const controller = createAppPreviewController({
		getSpaceId: () => "space-1",
		loadWork: async () => {
			loads += 1;
			return detail as never;
		},
	});

	controller.openApp({ appId: WORK_ID });
	await settle();
	const firstMountKey = controller.preview?.mountKey;
	const firstLoads = loads;
	const nextApp = {
		...detail.app,
		latestVersion: detail.app.latestVersion + 1,
		currentVersionId: "version-2",
		updatedAt: "2026-07-20T01:00:00.000Z",
	};
	detail = {
		...detail,
		app: nextApp,
		content: { kind: "web", url: "https://work.example/v2.html" },
	};

	controller.refreshIfOpen(WORK_ID);
	await settle();
	assert.equal(loads, firstLoads + 1);
	assert.notEqual(controller.preview?.mountKey, firstMountKey);
	assert.equal(
		controller.preview?.detail?.content?.url,
		"https://work.example/v2.html",
	);
});

test("a stale refresh response cannot replace the current Work detail", async () => {
	let detail = detailFor("web");
	const controller = createAppPreviewController({
		getSpaceId: () => "space-1",
		loadWork: async () => detail as never,
	});

	controller.openApp({ appId: WORK_ID });
	await settle();
	const current = {
		...detail,
		app: {
			...detail.app,
			latestVersion: 2,
			currentVersionId: "version-2",
			updatedAt: "2026-07-20T01:00:00.000Z",
		},
		content: { kind: "web" as const, url: "https://work.example/v2.html" },
	};
	detail = current;
	controller.refreshIfOpen(WORK_ID);
	await settle();

	const stale = {
		...detail,
		app: {
			...detail.app,
			latestVersion: 1,
			currentVersionId: "version-1",
			updatedAt: "2026-07-20T00:00:00.000Z",
		},
		content: { kind: "web" as const, url: "https://work.example/v1.html" },
	};
	detail = stale;
	controller.refreshIfOpen(WORK_ID);
	await settle();

	assert.equal(controller.preview?.detail?.app.latestVersion, 2);
	assert.equal(
		controller.preview?.detail?.content?.url,
		"https://work.example/v2.html",
	);
	assert.equal(controller.preview?.loading, false);
});

test("a failed background refresh keeps the current Work detail", async () => {
	let shouldFail = false;
	const controller = createAppPreviewController({
		getSpaceId: () => "space-1",
		loadWork: async () => {
			if (shouldFail) throw new Error("Network unavailable");
			return detailFor("web") as never;
		},
	});

	controller.openApp({ appId: WORK_ID });
	await settle();
	shouldFail = true;
	controller.refreshIfOpen(WORK_ID);
	await settle();

	assert.equal(controller.preview?.detail?.app.latestVersion, 1);
	assert.equal(controller.preview?.error, null);
	assert.equal(controller.preview?.refreshError, "Network unavailable");
	assert.equal(controller.preview?.loading, false);
});

test("refreshing a closed Work does not load it", async () => {
	let loads = 0;
	const controller = createAppPreviewController({
		getSpaceId: () => "space-1",
		loadWork: async () => {
			loads += 1;
			return detailFor("web") as never;
		},
	});

	controller.refreshIfOpen(WORK_ID);
	await settle();
	assert.equal(loads, 0);
});

test("opening the panel happens after preview state is committed", () => {
	const observedPanelState: Array<{
		activeAppId: string | null;
		previewCount: number;
	}> = [];
	let controller: ReturnType<typeof createAppPreviewController>;
	controller = createAppPreviewController({
		getSpaceId: () => "space-1",
		loadWork: async () => detailFor("web") as never,
		onOpenPanel: () => {
			observedPanelState.push({
				activeAppId: controller.activeAppId,
				previewCount: controller.previews.length,
			});
		},
	});

	controller.openApp({ appId: WORK_ID });
	controller.closeApp(WORK_ID);
	controller.openApp({ appId: WORK_ID });

	assert.deepEqual(observedPanelState, [
		{ activeAppId: WORK_ID, previewCount: 1 },
		{ activeAppId: WORK_ID, previewCount: 1 },
	]);
});

test("Work composer context updates in place and is discarded with the preview", () => {
	const controller = createController();
	controller.openApp({ appId: WORK_ID });
	const chip = {
		key: "selection",
		label: "3 selected",
		content: "Selected records:\n- customer_123",
	};

	controller.setComposerChip(WORK_ID, chip);
	assert.deepEqual(controller.preview?.composerChip, chip);
	controller.setComposerChip(WORK_ID, { ...chip, label: "4 selected" });
	assert.equal(controller.preview?.composerChip?.label, "4 selected");
	controller.closeApp(WORK_ID);
	assert.equal(controller.preview, null);
});

test("a call issued right after opening waits for the detail and the mounted surface", async () => {
	// The realistic agent path: show and call in one command, before the iframe exists.
	const controller = createController({ delayMs: 20 });
	controller.openApp({ appId: WORK_ID });
	const pending = controller.callSurface({
		appId: WORK_ID,
		method: "ping",
		commandId: "command-1",
	});

	setTimeout(() => {
		controller.registerSurface(
			WORK_ID,
			async ({ method }: { method: string }) => ({
				ok: true,
				result: { echoed: method },
			}),
		);
	}, 30);

	assert.deepEqual(await pending, { ok: true, result: { echoed: "ping" } });
});

for (const [name, options, code] of [
	[
		"a natively rendered work",
		{ detail: detailFor("board") },
		"surface_not_supported",
	],
	[
		"a work with no published content",
		{ detail: detailFor(null) },
		"surface_not_supported",
	],
	[
		"a work whose detail failed to load",
		{ fail: "Work not found" },
		"preview_failed",
	],
] as const) {
	test(`calling ${name} fails fast with ${code}`, async () => {
		const controller = createController(options);
		controller.openApp({ appId: WORK_ID });

		const result = await controller.callSurface({
			appId: WORK_ID,
			method: "ping",
			commandId: "command-1",
		});
		assert.equal(result.ok === false && result.code, code);
	});
}

test("a denied member read falls back to the public one, other errors do not", async () => {
	// `cohub ui preview` accepts public references, so a public Work in a Space we
	// cannot view must still preview.
	const build = (status: number) => {
		let publicReads = 0;
		const controller = createAppPreviewController({
			getSpaceId: () => "space-1",
			loadWork: async () => {
				throw Object.assign(new Error("denied"), { status });
			},
			loadPublicWork: async () => {
				publicReads += 1;
				return detailFor("web") as never;
			},
		});
		return { controller, reads: () => publicReads };
	};

	const denied = build(403);
	denied.controller.openApp({ appId: WORK_ID });
	await settle();
	assert.equal(denied.reads(), 1);
	assert.equal(denied.controller.preview?.error, null);

	const failed = build(500);
	failed.controller.openApp({ appId: WORK_ID });
	await settle();
	assert.equal(failed.reads(), 0);
	assert.equal(failed.controller.preview?.error, "denied");
});

test("a work that is not open, or was closed, cannot be called", async () => {
	const controller = createController();
	const before = await controller.callSurface({
		appId: WORK_ID,
		method: "ping",
		commandId: "command-1",
	});
	assert.equal(before.ok === false && before.code, "preview_not_open");

	controller.openApp({ appId: WORK_ID });
	await settle();
	controller.registerSurface(WORK_ID, async () => ({ ok: true }));
	controller.closeApp(WORK_ID);

	assert.equal(controller.previews.length, 0);
	const after = await controller.callSurface({
		appId: WORK_ID,
		method: "ping",
		commandId: "command-1",
	});
	assert.equal(after.ok === false && after.code, "preview_not_open");
});
