import {
	BOARD_TASK_ARTIFACT_LIMIT,
	type BoardTaskArtifact,
	type BoardTaskSnapshot,
	normalizeBoardRemoteUrl,
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

function blockText(block: Record<string, unknown>): string | undefined {
	return cleanExcerpt(block.text ?? block.content ?? block.value);
}

function blockUrl(block: Record<string, unknown>): string | undefined {
	const source = record(block.source);
	return normalizeBoardRemoteUrl(
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

function blockMeta(block: Record<string, unknown>) {
	return record(block.meta);
}

function blockIdentity(block: Record<string, unknown>): string | undefined {
	const meta = blockMeta(block);
	const value =
		meta?.id ??
		meta?.clip_id ??
		meta?.clipId ??
		block.id ??
		block.clip_id ??
		block.clipId;
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	return cleanExcerpt(String(value), 220);
}

function blockTitle(block: Record<string, unknown>): string | undefined {
	const meta = blockMeta(block);
	return cleanExcerpt(meta?.title ?? block.title ?? block.name, 240);
}

function blockDurationMs(block: Record<string, unknown>): number | undefined {
	const source = record(block.source);
	const meta = blockMeta(block);
	const milliseconds = positiveNumber(
		source?.durationMs ?? meta?.durationMs ?? block.durationMs,
	);
	if (milliseconds) return Math.round(milliseconds);
	const seconds = positiveNumber(
		source?.duration ?? meta?.duration ?? block.duration,
	);
	return seconds ? Math.round(seconds * 1000) : undefined;
}

function blockPreviewUrl(block: Record<string, unknown>): string | undefined {
	const source = record(block.source);
	return normalizeBoardRemoteUrl(
		source?.poster ??
			source?.thumbnail ??
			source?.previewUrl ??
			block.poster ??
			block.thumbnail ??
			block.previewUrl,
	);
}

function artifactId(
	base: string,
	used: Set<string>,
	suffix?: string,
): string {
	const stem = cleanExcerpt(base, 220) ?? "output";
	let candidate = suffix ? `${stem}-${suffix}` : stem;
	let sequence = 2;
	while (used.has(candidate)) {
		candidate = `${stem}-${suffix ? `${suffix}-` : ""}${sequence}`;
		sequence += 1;
	}
	used.add(candidate);
	return candidate;
}

/**
 * Group provider blocks into user-facing works. A cover/poster sharing a stable
 * provider id with playable media belongs to that work instead of becoming a
 * competing image result.
 */
export function taskArtifacts(
	blocks: Record<string, unknown>[],
): BoardTaskArtifact[] {
	const groups = new Map<string, Record<string, unknown>[]>();
	blocks.forEach((block, index) => {
		const key = blockIdentity(block) ?? `output-${index + 1}`;
		const group = groups.get(key);
		if (group) group.push(block);
		else groups.set(key, [block]);
	});

	const artifacts: BoardTaskArtifact[] = [];
	const usedIds = new Set<string>();
	for (const [groupId, blocksInGroup] of groups) {
		const images = blocksInGroup
			.filter((block) => block.type === "image")
			.map((block) => ({ block, url: blockUrl(block) }))
			.filter(
				(entry): entry is typeof entry & { url: string } => Boolean(entry.url),
			);
		const media = blocksInGroup
			.filter((block) => block.type === "video" || block.type === "audio")
			.map((block) => ({ block, url: blockUrl(block) }))
			.filter(
				(entry): entry is typeof entry & { url: string } => Boolean(entry.url),
			);
		const pairedPreview = images[0];

		media.forEach(({ block, url }, mediaIndex) => {
			const type = block.type as "video" | "audio";
			const mimeType = blockMimeType(block);
			const title = blockTitle(block);
			const durationMs = blockDurationMs(block);
			const previewUrl = blockPreviewUrl(block) ?? pairedPreview?.url;
			const id = artifactId(
				groupId,
				usedIds,
				media.length > 1 ? `${type}-${mediaIndex + 1}` : undefined,
			);
			if (type === "video") {
				artifacts.push({
					id,
					type,
					url,
					...(title ? { title } : {}),
					...(previewUrl ? { previewUrl } : {}),
					...(mimeType ? { mimeType } : {}),
					...(durationMs ? { durationMs } : {}),
					...blockNaturalSize(block),
				});
				return;
			}
			artifacts.push({
				id,
				type,
				url,
				...(title ? { title } : {}),
				...(previewUrl ? { previewUrl } : {}),
				...(mimeType ? { mimeType } : {}),
				...(durationMs ? { durationMs } : {}),
			});
		});

		const firstUnpairedImage = media.length > 0 ? 1 : 0;
		images.slice(firstUnpairedImage).forEach(({ block, url }, imageIndex) => {
			const mimeType = blockMimeType(block);
			const title = blockTitle(block);
			artifacts.push({
				id: artifactId(
					groupId,
					usedIds,
					images.length - firstUnpairedImage > 1
						? `image-${imageIndex + 1}`
						: undefined,
				),
				type: "image",
				url,
				...(title ? { title } : {}),
				...(mimeType ? { mimeType } : {}),
				...blockNaturalSize(block),
			});
		});

		blocksInGroup
			.filter((block) => block.type === "text")
			.forEach((block, textIndex, texts) => {
				const textExcerpt = blockText(block);
				if (!textExcerpt) return;
				const title = blockTitle(block);
				artifacts.push({
					id: artifactId(
						groupId,
						usedIds,
						texts.length > 1 ? `text-${textIndex + 1}` : undefined,
					),
					type: "text",
					...(title ? { title } : {}),
					textExcerpt,
				});
			});
	}
	return artifacts;
}

function artifactScore(artifact: BoardTaskArtifact): readonly number[] {
	const kind = { text: 1, image: 2, audio: 3, video: 4 }[artifact.type];
	if (artifact.type === "text") return [kind, artifact.textExcerpt.length];
	if (artifact.type === "image") {
		return [kind, (artifact.naturalWidth ?? 0) * (artifact.naturalHeight ?? 0)];
	}
	return [
		kind,
		artifact.previewUrl ? 1 : 0,
		artifact.durationMs ? 1 : 0,
		artifact.durationMs ?? 0,
	];
}

function compareArtifacts(a: BoardTaskArtifact, b: BoardTaskArtifact): number {
	const left = artifactScore(a);
	const right = artifactScore(b);
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const difference = (right[index] ?? 0) - (left[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

/** Highest-value artifact first, with provider order as the stable final tie. */
export function rankedTaskArtifacts(
	artifacts: readonly BoardTaskArtifact[],
): BoardTaskArtifact[] {
	return artifacts
		.map((artifact, index) => ({ artifact, index }))
		.sort(
			(a, b) => compareArtifacts(a.artifact, b.artifact) || a.index - b.index,
		)
		.map(({ artifact }) => artifact);
}

export function featuredTaskArtifact(
	artifacts: readonly BoardTaskArtifact[],
): BoardTaskArtifact | undefined {
	let featured: BoardTaskArtifact | undefined;
	for (const artifact of artifacts) {
		if (!featured || compareArtifacts(artifact, featured) < 0) {
			featured = artifact;
		}
	}
	return featured;
}

export function taskArtifactPreviewUrl(
	artifact: BoardTaskArtifact | undefined,
): string | undefined {
	if (artifact?.type === "image") return artifact.url;
	if (artifact?.type === "video" || artifact?.type === "audio") {
		return artifact.previewUrl;
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
	const allArtifacts = taskArtifacts(blocks);
	const artifacts = rankedTaskArtifacts(allArtifacts).slice(
		0,
		BOARD_TASK_ARTIFACT_LIMIT,
	);
	return {
		taskType: run.taskType,
		status: run.status,
		title: promptExcerpt ?? taskTypeTitle(run.taskType),
		...(model ? { model } : {}),
		...(promptExcerpt ? { promptExcerpt } : {}),
		artifactCount: allArtifacts.length,
		artifacts,
		updatedAt: run.updatedAt,
	};
}
