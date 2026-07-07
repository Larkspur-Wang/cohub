import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
	createWorkRuntime,
	ParentBridgeTransport,
	PopupBrokerTransport,
	resolveWorkTransport,
	type WorkRuntimeTransport,
} from "../src/work-runtime.js";

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
						type: "cohub.work.context.result",
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

	const context = await createWorkRuntime().context();

	assert.equal(targetOrigin, "https://cohub.run");
	assert.equal(context?.space.id, "space-1");
});

test("WorkRuntimeApi delegates to the injected transport", async () => {
	const calls: { message: Record<string, unknown>; options?: object }[] = [];
	const transport: WorkRuntimeTransport = {
		request<T>(message, options) {
			calls.push({ message, options });
			return Promise.resolve(null as T);
		},
	};
	const runtime = createWorkRuntime(transport);

	await runtime.context();
	await runtime.getAccessToken();
	await runtime.requestAuthorization({ scopes: ["file.view"] });
	await runtime.purchase({ productKey: "pro-1" });
	await runtime.checkoutState();

	assert.equal(calls.length, 5);
	assert.deepEqual(calls[0].message, { type: "cohub.work.context" });
	assert.deepEqual(calls[0].options, { timeoutMs: 8_000, retryIntervalMs: 250 });
	assert.deepEqual(calls[1].message, {
		type: "cohub.work.token",
		forceRefresh: false,
	});
	assert.deepEqual(calls[1].options, { timeoutMs: 20_000 });
	assert.deepEqual(calls[2].message, {
		type: "cohub.work.authorize",
		scopes: ["file.view"],
		reason: undefined,
	});
	assert.deepEqual(calls[3].message, {
		type: "cohub.work.purchase",
		productKey: "pro-1",
	});
	assert.deepEqual(calls[4].options, { timeoutMs: 8_000, retryIntervalMs: 250 });
});

test("WorkRuntimeApi caches the access token across calls", async () => {
	const transport: WorkRuntimeTransport = {
		request: () => Promise.resolve({ token: "tok-1" }),
	};
	const runtime = createWorkRuntime(transport);

	const first = await runtime.getAccessToken();
	const second = await runtime.getAccessToken();

	assert.equal(first, "tok-1");
	assert.equal(second, "tok-1");
});

test("requestAuthorization returns false when no token is granted", async () => {
	const transport: WorkRuntimeTransport = {
		request: () => Promise.resolve({ token: null }),
	};
	const runtime = createWorkRuntime(transport);

	const granted = await runtime.requestAuthorization({
		scopes: ["file.view"],
	});

	assert.equal(granted, false);
});

test("createWorkRuntime defaults to the parent bridge transport", async () => {
	// Without a browser parent window the bridge transport resolves to null
	// rather than throwing — proving the default is ParentBridgeTransport.
	const runtime = createWorkRuntime();
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
		workId: "work-1",
	});
	const result = await transport.request<{ context: { work: { id: string } } }>(
		{ type: "cohub.work.context" },
	);

	assert.equal(opened, false);
	assert.equal(result?.context?.work?.id, "work-1");
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
		workId: "work-1",
	});
	const result = await transport.request<{ status: string | null }>(
		{ type: "cohub.work.checkout-state" },
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
		workId: "work-1",
	});

	await assert.rejects(
		() => transport.request({ type: "cohub.work.token" }, { timeoutMs: 1_000 }),
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
						type: "cohub.work.token.result",
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
					data: { type: "cohub.work.broker.ready" },
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
		workId: "work-1",
	});

	const result = await transport.request<{ token: string | null }>(
		{ type: "cohub.work.token" },
		{ timeoutMs: 5_000 },
	);

	assert.equal(result?.token, "broker-token-123");
	// The popup should have been closed after receiving the response.
	assert.equal(popupMock.closed, true);
	// The request should have been sent to the broker with the correct targetOrigin.
	assert.equal(postedToPopup?.origin, "https://cohub.run");
});

// --- resolveWorkTransport tests ---

test("resolveWorkTransport defaults to bridge when no config given", () => {
	const transport = resolveWorkTransport();
	assert.ok(transport instanceof ParentBridgeTransport);
});

test("resolveWorkTransport returns broker when explicitly configured", () => {
	const transport = resolveWorkTransport({
		mode: "broker",
		brokerOrigin: "https://cohub.run",
		workId: "work-1",
	});
	assert.ok(transport instanceof PopupBrokerTransport);
});

test("resolveWorkTransport falls back to bridge when broker config is incomplete", () => {
	const transport = resolveWorkTransport({ mode: "broker", brokerOrigin: "https://cohub.run" });
	assert.ok(transport instanceof ParentBridgeTransport);
});

test("resolveWorkTransport auto-detects bridge inside an iframe", () => {
	globalThis.window = {
		parent: {} as Window,
	} as unknown as Window & typeof globalThis;
	const transport = resolveWorkTransport();
	assert.ok(transport instanceof ParentBridgeTransport);
});

test("resolveWorkTransport auto-detects broker when standalone with config", () => {
	const windowMock = {
		location: { origin: "https://my-work.example" },
	};
	// parent === self → not inside an iframe → standalone
	windowMock.parent = windowMock as unknown as Window;
	globalThis.window = windowMock as unknown as Window & typeof globalThis;
	const transport = resolveWorkTransport({
		brokerOrigin: "https://cohub.run",
		workId: "work-1",
	});
	assert.ok(transport instanceof PopupBrokerTransport);
});

// --- Token persistence tests ---

test("WorkRuntimeApi persists token to localStorage when workId is provided", async () => {
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

	const transport: WorkRuntimeTransport = {
		request: () => Promise.resolve({ token: "persisted-token" }),
	};
	const runtime = createWorkRuntime(transport, "work-1");

	const token = await runtime.getAccessToken();
	assert.equal(token, "persisted-token");
	assert.equal(store["cohub:work-token:work-1"], "persisted-token");
});

test("WorkRuntimeApi restores token from localStorage on construction", async () => {
	const store: Record<string, string> = {
		"cohub:work-token:work-1": "cached-token",
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
	const transport: WorkRuntimeTransport = {
		request: () => {
			throw new Error("should not be called");
		},
	};
	const runtime = createWorkRuntime(transport, "work-1");

	const token = await runtime.getAccessToken();
	assert.equal(token, "cached-token");
});

test("WorkRuntimeApi clears stored token on forceRefresh", async () => {
	const store: Record<string, string> = {
		"cohub:work-token:work-1": "old-token",
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

	const transport: WorkRuntimeTransport = {
		request: () => Promise.resolve({ token: "fresh-token" }),
	};
	const runtime = createWorkRuntime(transport, "work-1");

	const token = await runtime.getAccessToken({ forceRefresh: true });
	assert.equal(token, "fresh-token");
	assert.equal(store["cohub:work-token:work-1"], "fresh-token");
});
