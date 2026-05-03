import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { StoredIntermediateMessage } from "@neta-art/cohub-protocol/model";

function blockText(block: ContentBlock): string {
	if (block.type === "text") return block.text;
	if (block.type === "thinking") return block.thinking;
	if (block.type === "system_note") return block.text;
	if (block.type === "tool_use") {
		return block._meta?.summary ? String(block._meta.summary) : block.name;
	}
	if (block.type === "tool_result") {
		return typeof block.content === "string" ? block.content : "";
	}
	return "";
}

export function createStreamingIntermediateMessage(input: {
	spaceId?: string | null;
	sessionId: string;
	turnId?: string | null;
	streamMessageId?: string | null;
	messageOrdinal?: number | null;
	contentBlocks: ContentBlock[];
	createdAt?: string;
}): StoredIntermediateMessage | null {
	if (input.contentBlocks.length === 0) return null;
	const id =
		input.streamMessageId ??
		`stream:${input.sessionId}:${input.turnId ?? "turn"}:${input.messageOrdinal ?? 0}`;
	const text = input.contentBlocks.map(blockText).filter(Boolean).join("\n\n");
	const toolResultError = input.contentBlocks.find(
		(block) => block.type === "tool_result" && block.is_error,
	) as Extract<ContentBlock, { type: "tool_result" }> | undefined;
	return {
		id,
		sessionId: input.sessionId,
		role: "assistant",
		content: input.contentBlocks,
		text,
		provider: null,
		model: null,
		stopReason: null,
		errorMessage: toolResultError ? blockText(toolResultError) : null,
		usage: null,
		toolCallsObjectKey: null,
		meta: {
			messageKind: "assistant_intermediate",
			streaming: true,
			turnId: input.turnId ?? null,
			spaceId: input.spaceId ?? null,
			streamMessageId: id,
			messageOrdinal: input.messageOrdinal ?? null,
		},
		createdAt: input.createdAt ?? new Date().toISOString(),
	};
}
