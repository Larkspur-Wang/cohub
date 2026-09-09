export const APP_RUNTIME_PROTOCOL = "cohub.app.runtime";
export const APP_RUNTIME_VERSION = 1;

type RuntimeEnvelope = {
	protocol: typeof APP_RUNTIME_PROTOCOL;
	version: typeof APP_RUNTIME_VERSION;
};

export type AppRuntimeReadyMessage = RuntimeEnvelope & {
	type: "ready";
};

/** The App asks its host to close the surface it runs in. */
export type AppRuntimeCloseRequestMessage = RuntimeEnvelope & {
	type: "close.request";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value && typeof value === "object" && !Array.isArray(value));

export const parseAppRuntimeReady = (
	value: unknown,
): AppRuntimeReadyMessage | null => {
	if (
		!isRecord(value) ||
		value.protocol !== APP_RUNTIME_PROTOCOL ||
		value.version !== APP_RUNTIME_VERSION ||
		value.type !== "ready"
	) {
		return null;
	}
	return {
		protocol: APP_RUNTIME_PROTOCOL,
		version: APP_RUNTIME_VERSION,
		type: "ready",
	};
};

export const buildAppRuntimeReady = (): AppRuntimeReadyMessage => ({
	protocol: APP_RUNTIME_PROTOCOL,
	version: APP_RUNTIME_VERSION,
	type: "ready",
});

export const parseAppRuntimeCloseRequest = (
	value: unknown,
): AppRuntimeCloseRequestMessage | null => {
	if (
		!isRecord(value) ||
		value.protocol !== APP_RUNTIME_PROTOCOL ||
		value.version !== APP_RUNTIME_VERSION ||
		value.type !== "close.request"
	) {
		return null;
	}
	return {
		protocol: APP_RUNTIME_PROTOCOL,
		version: APP_RUNTIME_VERSION,
		type: "close.request",
	};
};

export const buildAppRuntimeCloseRequest = (): AppRuntimeCloseRequestMessage => ({
	protocol: APP_RUNTIME_PROTOCOL,
	version: APP_RUNTIME_VERSION,
	type: "close.request",
});

// ── Overlay geometry ─────────────────────────────────────────────────────────

/**
 * An axis-aligned rectangle in CSS pixels relative to the overlay's own
 * viewport (top-left origin).  Used to describe pointer-event hit regions.
 */
export type AppRuntimeRect = { x: number; y: number; width: number; height: number };

/**
 * Anchor edge(s) used when the overlay requests a specific screen position.
 * Corresponds to the `anchor` in CSS anchor-positioning:
 * `"top-left"` means the overlay's top-left corner is at (x, y).
 */
export type AppRuntimeAnchor =
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right"
	| "center";

/**
 * The App requests that its host update the overlay's geometry or pointer
 * hit regions.  Only meaningful for overlay surfaces; the host is free to
 * clamp or ignore values that would violate its layout policy.
 *
 * Absent fields are left unchanged.  Sending an empty message is a no-op.
 */
export type AppRuntimeConfigureRequest = RuntimeEnvelope & {
	type: "configure.request";
	/**
	 * Desired position and size in CSS pixels relative to the host viewport.
	 * The host may clamp to keep the overlay on-screen.
	 */
	geometry?: {
		/** Corner to anchor the (x, y) coordinate to.  Defaults to `"top-left"`. */
		anchor?: AppRuntimeAnchor;
		x?: number;
		y?: number;
		width?: number;
		height?: number;
	};
	/**
	 * Rectangles inside the overlay that should receive pointer events.
	 * `"all"` makes the entire overlay interactive; `"none"` (default for
	 * overlays) makes it fully transparent to pointer events.  An explicit
	 * rect array lets the App define arbitrary hit regions.
	 */
	inputRegion?: "all" | "none" | AppRuntimeRect[];
};

export const parseAppRuntimeConfigureRequest = (
	value: unknown,
): AppRuntimeConfigureRequest | null => {
	if (
		!isRecord(value) ||
		value.protocol !== APP_RUNTIME_PROTOCOL ||
		value.version !== APP_RUNTIME_VERSION ||
		value.type !== "configure.request"
	) {
		return null;
	}

	const msg: AppRuntimeConfigureRequest = {
		protocol: APP_RUNTIME_PROTOCOL,
		version: APP_RUNTIME_VERSION,
		type: "configure.request",
	};

	if (isRecord(value.geometry)) {
		const g = value.geometry;
		const validAnchors: AppRuntimeAnchor[] = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];
		msg.geometry = {
			...(validAnchors.includes(g.anchor as AppRuntimeAnchor) ? { anchor: g.anchor as AppRuntimeAnchor } : {}),
			...(typeof g.x === "number" && Number.isFinite(g.x) ? { x: g.x } : {}),
			...(typeof g.y === "number" && Number.isFinite(g.y) ? { y: g.y } : {}),
			...(typeof g.width === "number" && Number.isFinite(g.width) && g.width > 0 ? { width: g.width } : {}),
			...(typeof g.height === "number" && Number.isFinite(g.height) && g.height > 0 ? { height: g.height } : {}),
		};
	}

	if (value.inputRegion === "all" || value.inputRegion === "none") {
		msg.inputRegion = value.inputRegion;
	} else if (Array.isArray(value.inputRegion)) {
		const rects = value.inputRegion.filter(isRecord).flatMap((r) => {
			if (
				typeof r.x === "number" && Number.isFinite(r.x) &&
				typeof r.y === "number" && Number.isFinite(r.y) &&
				typeof r.width === "number" && Number.isFinite(r.width) && r.width > 0 &&
				typeof r.height === "number" && Number.isFinite(r.height) && r.height > 0
			) {
				return [{ x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number }];
			}
			return [];
		});
		msg.inputRegion = rects;
	}

	return msg;
};

export const buildAppRuntimeConfigureRequest = (
	input: Omit<AppRuntimeConfigureRequest, keyof RuntimeEnvelope | "type">,
): AppRuntimeConfigureRequest => ({
	protocol: APP_RUNTIME_PROTOCOL,
	version: APP_RUNTIME_VERSION,
	type: "configure.request",
	...input,
});
