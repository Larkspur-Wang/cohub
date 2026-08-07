import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
	new URL("../lib/components/work/WorkSurface.svelte", import.meta.url),
	"utf8",
);

test("interactive Work frames delegate low-risk user-activated capabilities", () => {
	assert.match(
		source,
		/isBackground \? undefined : "clipboard-write; fullscreen; web-share"/,
	);
	assert.match(source, /<iframe[\s\S]*?allow=\{framePermissions\}/);
});
