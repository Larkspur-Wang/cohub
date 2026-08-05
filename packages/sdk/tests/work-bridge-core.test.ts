import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
	createWorkBridgeCore,
	type WorkBridgeCoreConfig,
	type WorkBridgeCoreWork,
	type WorkBridgeDialogState,
} from "../src/work-bridge-core.js";

// --- Test helpers -----------------------------------------------------------

const originalLocalStorage = globalThis.localStorage;
const originalSessionStorage = globalThis.sessionStorage;

function makeWork(overrides: Partial<WorkBridgeCoreWork> = {}): WorkBridgeCoreWork {
	return {
		id: "work_123",
		spaceId: "space_1",
		slug: "my-work",
		userUuid: "owner-uuid",
		workScopes: ["space.view", "session.view"],
		allowedViewerScopes: ["session.prompt.readonly", "generation.create"],
		...overrides,
	};
}

type Reply = { requestId: string; payload: Record<string, unknown> };

function makeConfig(
	overrides: Partial<WorkBridgeCoreConfig> & {
		work?: WorkBridgeCoreWork;
		replies?: Reply[];
		states?: WorkBridgeDialogState[];
		tokens?: (string | null)[];
		viewerUuid?: string | null;
	} = {},
): WorkBridgeCoreConfig & { replies: Reply[]; states: WorkBridgeDialogState[] } {
	const work = overrides.work ?? makeWork();
	const replies: Reply[] = overrides.replies ?? [];
	const states: WorkBridgeDialogState[] = overrides.states ?? [];
	const tokens: (string | null)[] = overrides.tokens ?? ["user-token-abc"];
	const viewerUuid = overrides.viewerUuid === undefined ? "viewer-uuid" : overrides.viewerUuid;

	const base: WorkBridgeCoreConfig = {
		work,
		apiOrigin: "https://api.test",
		reply: (requestId, payload) => replies.push({ requestId, payload }),
		getCheckoutState: () => ({ status: null, orderId: null }),
		getAccessToken: async () =>
			tokens.length > 0 ? (tokens.shift() ?? null) : "user-token-abc",
		getViewerUuid: async () => viewerUuid,
		requestSignIn: async () => {},
		onStateChange: (s) => states.push(s),
		...overrides,
	};
	return { ...base, replies, states };
}

function messageEvent(data: Record<string, unknown>): MessageEvent {
	return { data } as MessageEvent;
}

afterEach(() => {
	globalThis.localStorage = originalLocalStorage;
	globalThis.sessionStorage = originalSessionStorage;
});

// --- Tests ------------------------------------------------------------------

test("context message replies with work metadata", async () => {
	const config = makeConfig();
	const core = createWorkBridgeCore(config);

	await core.handleMessage(
		messageEvent({ type: "cohub.work.context", requestId: "r1" }),
	);

	assert.equal(config.replies.length, 1);
	const reply = config.replies[0];
	assert.equal(reply.requestId, "r1");
	assert.equal(reply.payload.type, "cohub.work.context.result");
	const context = reply.payload.context as Record<string, unknown>;
	const work = context.work as Record<string, unknown>;
	assert.equal(work.id, "work_123");
	assert.equal(work.slug, "my-work");
	assert.deepEqual(context.space, { id: "space_1" });
});

test("token message mints a session token via API", async () => {
	const fetchCalls: string[] = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = ((url: string) => {
		fetchCalls.push(url);
		return Promise.resolve(
			new Response(JSON.stringify({ token: "session-token-xyz" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}) as typeof fetch;

	try {
		const config = makeConfig();
		const core = createWorkBridgeCore(config);

		await core.handleMessage(
			messageEvent({ type: "cohub.work.token", requestId: "r2" }),
		);

		assert.deepEqual(fetchCalls, ["https://api.test/api/works/work_123/session"]);
		assert.equal(config.replies.length, 1);
		assert.equal(config.replies[0].payload.type, "cohub.work.token.result");
		assert.equal(config.replies[0].payload.token, "session-token-xyz");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("token message reuses cached session token without re-fetching", async () => {
	let fetchCount = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() => {
		fetchCount++;
		return Promise.resolve(
			new Response(JSON.stringify({ token: "session-token-xyz" }), {
				status: 200,
			}),
		);
	}) as typeof fetch;

	try {
		const config = makeConfig();
		const core = createWorkBridgeCore(config);

		await core.handleMessage(
			messageEvent({ type: "cohub.work.token", requestId: "r1" }),
		);
		await core.handleMessage(
			messageEvent({ type: "cohub.work.token", requestId: "r2" }),
		);

		assert.equal(fetchCount, 1);
		assert.equal(config.replies[0].payload.token, "session-token-xyz");
		assert.equal(config.replies[1].payload.token, "session-token-xyz");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("forceRefresh re-fetches the session token", async () => {
	let fetchCount = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() => {
		fetchCount++;
		return Promise.resolve(
			new Response(JSON.stringify({ token: `token-${fetchCount}` }), {
				status: 200,
			}),
		);
	}) as typeof fetch;

	try {
		const config = makeConfig();
		const core = createWorkBridgeCore(config);

		await core.handleMessage(
			messageEvent({ type: "cohub.work.token", requestId: "r1" }),
		);
		await core.handleMessage(
			messageEvent({
				type: "cohub.work.token",
				requestId: "r2",
				forceRefresh: true,
			}),
		);

		assert.equal(fetchCount, 2);
		assert.equal(config.replies[0].payload.token, "token-1");
		assert.equal(config.replies[1].payload.token, "token-2");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("authorize with disallowed scopes replies error", async () => {
	const config = makeConfig();
	const core = createWorkBridgeCore(config);

	await core.handleMessage(
		messageEvent({
			type: "cohub.work.authorize",
			requestId: "r1",
			scopes: ["space.delete"], // not in allowedViewerScopes
		}),
	);

	assert.equal(config.replies.length, 1);
	assert.equal(config.replies[0].payload.type, "cohub.work.error");
	assert.equal(
		config.replies[0].payload.message,
		"No allowed scopes requested.",
	);
	// Dialog should not open
	assert.equal(core.getState().authOpen, false);
});

test("authorize opens consent dialog for non-owner without prior grant", async () => {
	const config = makeConfig({ viewerUuid: "some-other-viewer" });
	const core = createWorkBridgeCore(config);

	await core.handleMessage(
		messageEvent({
			type: "cohub.work.authorize",
			requestId: "r1",
			scopes: ["session.prompt.readonly"],
			reason: "need to read prompts",
		}),
	);

	// No reply yet — waiting for user to confirm
	assert.equal(config.replies.length, 0);
	const state = core.getState();
	assert.equal(state.authOpen, true);
	assert.equal(state.pendingAuth?.requestId, "r1");
	assert.deepEqual(state.pendingAuth?.scopes, ["session.prompt.readonly"]);
	assert.equal(state.pendingAuth?.reason, "need to read prompts");
});

test("background owner is auto-authorized without dialog", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(JSON.stringify({ token: "auth-token-xyz" }), {
				status: 200,
			}),
		)) as typeof fetch;

	try {
		const config = makeConfig({
			isBackground: true,
			viewerUuid: "owner-uuid", // same as work.userUuid
		});
		const core = createWorkBridgeCore(config);

		await core.handleMessage(
			messageEvent({
				type: "cohub.work.authorize",
				requestId: "r1",
				scopes: ["session.prompt.readonly"],
			}),
		);

		assert.equal(config.replies.length, 1);
		assert.equal(config.replies[0].payload.type, "cohub.work.authorize.result");
		assert.equal(config.replies[0].payload.token, "auth-token-xyz");
		assert.equal(core.getState().authOpen, false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("confirmAuth calls authorize API and replies with token", async () => {
	let authorizeBody: string | null = null;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = ((url: string, init: RequestInit) => {
		if (url.endsWith("/authorize")) {
			authorizeBody = init.body as string;
		}
		return Promise.resolve(
			new Response(JSON.stringify({ token: "auth-token-xyz" }), {
				status: 200,
			}),
		);
	}) as typeof fetch;

	try {
		const config = makeConfig({ viewerUuid: "viewer-uuid" });
		const core = createWorkBridgeCore(config);

		await core.handleMessage(
			messageEvent({
				type: "cohub.work.authorize",
				requestId: "r1",
				scopes: ["session.prompt.readonly"],
			}),
		);

		assert.equal(core.getState().authOpen, true);

		await core.confirmAuth();

		assert.equal(core.getState().authOpen, false);
		assert.equal(core.getState().authSaving, false);
		assert.equal(config.replies.length, 1);
		assert.equal(config.replies[0].payload.type, "cohub.work.authorize.result");
		assert.equal(config.replies[0].payload.token, "auth-token-xyz");
		assert.deepEqual(JSON.parse(authorizeBody ?? "{}"), { scopes: ["session.prompt.readonly"] });
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("cancelAuth replies with null token and closes dialog", async () => {
	const config = makeConfig({ viewerUuid: "viewer-uuid" });
	const core = createWorkBridgeCore(config);

	await core.handleMessage(
		messageEvent({
			type: "cohub.work.authorize",
			requestId: "r1",
			scopes: ["session.prompt.readonly"],
		}),
	);

	assert.equal(core.getState().authOpen, true);

	core.cancelAuth();

	assert.equal(core.getState().authOpen, false);
	assert.equal(core.getState().pendingAuth, null);
	assert.equal(config.replies.length, 1);
	assert.equal(config.replies[0].payload.type, "cohub.work.authorize.result");
	assert.equal(config.replies[0].payload.token, null);
});

test("purchase message opens purchase dialog", async () => {
	const config = makeConfig();
	const core = createWorkBridgeCore(config);

	await core.handleMessage(
		messageEvent({
			type: "cohub.work.purchase",
			requestId: "r1",
			productKey: "pro-monthly",
			purchaseAttemptId: "attempt-1",
		}),
	);

	assert.equal(config.replies.length, 0);
	const state = core.getState();
	assert.equal(state.purchaseOpen, true);
	assert.equal(state.pendingPurchase?.requestId, "r1");
	assert.equal(state.pendingPurchase?.productKey, "pro-monthly");
	assert.equal(state.pendingPurchase?.purchaseAttemptId, "attempt-1");
});

test("purchase confirmation retries with the same attempt id", async () => {
	const requestBodies: Array<Record<string, unknown>> = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = ((_url: string, init: RequestInit) => {
		requestBodies.push(JSON.parse(String(init.body)));
		if (requestBodies.length === 1) {
			return Promise.resolve(
				new Response(JSON.stringify({ message: "Allocation failed" }), {
					status: 500,
				}),
			);
		}
		return Promise.resolve(
			new Response(
				JSON.stringify({
					checkout: {
						checkoutUsable: false,
						orderId: "order-1",
						productKey: "pro-monthly",
					},
				}),
				{ status: 200 },
			),
		);
	}) as typeof fetch;

	try {
		const config = makeConfig();
		const core = createWorkBridgeCore(config);
		await core.handleMessage(
			messageEvent({
				type: "cohub.work.purchase",
				requestId: "r1",
				productKey: "pro-monthly",
				purchaseAttemptId: "attempt-1",
			}),
		);

		await core.confirmPurchase();
		assert.equal(core.getState().purchaseError, "Allocation failed");
		assert.equal(
			core.getState().pendingPurchase?.purchaseAttemptId,
			"attempt-1",
		);

		await core.confirmPurchase();
		assert.deepEqual(requestBodies, [
			{ productKey: "pro-monthly", purchaseAttemptId: "attempt-1" },
			{ productKey: "pro-monthly", purchaseAttemptId: "attempt-1" },
		]);
		assert.equal(config.replies[0].payload.type, "cohub.work.purchase.result");
		assert.equal(core.getState().purchaseOpen, false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("cancelPurchase replies with null checkout and closes dialog", async () => {
	const config = makeConfig();
	const core = createWorkBridgeCore(config);

	await core.handleMessage(
		messageEvent({
			type: "cohub.work.purchase",
			requestId: "r1",
			productKey: "pro-monthly",
		}),
	);

	assert.equal(core.getState().pendingPurchase?.purchaseAttemptId, "r1");
	core.cancelPurchase();

	assert.equal(core.getState().purchaseOpen, false);
	assert.equal(config.replies.length, 1);
	assert.equal(config.replies[0].payload.type, "cohub.work.purchase.result");
	assert.equal(config.replies[0].payload.checkout, null);
});

test("onStateChange is called when dialog state changes", async () => {
	const config = makeConfig({ viewerUuid: "viewer-uuid" });
	const core = createWorkBridgeCore(config);

	await core.handleMessage(
		messageEvent({
			type: "cohub.work.authorize",
			requestId: "r1",
			scopes: ["session.prompt.readonly"],
		}),
	);

	// At least one state change should have been recorded (dialog opened)
	const lastState = config.states[config.states.length - 1];
	assert.equal(lastState.authOpen, true);
	assert.equal(lastState.pendingAuth?.requestId, "r1");
});

test("checkout-state message reflects current checkout state", async () => {
	const config = makeConfig({
		getCheckoutState: () => ({ status: "success", orderId: "order_abc" }),
	});
	const core = createWorkBridgeCore(config);

	await core.handleMessage(
		messageEvent({ type: "cohub.work.checkout-state", requestId: "r1" }),
	);

	assert.equal(config.replies.length, 1);
	assert.equal(config.replies[0].payload.type, "cohub.work.checkout-state.result");
	assert.equal(config.replies[0].payload.status, "success");
	assert.equal(config.replies[0].payload.orderId, "order_abc");
});

test("missing user token triggers requestSignIn and replies null token", async () => {
	let signInCalled = false;
	const config = makeConfig({
		tokens: [null], // getAccessToken returns null
		requestSignIn: async () => {
			signInCalled = true;
		},
	});
	const core = createWorkBridgeCore(config);

	await core.handleMessage(
		messageEvent({ type: "cohub.work.token", requestId: "r1" }),
	);

	assert.equal(signInCalled, true);
	assert.equal(config.replies.length, 1);
	assert.equal(config.replies[0].payload.token, null);
});

test("message without requestId is ignored", async () => {
	const config = makeConfig();
	const core = createWorkBridgeCore(config);

	await core.handleMessage(messageEvent({ type: "cohub.work.context" }));

	assert.equal(config.replies.length, 0);
});

test("API error surfaces as cohub.work.error reply", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(JSON.stringify({ message: "Work not found" }), {
				status: 404,
			}),
		)) as typeof fetch;

	try {
		const config = makeConfig();
		const core = createWorkBridgeCore(config);

		await core.handleMessage(
			messageEvent({ type: "cohub.work.token", requestId: "r1" }),
		);

		assert.equal(config.replies.length, 1);
		assert.equal(config.replies[0].payload.type, "cohub.work.error");
		assert.equal(config.replies[0].payload.message, "Failed to create work session.");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
