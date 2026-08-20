import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
	new URL("../lib/components/SessionComposer.svelte", import.meta.url),
	"utf8",
);

const voiceButton = source.match(
	/<button\s+type="button"\s+class=\{`voice-record-button[\s\S]*?<\/button>/,
)?.[0];

test("voice input stays available for follow-ups during an active generation", () => {
	assert.ok(voiceButton, "voice input button should exist");
	assert.match(
		voiceButton,
		/disabled=\{disabled \|\| sending \|\| isVoiceStarting\}/,
	);
	assert.doesNotMatch(voiceButton, /showAbort/);
});
