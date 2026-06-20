import type { ContentBlock } from "@cohub/protocol/core";
import type { TaskRunRecord } from "@neta-art/cohub";
import { asRecord } from "../space-utils";

export function taskTypeLabel(taskType: string) {
	if (taskType === "run_command") return "Run Command";
	if (taskType === "save_checkpoint") return "Save Checkpoint";
	return taskType;
}

export function taskHasResult(run: TaskRunRecord): boolean {
	return run.result !== null && run.result !== undefined;
}

export function taskAttemptsLabel(run: TaskRunRecord): string {
	return `${run.attemptCount} attempt${run.attemptCount === 1 ? "" : "s"}`;
}

export type DisplaySafeJsonOptions = {
	maxStringLength?: number;
	maxArrayItems?: number;
	maxObjectKeys?: number;
	maxDepth?: number;
};

const DEFAULT_DISPLAY_SAFE_JSON_OPTIONS: Required<DisplaySafeJsonOptions> = {
	maxStringLength: 24_000,
	maxArrayItems: 200,
	maxObjectKeys: 200,
	maxDepth: 10,
};

function toDisplaySafeJsonValue(
	value: unknown,
	options: Required<DisplaySafeJsonOptions> = DEFAULT_DISPLAY_SAFE_JSON_OPTIONS,
	depth = 0,
	seen = new WeakSet<object>(),
): unknown {
	if (typeof value === "string") {
		if (value.length <= options.maxStringLength) return value;
		const omitted = value.length - options.maxStringLength;
		return `${value.slice(0, options.maxStringLength)}\n… [truncated ${omitted.toLocaleString()} chars]`;
	}
	if (
		value === null ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "undefined"
	) {
		return value;
	}
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "function") return "[function]";
	if (typeof value !== "object") return String(value);
	if (depth >= options.maxDepth) return "[max depth reached]";
	if (seen.has(value)) return "[circular]";
	seen.add(value);
	if (Array.isArray(value)) {
		const items = value
			.slice(0, options.maxArrayItems)
			.map((item) => toDisplaySafeJsonValue(item, options, depth + 1, seen));
		if (value.length > options.maxArrayItems) {
			items.push(`[truncated ${value.length - options.maxArrayItems} items]`);
		}
		seen.delete(value);
		return items;
	}
	const entries = Object.entries(value as Record<string, unknown>);
	const safeEntries = entries
		.slice(0, options.maxObjectKeys)
		.map(([key, item]) => [
			key,
			toDisplaySafeJsonValue(item, options, depth + 1, seen),
		]);
	if (entries.length > options.maxObjectKeys) {
		safeEntries.push([
			"__truncated__",
			`truncated ${entries.length - options.maxObjectKeys} keys`,
		]);
	}
	seen.delete(value);
	return Object.fromEntries(safeEntries);
}

export function displaySafeJson(
	value: unknown,
	options?: DisplaySafeJsonOptions,
): string {
	const merged = { ...DEFAULT_DISPLAY_SAFE_JSON_OPTIONS, ...options };
	return JSON.stringify(toDisplaySafeJsonValue(value, merged), null, 2);
}

export function checkpointIdFromTaskRun(
	run: TaskRunRecord | null | undefined,
): string | null {
	const result = asRecord(run?.result);
	const checkpointId = result?.checkpointId;
	return typeof checkpointId === "string" && checkpointId.trim()
		? checkpointId
		: null;
}

export function saveCheckpointProgressLabel(progress: unknown): string | null {
	const stage = asRecord(progress)?.stage;
	if (typeof stage !== "string" || !stage.trim()) return null;
	const labels: Record<string, string> = {
		prepare: "Preparing workspace",
		scan_workspace: "Scanning workspace",
		upload_assets: "Uploading assets",
		bundle_git_repos: "Bundling git repositories",
		commit_checkpoint: "Committing checkpoint",
		materialize_latest: "Materializing latest files",
		write_checkpoint_record: "Writing checkpoint record",
		mirror_gitea: "Mirroring repository",
		completed: "Completed",
	};
	return labels[stage] ?? stage.replaceAll("_", " ");
}

function isContentBlockArray(value: unknown): value is ContentBlock[] {
	return (
		Array.isArray(value) &&
		value.every((block) => {
			return (
				block &&
				typeof block === "object" &&
				typeof (block as { type?: unknown }).type === "string"
			);
		})
	);
}

function contentBlocksFrom(value: unknown): ContentBlock[] {
	if (!value || typeof value !== "object") return [];
	const record = value as { content?: unknown; output?: unknown };
	if (isContentBlockArray(record.content)) return record.content;
	if (isContentBlockArray(record.output)) return record.output;
	return [];
}

export function runCommandContent(
	run: TaskRunRecord,
	progress: unknown,
): ContentBlock[] {
	const resultContent = contentBlocksFrom(run.result);
	if (resultContent.length > 0) return resultContent;
	return contentBlocksFrom(progress);
}

export function taskOutputContent(
	run: TaskRunRecord,
	progress: unknown,
): ContentBlock[] {
	if (run.taskType === "generation") return [];
	if (run.taskType === "run_command") return runCommandContent(run, progress);
	const resultContent = contentBlocksFrom(run.result);
	if (resultContent.length > 0) return resultContent;
	return contentBlocksFrom(progress);
}

export function generationOutputBlocks(
	run: TaskRunRecord,
): Record<string, unknown>[] {
	if (run.taskType !== "generation") return [];
	const result = asRecord(run.result);
	const output = result?.output;
	return Array.isArray(output)
		? (output.filter((block) => !!asRecord(block)) as Record<string, unknown>[])
		: [];
}

export function generationBlockText(
	block: Record<string, unknown>,
): string | null {
	if (block.type !== "text") return null;
	const text = block.text ?? block.content ?? block.value;
	return typeof text === "string" ? text : null;
}

export function generationBlockSource(
	block: Record<string, unknown>,
): string | null {
	const source = asRecord(block.source);
	const directUrl = source?.url ?? source?.src ?? block.url ?? block.src;
	if (typeof directUrl === "string" && directUrl.trim()) {
		return directUrl.trim();
	}
	const data =
		source?.data ??
		source?.base64 ??
		source?.contentBase64 ??
		block.data ??
		block.base64 ??
		block.contentBase64;
	if (typeof data !== "string" || !data.trim()) return null;
	const mediaType =
		source?.mediaType ??
		source?.media_type ??
		source?.mimeType ??
		block.mediaType ??
		block.media_type ??
		block.mimeType;
	const fallbackType =
		block.type === "audio"
			? "audio/mpeg"
			: block.type === "video"
				? "video/mp4"
				: "image/png";
	return `data:${typeof mediaType === "string" ? mediaType : fallbackType};base64,${data}`;
}

export function generationBlockLabel(
	block: Record<string, unknown>,
	index: number,
): string {
	const name = block.name ?? block.filename ?? block.alt;
	return typeof name === "string" && name.trim()
		? name.trim()
		: `Output ${index + 1}`;
}

export function generationBlockMeta(
	block: Record<string, unknown>,
): string | null {
	const source = asRecord(block.source);
	const mediaType =
		source?.mediaType ??
		source?.media_type ??
		source?.mimeType ??
		block.mediaType ??
		block.media_type ??
		block.mimeType;
	const parts = [
		typeof block.type === "string" ? block.type : null,
		typeof mediaType === "string" ? mediaType : null,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : null;
}

export function taskRawResult(run: TaskRunRecord): unknown {
	return run.result ?? null;
}

export function taskContextLabel(run: TaskRunRecord): string {
	if (run.cronJobId) return "From cronjob";
	return "One-time task";
}

export function taskIsStreaming(run: TaskRunRecord): boolean {
	return run.status === "pending" || run.status === "running";
}

export function runCommandPayload(run: TaskRunRecord) {
	const payload =
		run.payload && typeof run.payload === "object"
			? (run.payload as { data?: unknown })
			: null;
	const data =
		payload?.data && typeof payload.data === "object"
			? (payload.data as Record<string, unknown>)
			: null;
	return {
		command: typeof data?.command === "string" ? data.command : "",
		cwd: typeof data?.cwd === "string" ? data.cwd : "/workspace",
	};
}

export function runCommandResultMeta(run: TaskRunRecord) {
	const result =
		run.result && typeof run.result === "object"
			? (run.result as Record<string, unknown>)
			: null;
	return {
		exitCode: typeof result?.exitCode === "number" ? result.exitCode : null,
		durationMs:
			typeof result?.durationMs === "number" ? result.durationMs : null,
		truncated: Boolean(result?.truncated),
	};
}

export function formatDurationMs(ms: number | null) {
	if (ms === null) return "—";
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export function taskRunStatusBadge(run: TaskRunRecord) {
	switch (run.status) {
		case "completed":
			return {
				label: "Completed",
				color: "text-status-running",
				dot: "bg-status-running",
			};
		case "failed":
			return {
				label: "Failed",
				color: "text-status-error",
				dot: "bg-status-error",
			};
		case "running":
			return { label: "Running", color: "text-info", dot: "bg-info" };
		case "pending":
			return { label: "Pending", color: "text-warning", dot: "bg-warning" };
		default:
			return {
				label: run.status,
				color: "text-text-placeholder",
				dot: "bg-text-placeholder",
			};
	}
}

export function taskRunDuration(run: TaskRunRecord): string {
	if (!run.startedAt || !run.finishedAt) return "—";
	const ms = Math.max(
		0,
		new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime(),
	);
	return `${(ms / 1000).toFixed(1)}s`;
}
