export { attachComposerFiles } from "./attach/to-composer";
export {
	detectCaptureCapabilities,
	iframeCaptureSupportedMessage,
} from "./capture/capabilities";
export {
	captureIframeElement,
	captureIframeElementFromStream,
	requestDisplayMedia,
} from "./capture/iframe-capture";
export { captureImageSource } from "./capture/image-capture";
export { exportMarkedFrame } from "./mark/export";
export { createMarkSession, type MarkSession } from "./mark/session.svelte";
export {
	type CaptureResult,
	type FrameSource,
	type FrozenFrame,
	type MarkColor,
	type MarkTool,
	type PreviewCaptureTarget,
	type Stroke,
	suggestedMarkedName,
} from "./types";
