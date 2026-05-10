import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { MessageToolCallsFile } from "@neta-art/cohub-protocol/model";
import type { ToolState } from "$lib/session-tree";

export type ToolCallStatus = "running" | "done" | "failed";

export type ToolCallPhase = "drafting" | "executing";

export type ToolCallViewModel = {
	id: string;
	name: string;
	input?: Record<string, unknown>;
	result?: string;
	partialResult?: string;
	status: ToolCallStatus;
	phase?: ToolCallPhase;
	resultPartial?: boolean;
	resultOmitted?: boolean;
};

export function summarizeToolInput(
	name: string,
	input?: Record<string, unknown>,
): string {
	if (!input) return "";
	const command = input.command;
	if (name === "bash") {
		if (typeof command === "string") return `$ ${command}`;
		if (command && typeof command === "object" && "preview" in command) {
			return `$ ${String((command as { preview?: unknown }).preview ?? "")}`;
		}
	}
	if (typeof input.path === "string") {
		if (["read", "write", "edit", "ls"].includes(name)) return input.path;
	}
	if (name === "grep" && typeof input.pattern === "string") {
		return [input.pattern, typeof input.path === "string" ? input.path : null]
			.filter(Boolean)
			.join(" · ");
	}
	if (name === "find" && typeof input.pattern === "string") {
		return [input.pattern, typeof input.path === "string" ? input.path : null]
			.filter(Boolean)
			.join(" · ");
	}
	try {
		return JSON.stringify(input);
	} catch {
		return String(input);
	}
}

export function stringifyToolValue(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		const text = value
			.map((block) => {
				if (
					block &&
					typeof block === "object" &&
					"type" in block &&
					(block as { type?: unknown }).type === "text" &&
					"text" in block
				) {
					return String((block as { text?: unknown }).text ?? "");
				}
				return "";
			})
			.filter(Boolean)
			.join("\n");
		if (text) return text;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export function formatToolInput(input?: Record<string, unknown>): string {
	if (!input || Object.keys(input).length === 0) return "";
	return JSON.stringify(input, null, 2);
}

/**
 * Returns the workspace-relative file path for read/write/edit tools.
 * Only absolute paths under /workspace are clickable in the tool call UI.
 */
export function getToolFilePath(
	name: string,
	input?: Record<string, unknown>,
): string | null {
	if (!["read", "write", "edit"].includes(name)) return null;
	const path = input?.path;
	if (typeof path !== "string" || !path.startsWith("/workspace/")) return null;
	const relativePath = path.slice("/workspace/".length);
	return relativePath.length > 0 ? relativePath : null;
}

export function isSimpleInput(
	name: string,
	input?: Record<string, unknown>,
): boolean {
	if (!input) return true;
	const keys = Object.keys(input);
	if (keys.length === 0) return true;
	if (
		keys.length === 1 &&
		keys[0] === "path" &&
		typeof input.path === "string"
	) {
		return ["ls", "read", "write"].includes(name);
	}
	if (
		name === "bash" &&
		keys.length === 1 &&
		typeof input.command === "string"
	) {
		return true;
	}
	return false;
}

function findToolResult(content: ContentBlock[], toolUseId: string) {
	return content.find(
		(block) => block.type === "tool_result" && block.tool_use_id === toolUseId,
	);
}

export function buildToolCallViewModels(input: {
	content: ContentBlock[];
	toolCallsFile?: MessageToolCallsFile | null;
}): ToolCallViewModel[] {
	const toolUseBlocks = input.content.filter(
		(block) => block.type === "tool_use",
	);
	return toolUseBlocks.map((block) => {
		const fullTool =
			input.toolCallsFile?.toolCalls.find((tool) => tool.id === block.id) ??
			null;
		const result = findToolResult(input.content, block.id);
		const metaStatus = block._meta?.toolStatus;
		const status: ToolCallStatus =
			metaStatus === "done" ||
			metaStatus === "failed" ||
			metaStatus === "running"
				? metaStatus
				: fullTool?.result
					? fullTool.result.isError
						? "failed"
						: "done"
					: result?.type === "tool_result"
						? result.is_error
							? "failed"
							: "done"
						: "running";
		const phase =
			status === "running"
				? metaStatus === "running"
					? "executing"
					: "drafting"
				: undefined;
		const resultContent = fullTool?.result
			? stringifyToolValue(fullTool.result.content)
			: result?.type === "tool_result"
				? stringifyToolValue(result.content)
				: "";
		const partialResult = stringifyToolValue(block._meta?.partialResult);
		const resultPartial = Boolean(partialResult);
		return {
			id: block.id,
			name: block.name,
			input: fullTool?.input ?? block.input,
			result: resultContent,
			partialResult,
			status,
			phase,
			resultPartial,
			resultOmitted:
				result?.type === "tool_result" &&
				result._meta?.resultDetail === "omitted",
		};
	});
}

export function toolStateToViewModel(tool: ToolState): ToolCallViewModel {
	return {
		id: tool.id,
		name: tool.name,
		input: tool.input,
		result: tool.output,
		status: tool.status,
	};
}
