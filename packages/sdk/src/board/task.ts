import type {
	BoardTaskOutput,
	BoardTaskSnapshot,
} from "@cohub/protocol/board-document";
import type { TaskRunRecord } from "../types.js";

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
		? `${clean.slice(0, limit - 3).trimEnd()}...`
		: clean;
}

function parseIpv4(host: string): [number, number, number, number] | null {
	const parts = host.split(".").map(Number);
	return parts.length === 4 &&
		parts.every(
			(part) => Number.isInteger(part) && part >= 0 && part <= 255,
		)
		? (parts as [number, number, number, number])
		: null;
}

function isBlockedIpv4(host: string): boolean {
	const parts = parseIpv4(host);
	if (!parts) return false;
	const [first, second, third] = parts;
	if (first === 0 || first === 10 || first === 127) return true;
	if (first === 100 && second >= 64 && second <= 127) return true;
	if (first === 169 && second === 254) return true;
	if (first === 172 && second >= 16 && second <= 31) return true;
	if (first === 192 && second === 168) return true;
	if (first === 192 && second === 0 && (third === 0 || third === 2)) return true;
	if (first === 192 && second === 88 && third === 99) return true;
	if (first === 198 && (second === 18 || second === 19)) return true;
	if (first === 198 && second === 51 && third === 100) return true;
	if (first === 203 && second === 0 && third === 113) return true;
	return first >= 224;
}

function expandIpv6(host: string): string[] | null {
	const [head, tail, extra] = host.toLowerCase().split("::");
	if (extra !== undefined) return null;
	const headParts = head ? head.split(":").filter(Boolean) : [];
	const tailParts = tail ? tail.split(":").filter(Boolean) : [];
	const missing = 8 - headParts.length - tailParts.length;
	if (missing < 0 || (tail === undefined && missing !== 0)) return null;
	const parts = [
		...headParts,
		...Array.from({ length: missing }, () => "0"),
		...tailParts,
	];
	if (
		parts.length !== 8 ||
		parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
	)
		return null;
	return parts.map((part) => part.padStart(4, "0"));
}

function isBlockedIpv6(host: string): boolean {
	const parts = expandIpv6(host);
	if (!parts) return true;
	if (parts.every((part) => part === "0000")) return true;
	if (
		parts.slice(0, 7).every((part) => part === "0000") &&
		parts[7] === "0001"
	)
		return true;
	if (
		parts.slice(0, 5).every((part) => part === "0000") &&
		parts[5] === "ffff"
	) {
		const high = Number.parseInt(parts[6] ?? "0", 16);
		const low = Number.parseInt(parts[7] ?? "0", 16);
		return isBlockedIpv4(
			`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
		);
	}
	if (parts.slice(0, 6).every((part) => part === "0000")) return true;
	const first = Number.parseInt(parts[0] ?? "0", 16);
	if ((first & 0xfe00) === 0xfc00) return true;
	if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0)
		return true;
	if ((first & 0xff00) === 0xff00) return true;
	return parts[0] === "2001" && parts[1] === "0db8";
}

function isBlockedTaskOutputHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal")
	)
		return true;
	if (parseIpv4(host)) return isBlockedIpv4(host);
	return host.includes(":") && isBlockedIpv6(host);
}

/**
 * Normalize a persistable remote media URL and reject credentialed or visibly
 * non-public hosts. Server-side fetchers must still validate resolved DNS addresses.
 */
export function normalizeBoardTaskOutputUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
		if (url.username || url.password || isBlockedTaskOutputHost(url.hostname))
			return undefined;
		return url.toString();
	} catch {
		return undefined;
	}
}

function blockText(block: Record<string, unknown>): string | undefined {
	return cleanExcerpt(block.text ?? block.content ?? block.value);
}

function blockUrl(block: Record<string, unknown>): string | undefined {
	const source = record(block.source);
	return normalizeBoardTaskOutputUrl(
		source?.url ?? source?.src ?? block.url ?? block.src,
	);
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

function taskData(run: TaskRunRecord): Record<string, unknown> | null {
	const payload = record(run.payload);
	return record(payload?.data) ?? payload;
}

function generationOutput(run: TaskRunRecord): Record<string, unknown>[] {
	return contentBlocks(record(run.result)?.output);
}

function generationPrompt(run: TaskRunRecord): string | undefined {
	for (const block of contentBlocks(taskData(run)?.content)) {
		const text = blockText(block);
		if (text) return text;
	}
	return undefined;
}

function primaryOutput(
	blocks: Record<string, unknown>[],
): BoardTaskOutput | undefined {
	for (const block of blocks) {
		if (block.type !== "image" && block.type !== "video") continue;
		const url = blockUrl(block);
		if (!url) continue;
		const mimeType = blockMimeType(block);
		return {
			type: block.type,
			url,
			...(mimeType ? { mimeType } : {}),
			...blockNaturalSize(block),
		};
	}
	for (const block of blocks) {
		if (block.type === "audio") {
			const url = blockUrl(block);
			const mimeType = blockMimeType(block);
			return {
				type: "audio",
				...(url ? { url } : {}),
				...(mimeType ? { mimeType } : {}),
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
		.replace(/[._-]+/g, " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Project an authoritative TaskRun into a small, replaceable Board display cache.
 * Raw payloads, complete results and inline media are never copied into the Board.
 */
export function taskRunToBoardTaskSnapshot(
	run: TaskRunRecord,
): BoardTaskSnapshot {
	const data = taskData(run);
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
