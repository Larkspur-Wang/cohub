import assert from "node:assert/strict";
import { test } from "node:test";
// Import built package so node:test can run without a TS loader.
import {
	COHUB_ENVIRONMENTS,
	resolveApiBaseUrl,
	resolveVoiceInputWebsocketUrl,
	resolveWebsocketUrl,
} from "../dist/index.js";

test("production uses cohub.live endpoints by default", () => {
	assert.deepEqual(COHUB_ENVIRONMENTS.prod, {
		apiBaseUrl: "https://api.cohub.live",
		websocketUrl: "wss://gateway.cohub.live/ws",
		voiceInputWebsocketUrl: "wss://gateway.cohub.live/asr/ws",
	});
	assert.equal(resolveApiBaseUrl({ env: "prod" }), "https://api.cohub.live");
	assert.equal(resolveWebsocketUrl({ env: "prod" }), "wss://gateway.cohub.live/ws");
	assert.equal(
		resolveVoiceInputWebsocketUrl({ env: "prod" }),
		"wss://gateway.cohub.live/asr/ws",
	);
});

test("development uses cohub.live endpoints", () => {
	assert.deepEqual(COHUB_ENVIRONMENTS.dev, {
		apiBaseUrl: "https://api-dev.cohub.live",
		websocketUrl: "wss://gateway-dev.cohub.live/ws",
		voiceInputWebsocketUrl: "wss://gateway-dev.cohub.live/asr/ws",
	});
	assert.equal(resolveApiBaseUrl({ env: "dev" }), "https://api-dev.cohub.live");
	assert.equal(resolveWebsocketUrl({ env: "dev" }), "wss://gateway-dev.cohub.live/ws");
	assert.equal(
		resolveVoiceInputWebsocketUrl({ env: "dev" }),
		"wss://gateway-dev.cohub.live/asr/ws",
	);
});
