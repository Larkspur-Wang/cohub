import type { MediaItem } from "$lib/components/media-lightbox";

type RecordValue = Record<string, unknown>;

type ExtractGenerationMediaOptions = {
	deferBase64?: boolean;
};

const BASE64_KEYS = ["data", "base64", "contentBase64"] as const;

function isRecord(value: unknown): value is RecordValue {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasText(value: string) {
	return /\S/.test(value);
}

function readString(record: RecordValue | undefined, keys: readonly string[]) {
	if (!record) return null;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && hasText(value)) return value.trim();
	}
	return null;
}

function hasBase64Payload(record: RecordValue | undefined) {
	return BASE64_KEYS.some((key) => {
		const value = record?.[key];
		return typeof value === "string" && hasText(value);
	});
}

function hasDeferredBase64(
	block: RecordValue,
	source: RecordValue | undefined,
) {
	return block.deferredBase64 === true || source?.deferredBase64 === true;
}

function mediaTypeForBlock(
	block: RecordValue,
	source: RecordValue | undefined,
) {
	return (
		readString(source, ["mediaType", "media_type", "mimeType"]) ??
		readString(block, ["mediaType", "media_type", "mimeType"]) ??
		(block.type === "video" ? "video/mp4" : "image/png")
	);
}

export function isInlineMediaUrl(value: string | null | undefined) {
	return /^(data|blob):/i.test(value?.trim() ?? "");
}

function mediaSourceUrl(
	block: RecordValue,
	options: ExtractGenerationMediaOptions,
) {
	const source = isRecord(block.source) ? block.source : undefined;
	const url =
		readString(source, ["url", "src"]) ?? readString(block, ["url", "src"]);
	if (url) {
		if (options.deferBase64 && isInlineMediaUrl(url)) {
			return { src: "", deferred: true };
		}
		return { src: url, deferred: false };
	}
	if (
		options.deferBase64 &&
		(hasBase64Payload(source) || hasBase64Payload(block))
	) {
		return { src: "", deferred: true };
	}
	const data =
		readString(source, BASE64_KEYS) ?? readString(block, BASE64_KEYS);
	if (data) {
		if (options.deferBase64) return { src: "", deferred: true };
		return {
			src: `data:${mediaTypeForBlock(block, source)};base64,${data}`,
			deferred: false,
		};
	}
	if (hasDeferredBase64(block, source)) return { src: "", deferred: true };
	return null;
}

function normalizeOutputBlocks(result: unknown): RecordValue[] {
	if (!isRecord(result)) return [];
	const output = result.output;
	if (Array.isArray(output)) return output.filter(isRecord);
	return [];
}

export function extractGenerationMediaItems(
	result: unknown,
	options: ExtractGenerationMediaOptions = {},
): MediaItem[] {
	return normalizeOutputBlocks(result)
		.map((block, index): MediaItem | null => {
			if (block.type !== "image" && block.type !== "video") return null;
			const source = mediaSourceUrl(block, options);
			if (!source) return null;
			const alt =
				readString(block, ["alt", "name", "filename"]) ??
				`Generation ${index + 1}`;
			const poster =
				block.type === "video"
					? (readString(block, ["poster", "thumbnail"]) ?? undefined)
					: undefined;
			return {
				src: source.src,
				type: block.type,
				alt,
				poster,
				deferred: source.deferred || undefined,
			};
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

export function hasGenerationBase64Media(result: unknown) {
	return normalizeOutputBlocks(result).some((block) => {
		if (block.type !== "image" && block.type !== "video") return false;
		const source = isRecord(block.source) ? block.source : undefined;
		return (
			hasBase64Payload(block) ||
			hasBase64Payload(source) ||
			hasDeferredBase64(block, source)
		);
	});
}
