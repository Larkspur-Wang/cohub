import type { MediaItem } from "$lib/components/media-lightbox.svelte";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(record: RecordValue | undefined, keys: string[]) {
	if (!record) return null;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

function mediaSourceUrl(block: RecordValue) {
	const source = isRecord(block.source) ? block.source : undefined;
	const url =
		readString(source, ["url", "src"]) ?? readString(block, ["url", "src"]);
	if (url) return url;
	const data =
		readString(source, ["data", "base64", "contentBase64"]) ??
		readString(block, ["data", "base64", "contentBase64"]);
	if (!data) return null;
	const mediaType =
		readString(source, ["mediaType", "media_type", "mimeType"]) ??
		readString(block, ["mediaType", "media_type", "mimeType"]) ??
		(block.type === "video" ? "video/mp4" : "image/png");
	return `data:${mediaType};base64,${data}`;
}

function normalizeOutputBlocks(result: unknown): RecordValue[] {
	if (!isRecord(result)) return [];
	const output = result.output;
	if (Array.isArray(output)) return output.filter(isRecord);
	return [];
}

export function extractGenerationMediaItems(result: unknown): MediaItem[] {
	return normalizeOutputBlocks(result)
		.map((block, index): MediaItem | null => {
			if (block.type !== "image" && block.type !== "video") return null;
			const src = mediaSourceUrl(block);
			if (!src) return null;
			const alt =
				readString(block, ["alt", "name", "filename"]) ??
				`Generation ${index + 1}`;
			const poster =
				block.type === "video"
					? (readString(block, ["poster", "thumbnail"]) ?? undefined)
					: undefined;
			return { src, type: block.type, alt, poster };
		})
		.filter((item): item is MediaItem => Boolean(item));
}

function textFromBlock(block: RecordValue): string | null {
	if (block.type !== "text") return null;
	return readString(block, ["text", "content", "value"]);
}

export function extractGenerationPromptPreview(
	payload: unknown,
): string | null {
	const root = isRecord(payload) ? payload : null;
	const data = root && isRecord(root.data) ? root.data : root;
	const content = data?.content;
	if (!Array.isArray(content)) return null;
	const text = content
		.filter(isRecord)
		.map(textFromBlock)
		.filter(Boolean)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	return text || null;
}
