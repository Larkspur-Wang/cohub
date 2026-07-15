export type CaptureCapabilities = {
	displayMedia: boolean;
	elementCapture: boolean;
	cropTarget: boolean;
	/** Heuristic: iOS-like environments rarely allow useful iframe capture. */
	likelyMobileUnsupported: boolean;
};

type RestrictionTargetCtor = {
	fromElement: (element: Element) => Promise<unknown>;
};

type CropTargetCtor = {
	fromElement: (element: Element) => Promise<unknown>;
};

export function detectCaptureCapabilities(
	win: Window & typeof globalThis = window,
): CaptureCapabilities {
	const nav = win.navigator as Navigator & {
		mediaDevices?: MediaDevices;
		userAgent?: string;
		maxTouchPoints?: number;
	};
	const displayMedia = Boolean(nav.mediaDevices?.getDisplayMedia);
	const restriction = (
		win as unknown as { RestrictionTarget?: RestrictionTargetCtor }
	).RestrictionTarget;
	const crop = (win as unknown as { CropTarget?: CropTargetCtor }).CropTarget;
	const ua = nav.userAgent ?? "";
	const iOS =
		/iPad|iPhone|iPod/.test(ua) ||
		(nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
	const coarse =
		typeof win.matchMedia === "function" &&
		win.matchMedia("(hover: none) and (pointer: coarse)").matches;

	return {
		displayMedia,
		elementCapture: Boolean(displayMedia && restriction?.fromElement),
		cropTarget: Boolean(displayMedia && crop?.fromElement),
		likelyMobileUnsupported: iOS || (coarse && !displayMedia),
	};
}

export function iframeCaptureSupportedMessage(
	caps: CaptureCapabilities,
): string | null {
	if (caps.displayMedia) return null;
	if (caps.likelyMobileUnsupported) {
		return "Capture isn’t available in this browser. Open on desktop, or mark an image instead.";
	}
	return "Screen capture isn’t supported in this browser.";
}
