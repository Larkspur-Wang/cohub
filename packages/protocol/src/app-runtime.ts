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

/** Axis-aligned rectangle in CSS pixels, overlay-local (top-left origin). */
export type AppRuntimeRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/** Which corner of the overlay `geometry.x` / `geometry.y` are measured from. */
export type AppRuntimeAnchor =
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right"
	| "center";

/**
 * The App asks its overlay host to change where it sits or where it accepts
 * pointer events. The host clamps geometry to the viewport. Absent fields keep
 * their current value; an axis without a size fills the layer.
 *
 * `inputRegion`: `"none"` (default) makes the overlay click-through, `"all"`
 * makes it fully interactive, and a rect list limits interaction to those
 * overlay-local rectangles.
 */
export type AppRuntimeConfigureRequest = RuntimeEnvelope & {
	type: "configure.request";
	geometry?: {
		anchor?: AppRuntimeAnchor;
		x?: number;
		y?: number;
		width?: number;
		height?: number;
	};
	inputRegion?: "all" | "none" | AppRuntimeRect[];
};

const ANCHORS: readonly AppRuntimeAnchor[] = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
	"center",
];

const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const positive = (value: unknown): value is number => finite(value) && value > 0;

const parseRect = (value: unknown): AppRuntimeRect | null =>
	isRecord(value) &&
	finite(value.x) &&
	finite(value.y) &&
	positive(value.width) &&
	positive(value.height)
		? { x: value.x, y: value.y, width: value.width, height: value.height }
		: null;

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
	const message: AppRuntimeConfigureRequest = {
		protocol: APP_RUNTIME_PROTOCOL,
		version: APP_RUNTIME_VERSION,
		type: "configure.request",
	};
	if (isRecord(value.geometry)) {
		const { anchor, x, y, width, height } = value.geometry;
		message.geometry = {
			...(ANCHORS.includes(anchor as AppRuntimeAnchor)
				? { anchor: anchor as AppRuntimeAnchor }
				: {}),
			...(finite(x) ? { x } : {}),
			...(finite(y) ? { y } : {}),
			...(positive(width) ? { width } : {}),
			...(positive(height) ? { height } : {}),
		};
	}
	if (value.inputRegion === "all" || value.inputRegion === "none") {
		message.inputRegion = value.inputRegion;
	} else if (Array.isArray(value.inputRegion)) {
		message.inputRegion = value.inputRegion
			.map(parseRect)
			.filter((rect): rect is AppRuntimeRect => rect !== null);
	}
	return message;
};

export const buildAppRuntimeConfigureRequest = (
	input: Omit<AppRuntimeConfigureRequest, keyof RuntimeEnvelope | "type">,
): AppRuntimeConfigureRequest => ({
	protocol: APP_RUNTIME_PROTOCOL,
	version: APP_RUNTIME_VERSION,
	type: "configure.request",
	...input,
});
