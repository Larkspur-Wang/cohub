const AVATAR_SIZE = 1024;
const AVATAR_QUALITY = 0.86;
const INPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function assertAvatarInputFile(file: File) {
	if (!INPUT_TYPES.has(file.type)) {
		throw new Error("Please choose a JPEG, PNG, or WebP image.");
	}
}

async function assertWebpEncodingSupported() {
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/webp", AVATAR_QUALITY),
	);
	if (blob?.type !== "image/webp") {
		throw new Error(
			"This browser cannot prepare WebP images. Please try a newer browser.",
		);
	}
}

export async function normalizeAvatarToWebp(file: File): Promise<File> {
	assertAvatarInputFile(file);
	await assertWebpEncodingSupported();

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

		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(result) =>
					result
						? resolve(result)
						: reject(new Error("Failed to encode WebP image.")),
				"image/webp",
				AVATAR_QUALITY,
			);
		});
		return new File([blob], "avatar.webp", {
			type: "image/webp",
			lastModified: Date.now(),
		});
	} finally {
		bitmap.close();
	}
}
