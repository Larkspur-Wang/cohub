import {
	APP_SURFACE_READY_TIMEOUT_MS,
	APP_SURFACE_REQUEST_TIMEOUT_MS,
	type AppComposerChip,
	buildAppSurfaceRequest,
	parseAppComposerChipClear,
	parseAppComposerChipSet,
	parseAppSurfaceReady,
	parseAppSurfaceResponse,
} from "@cohub/protocol/app-surface";

export type AppSurfaceCallResult =
	| { ok: true }
	| { ok: false; code: string; message: string };

export type AppSurfaceHostConfig = {
	getFrame: () => HTMLIFrameElement | null;
	getFrameOrigin: () => string | null;
	onComposerChip?: (chip: AppComposerChip | null) => void;
};

export type AppSurfaceHost = {
	readonly methods: string[];
	readonly ready: boolean;
	handleMessage: (event: MessageEvent) => boolean;
	call: (input: {
		method: string;
		input?: unknown;
		commandId: string;
		readyTimeoutMs?: number;
		requestTimeoutMs?: number;
	}) => Promise<AppSurfaceCallResult>;
	reset: () => void;
	dispose: () => void;
};

export function createAppSurfaceHost(
	config: AppSurfaceHostConfig,
): AppSurfaceHost {
	let ready = false;
	let methods: string[] = [];
	let composerChip: AppComposerChip | null = null;
	const pending = new Map<string, (result: AppSurfaceCallResult) => void>();
	let readyWaiters: Array<(becameReady: boolean) => void> = [];
	let epoch = 0;

	function isFromSurface(event: MessageEvent) {
		const frame = config.getFrame();
		if (!frame || event.source !== frame.contentWindow) return false;
		const origin = config.getFrameOrigin();
		return Boolean(origin) && event.origin === origin;
	}

	function flushReadyWaiters(becameReady: boolean) {
		const waiters = readyWaiters;
		readyWaiters = [];
		for (const settle of waiters) settle(becameReady);
	}

	function markReady(nextMethods: string[]) {
		ready = true;
		methods = nextMethods;
		flushReadyWaiters(true);
	}

	function handleMessage(event: MessageEvent): boolean {
		if (!isFromSurface(event)) return false;

		const readyMessage = parseAppSurfaceReady(event.data);
		if (readyMessage) {
			markReady(readyMessage.methods);
			return true;
		}

		const chipSet = parseAppComposerChipSet(event.data);
		if (chipSet) {
			composerChip = chipSet.chip;
			config.onComposerChip?.(composerChip);
			return true;
		}

		const chipClear = parseAppComposerChipClear(event.data);
		if (chipClear) {
			if (composerChip?.key === chipClear.key) {
				composerChip = null;
				config.onComposerChip?.(null);
			}
			return true;
		}

		const response = parseAppSurfaceResponse(event.data);
		if (!response) return false;
		const settle = pending.get(response.requestId);
		if (!settle) return true;
		pending.delete(response.requestId);
		settle(
			response.ok
				? { ok: true }
				: {
						ok: false,
						code: response.error?.code ?? "surface_error",
						message: response.error?.message ?? "Work surface call failed",
					},
		);
		return true;
	}

	function waitForReady(timeoutMs: number): Promise<boolean> {
		if (ready) return Promise.resolve(true);
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				readyWaiters = readyWaiters.filter((waiter) => waiter !== onReady);
				resolve(false);
			}, timeoutMs);
			const onReady = (becameReady: boolean) => {
				clearTimeout(timer);
				resolve(becameReady);
			};
			readyWaiters.push(onReady);
		});
	}

	async function call(input: {
		method: string;
		input?: unknown;
		commandId: string;
		readyTimeoutMs?: number;
		requestTimeoutMs?: number;
	}): Promise<AppSurfaceCallResult> {
		const frame = config.getFrame();
		const origin = config.getFrameOrigin();
		if (!frame?.contentWindow || !origin) {
			return {
				ok: false,
				code: "surface_unavailable",
				message: "The Work surface is not mounted.",
			};
		}

		const callEpoch = epoch;
		const becameReady = await waitForReady(
			input.readyTimeoutMs ?? APP_SURFACE_READY_TIMEOUT_MS,
		);
		if (callEpoch !== epoch) {
			return {
				ok: false,
				code: "surface_reset",
				message: "The Work surface reloaded before answering.",
			};
		}
		if (!becameReady) {
			return {
				ok: false,
				code: "surface_not_ready",
				message:
					"This app did not register any callable methods. Use client.app.surface.handle() inside the app.",
			};
		}
		if (methods.length > 0 && !methods.includes(input.method)) {
			return {
				ok: false,
				code: "method_not_found",
				message: `This Work exposes: ${methods.join(", ")}.`,
			};
		}

		const requestId =
			globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
		const timeoutMs = input.requestTimeoutMs ?? APP_SURFACE_REQUEST_TIMEOUT_MS;
		return new Promise<AppSurfaceCallResult>((resolve) => {
			const timer = setTimeout(() => {
				pending.delete(requestId);
				resolve({
					ok: false,
					code: "surface_timeout",
					message: `The Work did not answer "${input.method}" in time.`,
				});
			}, timeoutMs);
			pending.set(requestId, (result) => {
				clearTimeout(timer);
				resolve(result);
			});
			try {
				frame.contentWindow?.postMessage(
					buildAppSurfaceRequest({
						requestId,
						method: input.method,
						...(input.input === undefined ? {} : { input: input.input }),
						commandId: input.commandId,
					}),
					origin,
				);
			} catch (error) {
				clearTimeout(timer);
				pending.delete(requestId);
				resolve({
					ok: false,
					code: "surface_unavailable",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	function reset() {
		epoch += 1;
		ready = false;
		methods = [];
		if (composerChip) {
			composerChip = null;
			config.onComposerChip?.(null);
		}
		for (const settle of pending.values()) {
			settle({
				ok: false,
				code: "surface_reset",
				message: "The Work surface reloaded before answering.",
			});
		}
		pending.clear();
		flushReadyWaiters(false);
	}

	return {
		get methods() {
			return methods;
		},
		get ready() {
			return ready;
		},
		handleMessage,
		call,
		reset,
		dispose: reset,
	};
}
