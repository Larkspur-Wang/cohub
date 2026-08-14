import type { TaskRunRecord } from "@neta-art/cohub";
import type { BoardTaskOutput, BoardTaskSnapshot } from "@neta-art/cohub/board";

const EXCERPT_LIMIT = 240;

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function cleanExcerpt(
	value: unknown,
	limit = EXCERPT_LIMIT,
): string | undefined {
	if (typeof value !== "string") return undefined;
	const clean = value.replace(/\s+/g, " ").trim();
	if (!clean) return undefined;
	return clean.length > limit
		? `${clean.slice(0, limit - 1).trimEnd()}…`
		: clean;
}

function remoteUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value.trim());
		return url.protocol === "https:" || url.protocol === "http:"
			? url.toString()
			: undefined;
	} catch {
		return undefined;
	}
}

function blockText(block: Record<string, unknown>): string | undefined {
	return cleanExcerpt(block.text ?? block.content ?? block.value);
}

function blockUrl(block: Record<string, unknown>): string | undefined {
	const source = record(block.source);
	return remoteUrl(source?.url ?? source?.src ?? block.url ?? block.src);
}

function blockMimeType(block: Record<string, unknown>): string | undefined {
	const source = record(block.source);
	const value =
		source?.mediaType ??
		source?.media_type ??
		source?.mimeType ??
		block.mediaType ??
		block.media_type ??
		block.mimeType;
	return typeof value === "string" ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

function blockNaturalSize(block: Record<string, unknown>): {
	naturalWidth?: number;
	naturalHeight?: number;
} {
	const source = record(block.source);
	const naturalWidth = positiveNumber(
		source?.width ?? source?.naturalWidth ?? block.width ?? block.naturalWidth,
	);
	const naturalHeight = positiveNumber(
		source?.height ??
			source?.naturalHeight ??
			block.height ??
			block.naturalHeight,
	);
	return {
		...(naturalWidth ? { naturalWidth } : {}),
		...(naturalHeight ? { naturalHeight } : {}),
	};
}

function contentBlocks(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? (value.filter((item) => record(item)) as Record<string, unknown>[])
		: [];
}

function generationOutput(run: TaskRunRecord) {
	return contentBlocks(record(run.result)?.output);
}

function generationPrompt(run: TaskRunRecord): string | undefined {
	const data = record(record(run.payload)?.data) ?? record(run.payload);
	for (const block of contentBlocks(data?.content)) {
		const text = blockText(block);
		if (text) return text;
	}
	return undefined;
}

function primaryOutput(
	blocks: Record<string, unknown>[],
): BoardTaskOutput | undefined {
	for (const block of blocks) {
		if (block.type === "image" || block.type === "video") {
			const url = blockUrl(block);
			if (url)
				return {
					type: block.type,
					url,
					...(blockMimeType(block) ? { mimeType: blockMimeType(block) } : {}),
					...blockNaturalSize(block),
				};
		}
	}
	for (const block of blocks) {
		if (block.type === "audio") {
			return {
				type: "audio",
				...(blockUrl(block) ? { url: blockUrl(block) } : {}),
				...(blockMimeType(block) ? { mimeType: blockMimeType(block) } : {}),
			};
		}
		if (block.type === "text") {
			const textExcerpt = blockText(block);
			if (textExcerpt) return { type: "text", textExcerpt };
		}
	}
	return undefined;
}

function taskTypeTitle(taskType: string): string {
	return taskType
		.replaceAll(/[._-]+/g, " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function taskBoardSnapshot(run: TaskRunRecord): BoardTaskSnapshot {
	const payload = record(run.payload);
	const data = record(payload?.data) ?? payload;
	const blocks = run.taskType === "generation" ? generationOutput(run) : [];
	const promptExcerpt =
		run.taskType === "generation"
			? generationPrompt(run)
			: cleanExcerpt(data?.command ?? data?.prompt ?? data?.title);
	const model = typeof data?.model === "string" ? data.model : undefined;
	const primary = primaryOutput(blocks);
	return {
		taskType: run.taskType,
		status: run.status,
		title: promptExcerpt ?? taskTypeTitle(run.taskType),
		...(model ? { model } : {}),
		...(promptExcerpt ? { promptExcerpt } : {}),
		outputCount: blocks.length,
		...(primary ? { primaryOutput: primary } : {}),
		updatedAt: run.updatedAt,
	};
}
