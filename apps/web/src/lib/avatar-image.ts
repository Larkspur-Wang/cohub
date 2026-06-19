export type AvatarUploadMimeType = "image/webp" | "image/jpeg";

export type NormalizedAvatarImage = {
	file: File;
	mimeType: AvatarUploadMimeType;
	extension: "webp" | "jpg";
};

const AVATAR_SIZE = 1024;
const WEBP_QUALITY = 0.86;
const JPEG_QUALITY = 0.88;
const INPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const OUTPUT_FORMATS: Array<{
	mimeType: AvatarUploadMimeType;
	extension: "webp" | "jpg";
	quality: number;
}> = [
	{ mimeType: "image/webp", extension: "webp", quality: WEBP_QUALITY },
	{ mimeType: "image/jpeg", extension: "jpg", quality: JPEG_QUALITY },
];

export function assertAvatarInputFile(file: File) {
	if (!INPUT_TYPES.has(file.type)) {
		throw new Error("Please choose a JPEG, PNG, or WebP image.");
	}
}

async function canvasToBlob(
	canvas: HTMLCanvasElement,
	mimeType: AvatarUploadMimeType,
	quality: number,
): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

async function encodeAvatarCanvas(canvas: HTMLCanvasElement) {
	for (const format of OUTPUT_FORMATS) {
		const blob = await canvasToBlob(canvas, format.mimeType, format.quality);
		if (blob?.type === format.mimeType) return { ...format, blob };
	}
	throw new Error("Failed to encode avatar image.");
}

export async function normalizeAvatarImage(
	file: File,
): Promise<NormalizedAvatarImage> {
	assertAvatarInputFile(file);

	const bitmap = await createImageBitmap(file);
	try {
		const sourceSize = Math.min(bitmap.width, bitmap.height);
		const sourceX = Math.floor((bitmap.width - sourceSize) / 2);
		const sourceY = Math.floor((bitmap.height - sourceSize) / 2);
		const canvas = document.createElement("canvas");
		canvas.width = AVATAR_SIZE;
		canvas.height = AVATAR_SIZE;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas is not available.");
		ctx.drawImage(
			bitmap,
			sourceX,
			sourceY,
			sourceSize,
			sourceSize,
			0,
			0,
			AVATAR_SIZE,
			AVATAR_SIZE,
		);

		const encoded = await encodeAvatarCanvas(canvas);
		return {
			file: new File([encoded.blob], `avatar.${encoded.extension}`, {
				type: encoded.mimeType,
				lastModified: Date.now(),
			}),
			mimeType: encoded.mimeType,
			extension: encoded.extension,
		};
	} finally {
		bitmap.close();
	}
}
