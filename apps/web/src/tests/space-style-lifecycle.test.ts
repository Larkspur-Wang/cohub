import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const appLayout = readFileSync(
	new URL("../routes/(app)/+layout.svelte", import.meta.url),
	"utf8",
);
const workspacePage = readFileSync(
	new URL("../lib/features/space/SpaceWorkspacePage.svelte", import.meta.url),
	"utf8",
);
test("Space custom styles stay mounted while opening Space settings", () => {
	assert.match(appLayout, /from "\$lib\/space-style";/);
	assert.match(appLayout, /const spaceId = currentLayoutSpaceId;/);
	assert.match(appLayout, /if \(!authReady\) return;/);
	assert.match(appLayout, /activateSpaceStyle\(spaceId\)/);
	assert.match(appLayout, /deactivateSpaceStyle\(spaceId\)/);
	assert.doesNotMatch(workspacePage, /activateSpaceStyle/);
	assert.doesNotMatch(workspacePage, /deactivateSpaceStyle/);
});
