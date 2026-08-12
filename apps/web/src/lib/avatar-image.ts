export type AvatarUploadMimeType =
	| "image/webp"
	| "image/jpeg"
	| "image/png"
	| "image/gif";

export type NormalizedAvatarImage = {
	file: File;
	mimeType: AvatarUploadMimeType;
	extension: "webp" | "jpg" | "png" | "gif";
};

const AVATAR_SIZE = 1024;
const WEBP_QUALITY = 0.86;
const JPEG_QUALITY = 0.88;
const INPUT_FORMATS: Record<
	AvatarUploadMimeType,
	NormalizedAvatarImage["extension"]
> = {
	"image/webp": "webp",
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
};
const EXTENSION_FORMATS: Record<string, AvatarUploadMimeType> = {
	webp: "image/webp",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
};

function getAvatarMimeType(file: File): AvatarUploadMimeType | null {
	if (file.type in INPUT_FORMATS) return file.type as AvatarUploadMimeType;
	const extension = file.name.split(".").pop()?.toLowerCase();
	return extension ? (EXTENSION_FORMATS[extension] ?? null) : null;
}
const OUTPUT_FORMATS: Array<{
	mimeType: AvatarUploadMimeType;
	extension: "webp" | "jpg";
	quality: number;
}> = [
	{ mimeType: "image/webp", extension: "webp", quality: WEBP_QUALITY },
	{ mimeType: "image/jpeg", extension: "jpg", quality: JPEG_QUALITY },
];

export function assertAvatarInputFile(file: File): AvatarUploadMimeType {
	const mimeType = getAvatarMimeType(file);
	if (!mimeType) {
		throw new Error("Please choose a JPEG, PNG, GIF, or WebP image.");
	}
	return mimeType;
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
	const mimeType = assertAvatarInputFile(file);
	const originalFile =
		file.type === mimeType
			? file
			: new File([file], file.name, {
					type: mimeType,
					lastModified: file.lastModified,
				});
	const original = {
		file: originalFile,
		mimeType,
		extension: INPUT_FORMATS[mimeType],
	};
	if (mimeType === "image/gif") return original;

	try {
		const bitmap = await createImageBitmap(file, {
			imageOrientation: "from-image",
		});
		try {
			const sourceSize = Math.min(bitmap.width, bitmap.height);
			const sourceX = Math.floor((bitmap.width - sourceSize) / 2);
			const sourceY = Math.floor((bitmap.height - sourceSize) / 2);
			const canvas = document.createElement("canvas");
			canvas.width = AVATAR_SIZE;
			canvas.height = AVATAR_SIZE;
			const ctx = canvas.getContext("2d");
			if (!ctx) return original;
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
	} catch {
		return original;
	}
}
