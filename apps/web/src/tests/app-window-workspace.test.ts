import assert from "node:assert/strict";
import { test } from "node:test";
import { createWindowManager } from "../lib/features/space/modules/window-manager.svelte.ts";

(globalThis as unknown as { $state: <T>(value: T) => T }).$state = <T>(
	value: T,
) => value;

const WORK_A = "123e4567-e89b-42d3-a456-426614174000";
const WORK_B = "223e4567-e89b-42d3-a456-426614174001";

type OpenWorkInput = {
	appId: string;
	label?: string;
	launch?: { search?: string; hash?: string } | null;
};

function createHarness() {
	let workTabs: Array<{ appId: string; loading: boolean }> = [];
	let activeAppId: string | null = null;
	const opens: OpenWorkInput[] = [];
	const urls: Array<{ kind: string; key: string } | null> = [];

	const controller = createWindowManager({
		getFileTabs: () => [],
		getActiveFilePath: () => null,
		getBoardTabs: () => [],
		getActiveBoardPath: () => null,
		getPortTabs: () => [],
		getActivePort: () => null,
		getAppTabs: () => workTabs,
		getActiveAppId: () => activeAppId,
		openFile: async () => {},
		activateFile: () => {},
		closeFile: () => {},
		goBackFile: async () => null,
		openBoard: async () => {},
		activateBoard: () => {},
		closeBoard: () => {},
		openPort: () => {},
		activatePort: () => {},
		closePort: () => {},
		openApp: (input) => {
			opens.push(input);
			if (!workTabs.some((tab) => tab.appId === input.appId)) {
				workTabs = [...workTabs, { appId: input.appId, loading: false }];
			}
			activeAppId = input.appId;
		},
		activateApp: (appId) => {
			activeAppId = appId;
		},
		closeApp: (appId) => {
			if (!appId) return;
			workTabs = workTabs.filter((tab) => tab.appId !== appId);
			if (activeAppId === appId) activeAppId = workTabs.at(-1)?.appId ?? null;
		},
		getPortEndpointUrl: () => null,
		syncUrl: (ref) => {
			urls.push(ref);
		},
		weightLimit: 100,
	});

	return { controller, opens, urls, getAppTabs: () => workTabs };
}

test("showing a work opens one tab and syncs a work preview URL", () => {
	const { controller, urls, getAppTabs } = createHarness();
	controller.openApp({ appId: WORK_A, label: "Launch" });

	assert.deepEqual(controller.currentRef(), { kind: "app", key: WORK_A });
	assert.equal(controller.activeKind, "app");
	assert.equal(getAppTabs().length, 1);
	assert.deepEqual(urls.at(-1), { kind: "app", key: WORK_A });
});

test("showing the same work again reuses the tab and forwards new launch state", () => {
	const { controller, opens, getAppTabs } = createHarness();
	controller.openApp({ appId: WORK_A });
	controller.openApp({ appId: WORK_A, launch: { search: "?view=timeline" } });

	// Idempotent by work id: a repeat re-activates instead of stacking duplicates.
	assert.equal(getAppTabs().length, 1);
	assert.equal(opens.length, 2);
	assert.deepEqual(opens.at(-1)?.launch, { search: "?view=timeline" });
});

test("work previews are rejected unless the key is a work id", () => {
	const { controller, opens } = createHarness();
	controller.openApp({ appId: "alice/studio/launch" });
	assert.equal(opens.length, 0);
	assert.equal(controller.currentRef(), null);
});

test("route hydration opens a work preview without writing the URL back", () => {
	const { controller, urls } = createHarness();
	const result = controller.applyRoute({ kind: "app", key: WORK_B });

	assert.equal(result.ok, true);
	assert.deepEqual(controller.currentRef(), { kind: "app", key: WORK_B });
	assert.equal(urls.length, 0);
});

test("closing the active work falls back to the remaining tab", () => {
	const { controller, getAppTabs } = createHarness();
	controller.openApp({ appId: WORK_A });
	controller.openApp({ appId: WORK_B });
	controller.close("app", WORK_B);

	assert.equal(getAppTabs().length, 1);
	assert.deepEqual(controller.currentRef(), { kind: "app", key: WORK_A });
});

test("closeAll clears work tabs alongside the other preview domains", () => {
	const { controller, getAppTabs } = createHarness();
	controller.openApp({ appId: WORK_A });
	controller.openApp({ appId: WORK_B });
	controller.closeAll();

	assert.equal(getAppTabs().length, 0);
	assert.equal(controller.currentRef(), null);
});
