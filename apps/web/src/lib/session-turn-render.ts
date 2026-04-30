import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { SessionTurnRecord } from "@neta-art/cohub-protocol/model";
import { getStreamingRenderKey } from "$lib/session-streaming";
import type { ChatMessage, TimelineItem } from "$lib/session-tree";

function turnToUserMessage(turn: SessionTurnRecord): ChatMessage {
	const meta = turn.meta ?? {};
	return {
		id: `turn:${turn.id}:user`,
		sourceId: turn.id,
		role: "user",
		content: turn.userContent,
		text: turn.userText ?? "",
		sequence: turn.sequence * 10,
		blocks: [...turn.userContent],
		authorUuid: (meta.authorUuid as string | undefined) ?? turn.userUuid,
		authorName: (meta.authorName as string | undefined) ?? null,
		authorAvatar: (meta.authorAvatar as string | undefined) ?? null,
		createdAt: turn.startedAt ?? turn.createdAt,
		meta: {
			messageKind: "turn_user",
			turnId: turn.id,
		},
	};
}

function turnToAssistantMessage(turn: SessionTurnRecord): ChatMessage | null {
	if (!turn.assistantContent && !turn.errorMessage && !turn.assistantText)
		return null;
	const content =
		turn.assistantContent ??
		(turn.assistantText
			? [{ type: "text", text: turn.assistantText } satisfies ContentBlock]
			: []);
	return {
		id: `turn:${turn.id}:assistant`,
		sourceId: turn.id,
		role: "assistant",
		content,
		text: turn.assistantText ?? turn.errorMessage ?? "",
		sequence: turn.sequence * 10 + 2,
		blocks: [...content],
		createdAt: turn.completedAt ?? turn.updatedAt,
		meta: {
			messageKind:
				turn.status === "failed"
					? "assistant_error"
					: turn.status === "interrupted"
						? "assistant_interrupted"
						: "assistant_final",
			turnId: turn.id,
			model: turn.model,
			provider: turn.provider,
			usage: turn.usage,
			stopReason: turn.stopReason,
			errorMessage: turn.errorMessage,
		},
	};
}

function buildStreamingPreviewBlocks(
	content: ContentBlock[],
	options?: { truncatedStart?: boolean },
) {
	if (content.length === 0) return [];
	const text = content
		.filter((block) => block.type === "text")
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("\n\n")
		.trim();
	const thinking = content
		.filter((block) => block.type === "thinking")
		.map((block) => (block.type === "thinking" ? block.thinking : ""))
		.join("\n\n")
		.trim();
	const passthrough = content.filter(
		(block) => block.type !== "text" && block.type !== "thinking",
	);
	const blocks: ContentBlock[] = [];
	if (thinking) blocks.push({ type: "thinking", thinking });
	if (text)
		blocks.push({
			type: "text",
			text: options?.truncatedStart ? `…${text}` : text,
		});
	blocks.push(...passthrough);
	return blocks;
}

export function buildTurnTimelineItems(input: {
	sessionId: string | null;
	turns: SessionTurnRecord[];
	streaming?: {
		sessionId: string;
		turnId?: string | null;
		anchorUserMessageId?: string | null;
		contentBlocks: ContentBlock[];
		truncatedStart?: boolean;
		status?: "pending" | "streaming";
	} | null;
}): TimelineItem[] {
	const items: TimelineItem[] = [];
	for (const turn of input.turns) {
		items.push({
			id: `turn:${turn.id}:user`,
			kind: "message",
			message: turnToUserMessage(turn),
		});
		if (turn.intermediateSummary && turn.intermediateSummary.messageCount > 0) {
			items.push({
				id: `turn:${turn.id}:process`,
				kind: "process",
				turn,
				summary: turn.intermediateSummary,
			});
		}
		const assistant = turnToAssistantMessage(turn);
		if (assistant)
			items.push({
				id: `turn:${turn.id}:assistant`,
				kind: "message",
				message: assistant,
			});
	}
	const fallbackSequence = (input.turns.at(-1)?.sequence ?? 0) * 10 + 10;
	const streamingBlocks = input.streaming?.contentBlocks ?? [];
	const showPendingPlaceholder =
		input.streaming?.status === "pending" && streamingBlocks.length === 0;
	if (streamingBlocks.length > 0 || showPendingPlaceholder) {
		const renderKey = getStreamingRenderKey(
			input.streaming?.anchorUserMessageId ?? null,
			input.streaming?.sessionId ?? "active",
		);
		const blocks = buildStreamingPreviewBlocks(streamingBlocks, {
			truncatedStart: input.streaming?.truncatedStart,
		});
		const effectiveBlocks =
			blocks.length > 0
				? blocks
				: ([{ type: "thinking", thinking: "Thinking…" }] as ContentBlock[]);
		items.push({
			id: renderKey,
			kind: "message",
			message: {
				id: renderKey,
				role: "assistant",
				content: effectiveBlocks,
				text:
					effectiveBlocks.find((block) => block.type === "text")?.text ?? "",
				sequence: fallbackSequence + 1,
				createdAt: new Date().toISOString(),
				meta: { messageKind: "assistant_streaming_preview" },
			},
		});
	}
	return items;
}
