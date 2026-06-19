import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createWorkRuntime } from "../src/work-runtime.js";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

afterEach(() => {
	globalThis.window = originalWindow;
	globalThis.document = originalDocument;
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
