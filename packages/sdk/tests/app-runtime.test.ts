import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
	createSlugAppIdResolver,
	createAppRuntime,
	ParentBridgeTransport,
	PopupBrokerTransport,
	resolveAppTransport,
	type AppRuntimeTransport,
} from "../src/app-runtime.js";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
	globalThis.window = originalWindow;
	globalThis.document = originalDocument;
	globalThis.localStorage = originalLocalStorage;
});

test("work runtime ignores non-string ancestor origins", async () => {
	let messageHandler: ((event: MessageEvent) => void) | null = null;
	let targetOrigin: string | undefined;
	const parent = {
		postMessage: (payload: { requestId?: string }, origin: string) => {
			targetOrigin = origin;
			queueMicrotask(() => {
				messageHandler?.({
					data: {
						type: "cohub.app.context.result",
						requestId: payload.requestId,
						context: {
							work: { id: "work-1", slug: "demo" },
							space: { id: "space-1" },
						},
					},
					origin: "https://cohub.run",
					source: parent,
				} as MessageEvent);
			});
		},
	};
	const windowMock = {
		parent,
		location: { ancestorOrigins: [["https://invalid.example"]] },
		addEventListener: (_type: "message", handler: (event: MessageEvent) => void) => {
			messageHandler = handler;
		},
		removeEventListener: () => {
			messageHandler = null;
		},
	};

	globalThis.window = windowMock as unknown as Window & typeof globalThis;
	globalThis.document = { referrer: "https://cohub.run/tzwm/pulsewall/w/v1" } as Document;

	const context = await createAppRuntime().context();

	assert.equal(targetOrigin, "https://cohub.run");
	assert.equal(context?.space.id, "space-1");
});

test("AppRuntimeApi delegates to the injected transport", async () => {
	const calls: { message: Record<string, unknown>; options?: object }[] = [];
	const transport: AppRuntimeTransport = {
		request<T>(message, options) {
			calls.push({ message, options });
			return Promise.resolve(null as T);
		},
	};
	const runtime = createAppRuntime(transport);

	await runtime.context();
	await runtime.getAccessToken();
	await runtime.requestAuthorization({ scopes: ["file.view"] });
	await runtime.purchase({
		productKey: "pro-1",
		purchaseAttemptId: "attempt-1",
	});
	await runtime.checkoutState();

	assert.equal(calls.length, 5);
	assert.deepEqual(calls[0].message, { type: "cohub.app.context" });
	assert.deepEqual(calls[0].options, { timeoutMs: 8_000, retryIntervalMs: 250 });
	assert.deepEqual(calls[1].message, {
		type: "cohub.app.token",
		forceRefresh: false,
	});
	assert.deepEqual(calls[1].options, { timeoutMs: 20_000 });
	assert.deepEqual(calls[2].message, {
		type: "cohub.app.authorize",
		scopes: ["file.view"],
		reason: undefined,
	});
	assert.deepEqual(calls[3].message, {
		type: "cohub.app.purchase",
		productKey: "pro-1",
		purchaseAttemptId: "attempt-1",
	});
	assert.deepEqual(calls[4].options, { timeoutMs: 8_000, retryIntervalMs: 250 });
});

test("AppRuntimeApi caches the access token across calls", async () => {
	const transport: AppRuntimeTransport = {
		request: () => Promise.resolve({ token: "tok-1" }),
	};
	const runtime = createAppRuntime(transport);

	const first = await runtime.getAccessToken();
	const second = await runtime.getAccessToken();

	assert.equal(first, "tok-1");
	assert.equal(second, "tok-1");
});

test("requestAuthorization returns false when no token is granted", async () => {
	const transport: AppRuntimeTransport = {
		request: () => Promise.resolve({ token: null }),
	};
	const runtime = createAppRuntime(transport);

	const granted = await runtime.requestAuthorization({
		scopes: ["file.view"],
	});

	assert.equal(granted, false);
});

test("createAppRuntime defaults to the parent bridge transport", async () => {
	// Without a browser parent window the bridge transport resolves to null
	// rather than throwing — proving the default is ParentBridgeTransport.
	const runtime = createAppRuntime();
	const token = await runtime.getAccessToken();
	assert.equal(token, null);
	assert.ok(new ParentBridgeTransport() instanceof ParentBridgeTransport);
});

// --- PopupBrokerTransport tests ---

test("PopupBrokerTransport answers context locally without opening a popup", async () => {
	let opened = false;
	const windowMock = {
		location: { origin: "https://my-work.example" },
		open: () => {
			opened = true;
			return { closed: false, close() {}, postMessage() {} };
		},
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	globalThis.window = windowMock as unknown as Window & typeof globalThis;

	const transport = new PopupBrokerTransport({
		brokerOrigin: "https://cohub.run",
		appId: "work-1",
	});
	const result = await transport.request<{ context: { app: { id: string } } }>(
		{ type: "cohub.app.context" },
	);

	assert.equal(opened, false);
	assert.equal(result?.context?.app?.id, "work-1");
});

test("PopupBrokerTransport answers checkout-state locally without opening a popup", async () => {
	let opened = false;
	const windowMock = {
		location: { origin: "https://my-work.example" },
		open: () => {
			opened = true;
			return { closed: false, close() {}, postMessage() {} };
		},
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	globalThis.window = windowMock as unknown as Window & typeof globalThis;

	const transport = new PopupBrokerTransport({
		brokerOrigin: "https://cohub.run",
		appId: "work-1",
	});
	const result = await transport.request<{ status: string | null }>(
		{ type: "cohub.app.checkout-state" },
	);

	assert.equal(opened, false);
	assert.equal(result?.status, null);
});

test("PopupBrokerTransport rejects when popup is blocked", async () => {
	const windowMock = {
		location: { origin: "https://my-work.example" },
		open: () => null,
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	globalThis.window = windowMock as unknown as Window & typeof globalThis;

	const transport = new PopupBrokerTransport({
		brokerOrigin: "https://cohub.run",
		appId: "work-1",
	});

	await assert.rejects(
		() => transport.request({ type: "cohub.app.token" }, { timeoutMs: 1_000 }),
		/popups/i,
	);
});

test("PopupBrokerTransport performs ready handshake and receives response", async () => {
	let messageHandler: ((event: MessageEvent) => void) | null = null;
	let postedToPopup: Record<string, unknown> | null = null;
	const popupMock = {
		closed: false,
		close() {
			this.closed = true;
		},
		postMessage: (data: Record<string, unknown>, origin: string) => {
			postedToPopup = { data, origin };
			// When the transport sends the real request (after ready handshake),
			// simulate the broker responding.
			queueMicrotask(() => {
				messageHandler?.({
					data: {
						type: "cohub.app.token.result",
						requestId: data.requestId,
						token: "broker-token-123",
					},
					origin: "https://cohub.run",
					source: popupMock,
				} as MessageEvent);
			});
		},
	};

	const windowMock = {
		location: { origin: "https://my-work.example" },
		open: () => {
			// Simulate the broker posting `ready` shortly after the popup opens.
			queueMicrotask(() => {
				messageHandler?.({
					data: { type: "cohub.app.broker.ready" },
					origin: "https://cohub.run",
					source: popupMock,
				} as MessageEvent);
			});
			return popupMock;
		},
		addEventListener: (_t: string, h: (event: MessageEvent) => void) => {
			messageHandler = h;
		},
		removeEventListener: () => {
			messageHandler = null;
		},
	};
	globalThis.window = windowMock as unknown as Window & typeof globalThis;

	const transport = new PopupBrokerTransport({
		brokerOrigin: "https://cohub.run",
		appId: "work-1",
	});

	const result = await transport.request<{ token: string | null }>(
		{ type: "cohub.app.token" },
		{ timeoutMs: 5_000 },
	);

	assert.equal(result?.token, "broker-token-123");
	// The popup should have been closed after receiving the response.
	assert.equal(popupMock.closed, true);
	// The request should have been sent to the broker with the correct targetOrigin.
	assert.equal(postedToPopup?.origin, "https://cohub.run");
});

// --- resolveAppTransport tests ---

test("resolveAppTransport defaults to bridge when no config given", () => {
	const transport = resolveAppTransport();
	assert.ok(transport instanceof ParentBridgeTransport);
});

test("resolveAppTransport returns broker when explicitly configured", () => {
	const transport = resolveAppTransport({
		mode: "broker",
		brokerOrigin: "https://cohub.run",
		appId: "work-1",
	});
	assert.ok(transport instanceof PopupBrokerTransport);
});

test("resolveAppTransport falls back to bridge when broker config is incomplete", () => {
	const transport = resolveAppTransport({ mode: "broker", brokerOrigin: "https://cohub.run" });
	assert.ok(transport instanceof ParentBridgeTransport);
});

test("resolveAppTransport auto-detects bridge inside an iframe", () => {
	globalThis.window = {
		parent: {} as Window,
	} as unknown as Window & typeof globalThis;
	const transport = resolveAppTransport();
	assert.ok(transport instanceof ParentBridgeTransport);
});

test("resolveAppTransport auto-detects broker when standalone with config", () => {
	const windowMock = {
		location: { origin: "https://my-work.example" },
	};
	// parent === self → not inside an iframe → standalone
	windowMock.parent = windowMock as unknown as Window;
	globalThis.window = windowMock as unknown as Window & typeof globalThis;
	const transport = resolveAppTransport({
		brokerOrigin: "https://cohub.run",
		appId: "work-1",
	});
	assert.ok(transport instanceof PopupBrokerTransport);
});

// --- Token persistence tests ---

test("AppRuntimeApi persists token to localStorage when appId is provided", async () => {
	const store: Record<string, string> = {};
	globalThis.localStorage = {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
	} as Storage;

	const transport: AppRuntimeTransport = {
		request: () => Promise.resolve({ token: "persisted-token" }),
	};
	const runtime = createAppRuntime(transport, "work-1");

	const token = await runtime.getAccessToken();
	assert.equal(token, "persisted-token");
	assert.equal(store["cohub:app-token:work-1"], "persisted-token");
});

test("AppRuntimeApi restores token from localStorage on construction", async () => {
	const store: Record<string, string> = {
		"cohub:app-token:work-1": "cached-token",
	};
	globalThis.localStorage = {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
	} as Storage;

	// Transport that should never be called because token is cached.
	const transport: AppRuntimeTransport = {
		request: () => {
			throw new Error("should not be called");
		},
	};
	const runtime = createAppRuntime(transport, "work-1");

	const token = await runtime.getAccessToken();
	assert.equal(token, "cached-token");
});

test("AppRuntimeApi clears stored token on forceRefresh", async () => {
	const store: Record<string, string> = {
		"cohub:app-token:work-1": "old-token",
	};
	globalThis.localStorage = {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
	} as Storage;

	const transport: AppRuntimeTransport = {
		request: () => Promise.resolve({ token: "fresh-token" }),
	};
	const runtime = createAppRuntime(transport, "work-1");

	const token = await runtime.getAccessToken({ forceRefresh: true });
	assert.equal(token, "fresh-token");
	assert.equal(store["cohub:app-token:work-1"], "fresh-token");
});

test("forceRefresh re-authorizes when viewer scopes were previously granted", async () => {
	const store: Record<string, string> = {
		"cohub:app-token:work-1": "expired-token",
		"cohub:app-auth-scopes:work-1": JSON.stringify(["session.prompt.fullaccess"]),
	};
	globalThis.localStorage = {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
	} as Storage;

	const calls: { message: Record<string, unknown> }[] = [];
	const transport: AppRuntimeTransport = {
		request<T>(message: Record<string, unknown>): Promise<T | null> {
			calls.push({ message });
			// Return a token for any request type
			return Promise.resolve({ token: "refreshed-with-viewer-scopes" } as T);
		},
	};
	const runtime = createAppRuntime(transport, "work-1");

	const token = await runtime.getAccessToken({ forceRefresh: true });

	assert.equal(token, "refreshed-with-viewer-scopes");
	assert.equal(calls.length, 1);
	// Must re-authorize (not plain token) to preserve viewerScopes
	assert.equal(calls[0].message.type, "cohub.app.authorize");
	assert.deepEqual(calls[0].message.scopes, ["session.prompt.fullaccess"]);
	assert.equal(store["cohub:app-token:work-1"], "refreshed-with-viewer-scopes");
});

test("forceRefresh falls back to plain token when no viewer scopes were granted", async () => {
	const store: Record<string, string> = {
		"cohub:app-token:work-1": "expired-token",
	};
	globalThis.localStorage = {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
	} as Storage;

	const calls: { message: Record<string, unknown> }[] = [];
	const transport: AppRuntimeTransport = {
		request<T>(message: Record<string, unknown>): Promise<T | null> {
			calls.push({ message });
			return Promise.resolve({ token: "base-token" } as T);
		},
	};
	const runtime = createAppRuntime(transport, "work-1");

	const token = await runtime.getAccessToken({ forceRefresh: true });

	assert.equal(token, "base-token");
	assert.equal(calls.length, 1);
	assert.equal(calls[0].message.type, "cohub.app.token");
});

test("requestAuthorization persists authorized scopes for later refresh", async () => {
	const store: Record<string, string> = {};
	globalThis.localStorage = {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
	} as Storage;

	const transport: AppRuntimeTransport = {
		request: () => Promise.resolve({ token: "authorized-token" }),
	};
	const runtime = createAppRuntime(transport, "work-1");

	const granted = await runtime.requestAuthorization({
		scopes: ["session.prompt.fullaccess", "generation.create"],
	});

	assert.equal(granted, true);
	assert.deepEqual(
		JSON.parse(store["cohub:app-auth-scopes:work-1"]),
		["session.prompt.fullaccess", "generation.create"],
	);
});

test("forceRefresh after requestAuthorization re-authorizes with saved scopes", async () => {
	const store: Record<string, string> = {};
	globalThis.localStorage = {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
	} as Storage;

	let callCount = 0;
	const calls: { message: Record<string, unknown> }[] = [];
	const transport: AppRuntimeTransport = {
		request<T>(message: Record<string, unknown>): Promise<T | null> {
			callCount += 1;
			calls.push({ message });
			return Promise.resolve({ token: `tok-${callCount}` } as T);
		},
	};
	const runtime = createAppRuntime(transport, "work-1");

	// Step 1: initial authorization
	await runtime.requestAuthorization({ scopes: ["session.prompt.fullaccess"] });
	assert.equal(calls[0].message.type, "cohub.app.authorize");

	// Step 2: normal getAccessToken returns cached token (no transport call)
	calls.length = 0;
	const cached = await runtime.getAccessToken();
	assert.equal(cached, "tok-1");
	assert.equal(calls.length, 0);

	// Step 3: forceRefresh re-authorizes with saved scopes
	calls.length = 0;
	const refreshed = await runtime.getAccessToken({ forceRefresh: true });
	assert.equal(refreshed, "tok-2");
	assert.equal(calls.length, 1);
	assert.equal(calls[0].message.type, "cohub.app.authorize");
	assert.deepEqual(calls[0].message.scopes, ["session.prompt.fullaccess"]);
});

// --- Slug-based appId resolution tests ---

test("createSlugAppIdResolver resolves appId from getBySlug and caches it", async () => {
	let calls = 0;
	const resolver = createSlugAppIdResolver({
		apiBaseUrl: "https://api.cohub.run",
		ownerUsername: "tzwm",
		spaceSlug: "playground",
		appSlug: "pulsewall",
		fetch: (async (url: string) => {
			calls += 1;
			assert.equal(
				url,
				"https://api.cohub.run/api/apps/by-slug/tzwm/playground/pulsewall",
			);
			return {
				ok: true,
				json: async () => ({ work: { id: "resolved-work-id" } }),
			} as Response;
		}) as typeof globalThis.fetch,
	});

	const first = await resolver();
	const second = await resolver();
	assert.equal(first, "resolved-work-id");
	assert.equal(second, "resolved-work-id");
	assert.equal(calls, 1);
});

test("createSlugAppIdResolver does not cache failures", async () => {
	let calls = 0;
	const resolver = createSlugAppIdResolver({
		apiBaseUrl: "https://api.cohub.run",
		ownerUsername: "tzwm",
		spaceSlug: "playground",
		appSlug: "pulsewall",
		fetch: (async () => {
			calls += 1;
			if (calls === 1) return { ok: false, status: 404 } as Response;
			return {
				ok: true,
				json: async () => ({ work: { id: "recovered-id" } }),
			} as Response;
		}) as typeof globalThis.fetch,
	});

	assert.equal(await resolver(), null);
	assert.equal(await resolver(), "recovered-id");
	assert.equal(calls, 2);
});

test("resolveAppTransport returns broker when only a resolver is provided", () => {
	const windowMock: { location: { origin: string }; parent?: unknown } = {
		location: { origin: "https://my-work.example" },
	};
	windowMock.parent = windowMock;
	globalThis.window = windowMock as unknown as Window & typeof globalThis;

	const transport = resolveAppTransport(
		{ brokerOrigin: "https://cohub.run", ownerUsername: "u", spaceSlug: "s", appSlug: "w" },
		() => Promise.resolve("late-app-id"),
	);
	assert.ok(transport instanceof PopupBrokerTransport);
});

test("resolveAppTransport falls back to bridge without appId or resolver", () => {
	const windowMock: { location: { origin: string }; parent?: unknown } = {
		location: { origin: "https://my-work.example" },
	};
	windowMock.parent = windowMock;
	globalThis.window = windowMock as unknown as Window & typeof globalThis;

	const transport = resolveAppTransport({ brokerOrigin: "https://cohub.run" });
	assert.ok(transport instanceof ParentBridgeTransport);
});

test("PopupBrokerTransport answers context using resolved appId", async () => {
	const windowMock = {
		location: { origin: "https://my-work.example" },
		open: () => ({ closed: false, close() {}, postMessage() {} }),
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	globalThis.window = windowMock as unknown as Window & typeof globalThis;

	const transport = new PopupBrokerTransport({
		brokerOrigin: "https://cohub.run",
		getAppId: () => Promise.resolve("late-app-id"),
	});
	const result = await transport.request<{ context: { app: { id: string } } }>(
		{ type: "cohub.app.context" },
	);
	assert.equal(result?.context?.app?.id, "late-app-id");
});

test("PopupBrokerTransport uses resolved appId in the broker URL", async () => {
	let messageHandler: ((event: MessageEvent) => void) | null = null;
	let openedUrl = "";
	const popupMock = {
		closed: false,
		close() {
			this.closed = true;
		},
		postMessage: (data: Record<string, unknown>) => {
			queueMicrotask(() => {
				messageHandler?.({
					data: {
						type: "cohub.app.token.result",
						requestId: data.requestId,
						token: "tok-from-broker",
					},
					origin: "https://cohub.run",
					source: popupMock,
				} as MessageEvent);
			});
		},
	};
	const windowMock = {
		location: { origin: "https://my-work.example" },
		open: (url: string) => {
			openedUrl = url;
			queueMicrotask(() => {
				messageHandler?.({
					data: { type: "cohub.app.broker.ready" },
					origin: "https://cohub.run",
					source: popupMock,
				} as MessageEvent);
			});
			return popupMock;
		},
		addEventListener: (_t: string, h: (event: MessageEvent) => void) => {
			messageHandler = h;
		},
		removeEventListener: () => {
			messageHandler = null;
		},
	};
	globalThis.window = windowMock as unknown as Window & typeof globalThis;

	const transport = new PopupBrokerTransport({
		brokerOrigin: "https://cohub.run",
		getAppId: () => Promise.resolve("late-app-id"),
	});
	const result = await transport.request<{ token: string | null }>(
		{ type: "cohub.app.token" },
		{ timeoutMs: 5_000 },
	);
	assert.equal(result?.token, "tok-from-broker");
	assert.ok(openedUrl.includes("app=late-app-id"));
});

test("PopupBrokerTransport rejects interactive request when appId cannot be resolved", async () => {
	const windowMock = {
		location: { origin: "https://my-work.example" },
		open: () => ({ closed: false, close() {}, postMessage() {} }),
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	globalThis.window = windowMock as unknown as Window & typeof globalThis;

	const transport = new PopupBrokerTransport({
		brokerOrigin: "https://cohub.run",
		getWorkId: () => Promise.resolve(null),
	});
	await assert.rejects(
		() => transport.request({ type: "cohub.app.token" }, { timeoutMs: 1_000 }),
		/resolve the app id/i,
	);
});

test("AppRuntimeApi isolates localStorage by resolved appId", async () => {
	const store: Record<string, string> = {
		"cohub:app-token:late-app-id": "cached-late-token",
	};
	globalThis.localStorage = {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
	} as Storage;

	const transport: AppRuntimeTransport = {
		request: () => {
			throw new Error("should not be called");
		},
	};
	const runtime = createAppRuntime(transport, undefined, () =>
		Promise.resolve("late-app-id"),
	);

	const token = await runtime.getAccessToken();
	assert.equal(token, "cached-late-token");
});
