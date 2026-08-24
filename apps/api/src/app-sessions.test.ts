import assert from "node:assert/strict";
import { test } from "node:test";
import type { Permission } from "@cohub/core/permissions";
import { config } from "./config.js";
import { createAppSessionToken, verifyAppSessionToken } from "./app-sessions.js";

const input: {
	userUuid: string;
	appId: string;
	spaceId: string;
	appScopes: Permission[];
	viewerScopes: Permission[];
} = {
	userUuid: "user-1",
	appId: "app-1",
	spaceId: "space-1",
	appScopes: ["space.view"],
	viewerScopes: ["session.prompt.readonly"],
};

test("app session tokens retain the legacy workScopes claim", () => {
	const previousKey = config.appEncryptionKey;
	config.appEncryptionKey = "test-app-session-key";
	try {
		const token = createAppSessionToken(input);
		const payloadPart = token.split(".")[1];
		assert.ok(payloadPart);
		const payload = JSON.parse(
			Buffer.from(payloadPart, "base64url").toString("utf8"),
		) as Record<string, unknown>;
		assert.deepEqual(payload.workScopes, ["space.view"]);
		assert.deepEqual(verifyAppSessionToken(token)?.workScopes, ["space.view"]);
	} finally {
		config.appEncryptionKey = previousKey;
	}
});
