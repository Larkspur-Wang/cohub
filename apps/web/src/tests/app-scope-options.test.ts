import assert from "node:assert/strict";
import { test } from "node:test";
import {
	APP_SCOPE_GROUPS,
	APP_SCOPE_OPTIONS,
} from "$lib/features/space/modules/app-utils";

const DIRECT_APP_SCOPES = [
	"space.view",
	"session.view",
	"file.view",
	"file.edit",
	"taskrun.view",
	"session.prompt.readonly",
	"session.prompt.fullaccess",
	"command.execute",
] as const;

test("App scope picker exposes the complete publisher grant set", () => {
	const options = APP_SCOPE_OPTIONS.map((option) => option.scope);
	const grouped = APP_SCOPE_GROUPS.flatMap((group) => group.scopes);

	assert.deepEqual(options, [...DIRECT_APP_SCOPES]);
	assert.deepEqual(grouped, options);
});
