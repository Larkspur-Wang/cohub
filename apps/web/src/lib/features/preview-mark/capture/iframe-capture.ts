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

type ImageCaptureLike = {
	grabFrame: () => Promise<ImageBitmap>;
};

type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

type VideoWithFrameCallback = HTMLVideoElement & {
	requestVideoFrameCallback?: (callback: () => void) => number;
};

/** Keep frame grabs snappy — prefer fail-fast + fallback over long waits. */
const GRAB_TIMEOUT_MS = 6_000;
const PLAY_TIMEOUT_MS = 4_000;
const IMAGE_CAPTURE_TIMEOUT_MS = 1_500;
const TRACK_UNMUTE_TIMEOUT_MS = 800;

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

/**
 * Must be called in the same user-gesture turn as the click.
 * Do not await anything (or write reactive state) before this.
 */
export function requestDisplayMedia(): Promise<MediaStream> {
	return navigator.mediaDevices.getDisplayMedia({
		video: {
			frameRate: { ideal: 30 },
		},
		audio: false,
		// Chromium hints — ignored by browsers that don't support them.
		preferCurrentTab: true,
		selfBrowserSurface: "include",
		surfaceSwitching: "exclude",
		systemAudio: "exclude",
	} as DisplayMediaStreamOptions);
}

function mountHiddenVideo(): HTMLVideoElement {
	const video = document.createElement("video");
	video.playsInline = true;
	video.muted = true;
	video.autoplay = true;
	video.setAttribute("playsinline", "");
	video.setAttribute("muted", "");
	video.setAttribute("autoplay", "");
	// Keep it in the document so Chromium reliably decodes display-media streams.
	Object.assign(video.style, {
		position: "fixed",
		left: "-99999px",
		top: "0",
		width: "2px",
		height: "2px",
		opacity: "0",
		pointerEvents: "none",
	});
	document.documentElement.appendChild(video);
	return video;
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
	if (
		video.readyState >= HTMLMediaElement.HAVE_METADATA &&
		video.videoWidth > 0
	) {
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		const onMeta = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error("Capture video failed to load"));
		};
		const cleanup = () => {
			video.removeEventListener("loadedmetadata", onMeta);
			video.removeEventListener("error", onError);
		};
		video.addEventListener("loadedmetadata", onMeta);
		video.addEventListener("error", onError);
	});
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
	const withCallback = video as VideoWithFrameCallback;
	const rVFC = withCallback.requestVideoFrameCallback?.bind(withCallback);

	if (video.videoWidth > 0 && video.videoHeight > 0 && rVFC) {
		return new Promise((resolve) => {
			rVFC(() => resolve());
		});
	}

	return new Promise((resolve, reject) => {
		let attempts = 0;
		const tick = () => {
			if (video.videoWidth > 0 && video.videoHeight > 0) {
				if (rVFC) {
					rVFC(() => resolve());
				} else {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				}
				return;
			}
			attempts += 1;
			if (attempts > 120) {
				reject(new Error("Capture stream has no video frames"));
				return;
			}
			requestAnimationFrame(tick);
		};
		tick();
	});
}

async function waitForTrackLive(
	track: MediaStreamTrack,
	ms: number,
): Promise<void> {
	if (track.readyState !== "live") {
		throw new Error("Capture track ended");
	}
	// Display-media tracks often start muted until the first frame is painted.
	if (!track.muted) return;
	try {
		await withTimeout(
			new Promise<void>((resolve, reject) => {
				const onUnmute = () => {
					cleanup();
					resolve();
				};
				const onEnded = () => {
					cleanup();
					reject(new Error("Capture track ended"));
				};
				const cleanup = () => {
					track.removeEventListener("unmute", onUnmute);
					track.removeEventListener("ended", onEnded);
				};
				track.addEventListener("unmute", onUnmute);
				track.addEventListener("ended", onEnded);
				// Race: unmute may have already flipped between the check and listener.
				if (!track.muted) {
					cleanup();
					resolve();
				}
			}),
			ms,
			"Capture track",
		);
	} catch (error) {
		if (error instanceof Error && /timed out/i.test(error.message)) {
			// Still muted — try grab anyway; some browsers never unmute.
			return;
		}
		throw error;
	}
}

async function grabFrameViaImageCapture(
	track: MediaStreamTrack,
): Promise<{ bitmap: ImageBitmap; width: number; height: number } | null> {
	const ImageCapture = (
		window as unknown as { ImageCapture?: ImageCaptureCtor }
	).ImageCapture;
	if (!ImageCapture) return null;
	try {
		await waitForTrackLive(track, TRACK_UNMUTE_TIMEOUT_MS);
		const capture = new ImageCapture(track);
		const bitmap = await withTimeout(
			capture.grabFrame(),
			IMAGE_CAPTURE_TIMEOUT_MS,
			"Capture frame",
		);
		if (bitmap.width <= 0 || bitmap.height <= 0) {
			bitmap.close();
			return null;
		}
		return { bitmap, width: bitmap.width, height: bitmap.height };
	} catch {
		return null;
	}
}

async function grabFrameViaVideo(
	stream: MediaStream,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
	const video = mountHiddenVideo();
	try {
		video.srcObject = stream;
		await withTimeout(
			waitForMetadata(video),
			PLAY_TIMEOUT_MS,
			"Capture metadata",
		);

		// autoplay often starts muted display-media streams; only call play() if needed.
		if (video.paused) {
			await withTimeout(video.play(), PLAY_TIMEOUT_MS, "Capture playback");
		}

		await withTimeout(
			waitForVideoFrame(video),
			GRAB_TIMEOUT_MS,
			"Capture frame",
		);
		if (video.videoWidth <= 0 || video.videoHeight <= 0) {
			throw new Error("Capture stream has no video frames");
		}

		const bitmap = await createImageBitmap(video);
		return { bitmap, width: bitmap.width, height: bitmap.height };
	} finally {
		try {
			video.pause();
		} catch {
			// ignore
		}
		video.srcObject = null;
		video.remove();
	}
}

async function grabVideoFrame(
	stream: MediaStream,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
	const track = stream.getVideoTracks()[0];
	if (track) {
		const viaCapture = await grabFrameViaImageCapture(track);
		if (viaCapture) return viaCapture;
	}
	return grabFrameViaVideo(stream);
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

async function clearTrackTarget(track: ExtendedTrack): Promise<void> {
	if (track.restrictTo) {
		try {
			await track.restrictTo(null);
		} catch {
			// ignore — not all browsers accept null
		}
	}
	if (track.cropTo) {
		try {
			await track.cropTo(null);
		} catch {
			// ignore
		}
	}
}

function maybeGeometryCrop(
	bitmap: ImageBitmap,
	rect: DOMRect,
	quality: CaptureQuality,
): Promise<{
	bitmap: ImageBitmap;
	width: number;
	height: number;
	quality: CaptureQuality;
}> {
	const width = bitmap.width;
	const height = bitmap.height;
	if (quality !== "full") {
		return Promise.resolve({ bitmap, width, height, quality });
	}

	const dpr = window.devicePixelRatio || 1;
	const viewportW = Math.round(window.innerWidth * dpr);
	const viewportH = Math.round(window.innerHeight * dpr);
	const looksLikeCurrentTab =
		Math.abs(width - viewportW) / Math.max(width, viewportW) < 0.12 &&
		Math.abs(height - viewportH) / Math.max(height, viewportH) < 0.12;
	if (!looksLikeCurrentTab) {
		return Promise.resolve({ bitmap, width, height, quality });
	}

	const pixelRect = cssRectToPixelRect(rect, {
		dpr,
		frameWidth: width,
		frameHeight: height,
	});
	const areaRatio =
		(pixelRect.width * pixelRect.height) / Math.max(1, width * height);
	if (areaRatio >= 0.98 || pixelRect.width <= 8 || pixelRect.height <= 8) {
		return Promise.resolve({ bitmap, width, height, quality });
	}

	return cropBitmap(bitmap, pixelRect)
		.then((cropped) => {
			bitmap.close();
			return {
				bitmap: cropped,
				width: cropped.width,
				height: cropped.height,
				quality: "cropped-window" as const,
			};
		})
		.catch(() => ({ bitmap, width, height, quality }));
}

function captureFailureMessage(error: unknown): string {
	if (error instanceof Error && /timed out/i.test(error.message)) {
		return "Capture stalled after sharing. Prefer this tab, then try again.";
	}
	if (error instanceof Error && error.message) return error.message;
	return "Failed to capture preview.";
}

function mapCaptureError(error: unknown): CaptureResult {
	const name =
		error && typeof error === "object" && "name" in error
			? String((error as { name?: string }).name)
			: "";
	if (name === "NotAllowedError" || name === "PermissionDeniedError") {
		return {
			ok: false,
			reason: "permission-denied",
			message: "Capture cancelled or permission denied.",
		};
	}
	if (name === "NotSupportedError" || name === "NotFoundError") {
		return {
			ok: false,
			reason: "unsupported",
			message: "Screen capture isn’t supported in this browser.",
		};
	}
	if (name === "AbortError") {
		return {
			ok: false,
			reason: "permission-denied",
			message: "Capture cancelled.",
		};
	}
	return {
		ok: false,
		reason: "capture-failed",
		message: captureFailureMessage(error),
	};
}

/**
 * Capture an iframe preview from an already-granted display-media stream.
 * Call {@link requestDisplayMedia} first in the click gesture turn.
 */
export async function captureIframeElementFromStream(input: {
	stream: MediaStream;
	element: HTMLIFrameElement;
	source: Extract<FrameSource, { kind: "html" | "port" }>;
}): Promise<CaptureResult> {
	let stream: MediaStream | null = input.stream;
	const readyRect = input.element.getBoundingClientRect();
	if (readyRect.width < 2 || readyRect.height < 2) {
		stopStream(stream);
		return {
			ok: false,
			reason: "iframe-not-ready",
			message: "Preview isn’t ready to capture yet.",
		};
	}

	try {
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

		// Re-measure after the picker closes — layout can shift while sharing.
		const rect = input.element.getBoundingClientRect();

		let quality: CaptureQuality = "full";
		let usedElementTarget = false;
		if (await tryRestrictToElement(track, input.element)) {
			quality = "element";
			usedElementTarget = true;
		} else if (await tryCropToElement(track, input.element)) {
			quality = "region";
			usedElementTarget = true;
		}

		// Element / region capture needs a compositor beat before frames arrive.
		if (usedElementTarget) await waitFrame();

		let grabbed: { bitmap: ImageBitmap; width: number; height: number };
		try {
			grabbed = await grabVideoFrame(stream);
		} catch (firstError) {
			// Element Capture can succeed then stall; fall back to full tab + crop.
			if (!usedElementTarget) throw firstError;
			await clearTrackTarget(track);
			quality = "full";
			await waitFrame();
			grabbed = await grabVideoFrame(stream);
		}

		stopStream(stream);
		stream = null;

		const cropRect = rect.width >= 2 && rect.height >= 2 ? rect : readyRect;
		const cropped = await maybeGeometryCrop(grabbed.bitmap, cropRect, quality);
		const frame: FrozenFrame = {
			bitmap: cropped.bitmap,
			width: cropped.width,
			height: cropped.height,
			dpr: window.devicePixelRatio || 1,
			capturedAt: Date.now(),
			quality: cropped.quality,
			source: input.source,
		};
		return { ok: true, frame };
	} catch (error) {
		stopStream(stream);
		return mapCaptureError(error);
	}
}

export async function captureIframeElement(input: {
	element: HTMLIFrameElement;
	source: Extract<FrameSource, { kind: "html" | "port" }>;
	/** Pre-started stream from {@link requestDisplayMedia} (preferred). */
	stream?: MediaStream;
}): Promise<CaptureResult> {
	const caps = detectCaptureCapabilities();
	const unsupported = iframeCaptureSupportedMessage(caps);
	if (unsupported) {
		return { ok: false, reason: "unsupported", message: unsupported };
	}

	const readyRect = input.element.getBoundingClientRect();
	if (readyRect.width < 2 || readyRect.height < 2) {
		return {
			ok: false,
			reason: "iframe-not-ready",
			message: "Preview isn’t ready to capture yet.",
		};
	}

	let stream: MediaStream | null = input.stream ?? null;
	try {
		if (!stream) {
			// Fallback path — may fail if not in a user-gesture turn.
			stream = await requestDisplayMedia();
		}
		return await captureIframeElementFromStream({
			stream,
			element: input.element,
			source: input.source,
		});
	} catch (error) {
		stopStream(stream);
		return mapCaptureError(error);
	}
}
