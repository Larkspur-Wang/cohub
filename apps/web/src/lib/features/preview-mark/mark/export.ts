import type { FrozenFrame, Stroke } from "../types";
import { drawStroke } from "./draw";

const OUTPUT_FORMATS: Array<{
	mimeType: "image/webp" | "image/jpeg";
	extension: "webp" | "jpg";
	quality: number;
}> = [
	{ mimeType: "image/webp", extension: "webp", quality: 0.9 },
	{ mimeType: "image/jpeg", extension: "jpg", quality: 0.9 },
];

const MAX_EDGE = 2560;

function canvasToBlob(
	canvas: HTMLCanvasElement,
	mimeType: string,
	quality: number,
): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

export async function exportMarkedFrame(input: {
	frame: FrozenFrame;
	strokes: Stroke[];
	filename: string;
}): Promise<File> {
	const longest = Math.max(input.frame.width, input.frame.height);
	const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
	const width = Math.max(1, Math.round(input.frame.width * scale));
	const height = Math.max(1, Math.round(input.frame.height * scale));

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas is not available.");

	ctx.drawImage(input.frame.bitmap, 0, 0, width, height);
	for (const stroke of input.strokes) {
		drawStroke(ctx, stroke, { scale });
	}

	for (const format of OUTPUT_FORMATS) {
		const blob = await canvasToBlob(canvas, format.mimeType, format.quality);
		if (!blob || blob.type !== format.mimeType) continue;
		const base = input.filename.replace(/\.[^.]+$/, "") || "preview-marked";
		return new File([blob], `${base}.${format.extension}`, {
			type: format.mimeType,
			lastModified: Date.now(),
		});
	}
	throw new Error("Failed to encode marked image.");
}
