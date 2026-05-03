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

function getStreamIndex(block: ContentBlock, fallback: number) {
	const value = block._meta?.streamIndex;
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function buildMessageId(input: {
	sessionId: string;
	turnId?: string | null;
	streamIndex: number;
	index: number;
	suffix: string;
}) {
	return `stream:${input.sessionId}:${input.turnId ?? "turn"}:${input.streamIndex}:${input.index}:${input.suffix}`;
}

function createIntermediateMessage(input: {
	spaceId?: string | null;
	sessionId: string;
	turnId?: string | null;
	id: string;
	content: ContentBlock[];
	text: string;
	errorMessage?: string | null;
	createdAt: string;
}): StoredIntermediateMessage {
	return {
		id: input.id,
		sessionId: input.sessionId,
		role: "assistant",
		content: input.content,
		text: input.text,
		provider: null,
		model: null,
		stopReason: null,
		errorMessage: input.errorMessage ?? null,
		usage: null,
		toolCallsObjectKey: null,
		meta: {
			messageKind: "assistant_intermediate",
			streaming: true,
			turnId: input.turnId ?? null,
			spaceId: input.spaceId ?? null,
		},
		createdAt: input.createdAt,
	};
}

/**
 * Build running-turn process messages directly from the incoming content blocks.
 * The block order and block payloads are preserved; this only decides message
 * boundaries for the existing ProcessCard UI.
 */
export function buildStreamingIntermediateMessages(input: {
	spaceId?: string | null;
	sessionId: string;
	turnId?: string | null;
	contentBlocks: ContentBlock[];
	createdAt?: string;
}): StoredIntermediateMessage[] {
	const createdAt = input.createdAt ?? new Date().toISOString();
	const messages: StoredIntermediateMessage[] = [];
	const consumedToolResultIndexes = new Set<number>();
	const toolResultsByUseId = new Map<
		string,
		{ block: Extract<ContentBlock, { type: "tool_result" }>; index: number }
	>();

	input.contentBlocks.forEach((block, index) => {
		if (block.type !== "tool_result") return;
		if (!toolResultsByUseId.has(block.tool_use_id)) {
			toolResultsByUseId.set(block.tool_use_id, { block, index });
		}
	});

	input.contentBlocks.forEach((block, index) => {
		const streamIndex = getStreamIndex(block, index);
		if (block.type === "tool_result") {
			if (consumedToolResultIndexes.has(index)) return;
			messages.push(
				createIntermediateMessage({
					spaceId: input.spaceId,
					sessionId: input.sessionId,
					turnId: input.turnId,
					id: buildMessageId({
						sessionId: input.sessionId,
						turnId: input.turnId,
						streamIndex,
						index,
						suffix: `tool_result:${block.tool_use_id}`,
					}),
					content: [block],
					text: blockText(block),
					errorMessage: block.is_error ? blockText(block) : null,
					createdAt,
				}),
			);
			return;
		}

		if (block.type === "tool_use") {
			const result = toolResultsByUseId.get(block.id);
			if (result) consumedToolResultIndexes.add(result.index);
			const content = result ? [block, result.block] : [block];
			messages.push(
				createIntermediateMessage({
					spaceId: input.spaceId,
					sessionId: input.sessionId,
					turnId: input.turnId,
					id: buildMessageId({
						sessionId: input.sessionId,
						turnId: input.turnId,
						streamIndex,
						index,
						suffix: `tool:${block.id}`,
					}),
					content,
					text: blockText(result?.block ?? block),
					errorMessage: result?.block.is_error ? blockText(result.block) : null,
					createdAt,
				}),
			);
			return;
		}

		messages.push(
			createIntermediateMessage({
				spaceId: input.spaceId,
				sessionId: input.sessionId,
				turnId: input.turnId,
				id: buildMessageId({
					sessionId: input.sessionId,
					turnId: input.turnId,
					streamIndex,
					index,
					suffix: block.type,
				}),
				content: [block],
				text: blockText(block),
				createdAt,
			}),
		);
	});

	return messages;
}
