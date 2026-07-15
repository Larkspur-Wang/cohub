import type {
	CaptureQuality,
	CaptureResult,
	FrameSource,
	FrozenFrame,
} from "../types";
import {
	detectCaptureCapabilities,
	iframeCaptureSupportedMessage,
} from "./capabilities";
import { cssRectToPixelRect } from "./geometry";

type RestrictionTargetLike = {
	fromElement: (element: Element) => Promise<unknown>;
};

type CropTargetLike = {
	fromElement: (element: Element) => Promise<unknown>;
};

type ExtendedTrack = MediaStreamTrack & {
	restrictTo?: (target: unknown) => Promise<void>;
	cropTo?: (target: unknown) => Promise<void>;
};

function waitFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`${label} timed out`));
		}, ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function stopStream(stream: MediaStream | null) {
	if (!stream) return;
	for (const track of stream.getTracks()) track.stop();
}

async function grabVideoFrame(
	stream: MediaStream,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
	const video = document.createElement("video");
	video.playsInline = true;
	video.muted = true;
	video.srcObject = stream;
	await withTimeout(video.play(), 8_000, "Capture playback");
	// Wait until dimensions are available.
	for (let i = 0; i < 45; i++) {
		if (video.videoWidth > 0 && video.videoHeight > 0) break;
		await waitFrame();
	}
	if (video.videoWidth <= 0 || video.videoHeight <= 0) {
		throw new Error("Capture stream has no video frames");
	}
	await waitFrame();
	const bitmap = await createImageBitmap(video);
	video.pause();
	video.srcObject = null;
	return { bitmap, width: bitmap.width, height: bitmap.height };
}

async function cropBitmap(
	bitmap: ImageBitmap,
	rect: { x: number; y: number; width: number; height: number },
): Promise<ImageBitmap> {
	return createImageBitmap(bitmap, rect.x, rect.y, rect.width, rect.height);
}

async function tryRestrictToElement(
	track: ExtendedTrack,
	element: Element,
): Promise<boolean> {
	const RestrictionTarget = (
		window as unknown as { RestrictionTarget?: RestrictionTargetLike }
	).RestrictionTarget;
	if (!RestrictionTarget?.fromElement || !track.restrictTo) return false;
	try {
		const target = await RestrictionTarget.fromElement(element);
		await track.restrictTo(target);
		return true;
	} catch {
		return false;
	}
}

async function tryCropToElement(
	track: ExtendedTrack,
	element: Element,
): Promise<boolean> {
	const CropTarget = (window as unknown as { CropTarget?: CropTargetLike })
		.CropTarget;
	if (!CropTarget?.fromElement || !track.cropTo) return false;
	try {
		const target = await CropTarget.fromElement(element);
		await track.cropTo(target);
		return true;
	} catch {
		return false;
	}
}

export async function captureIframeElement(input: {
	element: HTMLIFrameElement;
	source: Extract<FrameSource, { kind: "html" | "port" }>;
}): Promise<CaptureResult> {
	const caps = detectCaptureCapabilities();
	const unsupported = iframeCaptureSupportedMessage(caps);
	if (unsupported) {
		return { ok: false, reason: "unsupported", message: unsupported };
	}

	const rect = input.element.getBoundingClientRect();
	if (rect.width < 2 || rect.height < 2) {
		return {
			ok: false,
			reason: "iframe-not-ready",
			message: "Preview isn’t ready to capture yet.",
		};
	}

	let stream: MediaStream | null = null;
	try {
		await waitFrame();
		stream = await withTimeout(
			navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: false,
				// Chromium hints — ignored by browsers that don't support them.
				preferCurrentTab: true,
				selfBrowserSurface: "include",
				surfaceSwitching: "exclude",
				systemAudio: "exclude",
			} as DisplayMediaStreamOptions),
			60_000,
			"Screen capture",
		);

		const track = stream.getVideoTracks()[0] as ExtendedTrack | undefined;
		if (!track) {
			stopStream(stream);
			stream = null;
			return {
				ok: false,
				reason: "capture-failed",
				message: "No video track from screen capture.",
			};
		}

		let quality: CaptureQuality = "full";
		if (await tryRestrictToElement(track, input.element)) {
			quality = "element";
		} else if (await tryCropToElement(track, input.element)) {
			quality = "region";
		}

		const grabbed = await withTimeout(
			grabVideoFrame(stream),
			10_000,
			"Capture frame",
		);
		stopStream(stream);
		stream = null;

		let bitmap = grabbed.bitmap;
		let width = grabbed.width;
		let height = grabbed.height;

		// Geometry crop only when the frame looks like the current tab viewport.
		// If the user shared another window/screen, keep the full frame for manual crop.
		if (quality === "full") {
			const dpr = window.devicePixelRatio || 1;
			const viewportW = Math.round(window.innerWidth * dpr);
			const viewportH = Math.round(window.innerHeight * dpr);
			const looksLikeCurrentTab =
				Math.abs(width - viewportW) / Math.max(width, viewportW) < 0.12 &&
				Math.abs(height - viewportH) / Math.max(height, viewportH) < 0.12;
			if (looksLikeCurrentTab) {
				const pixelRect = cssRectToPixelRect(rect, {
					dpr,
					frameWidth: width,
					frameHeight: height,
				});
				const areaRatio =
					(pixelRect.width * pixelRect.height) / Math.max(1, width * height);
				if (areaRatio < 0.98 && pixelRect.width > 8 && pixelRect.height > 8) {
					try {
						const cropped = await cropBitmap(bitmap, pixelRect);
						bitmap.close();
						bitmap = cropped;
						width = cropped.width;
						height = cropped.height;
						quality = "cropped-window";
					} catch {
						// Keep full frame — user can crop in the mark UI.
					}
				}
			}
		}

		const frame: FrozenFrame = {
			bitmap,
			width,
			height,
			dpr: window.devicePixelRatio || 1,
			capturedAt: Date.now(),
			quality,
			source: input.source,
		};
		return { ok: true, frame };
	} catch (error) {
		stopStream(stream);
		const name =
			error && typeof error === "object" && "name" in error
				? String((error as { name?: string }).name)
				: "";
		if (name === "NotAllowedError" || name === "PermissionDeniedError") {
			return {
				ok: false,
				reason: "permission-denied",
				message: "Capture permission denied. Try again when ready.",
			};
		}
		if (name === "NotSupportedError") {
			return {
				ok: false,
				reason: "unsupported",
				message: "Screen capture isn’t supported in this browser.",
			};
		}
		return {
			ok: false,
			reason: "capture-failed",
			message:
				error instanceof Error ? error.message : "Failed to capture preview.",
		};
	}
}
