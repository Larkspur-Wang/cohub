import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type {
	SessionTurnIntermediateSummary,
	SessionTurnRecord,
	StoredIntermediateMessage,
} from "@neta-art/cohub-protocol/model";
import { getStreamingRenderKey } from "./session-streaming";
import { buildStreamingIntermediateMessages } from "./session-streaming-intermediate";
import type { ChatMessage, TimelineItem } from "./session-tree";

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

export function buildStreamingPreviewBlocks(
	content: ContentBlock[],
	options?: { truncatedStart?: boolean },
) {
	if (content.length === 0) return [];

	let appliedTruncatedPrefix = false;
	return content.flatMap((block): ContentBlock[] => {
		if (block.type === "text") {
			const text = block.text.trim();
			if (!text) return [];
			const nextText =
				options?.truncatedStart && !appliedTruncatedPrefix ? `…${text}` : text;
			appliedTruncatedPrefix = true;
			return [{ ...block, text: nextText }];
		}
		if (block.type === "thinking") {
			const thinking = block.thinking.trim();
			return thinking ? [{ ...block, thinking }] : [];
		}
		return [block];
	});
}

export function buildTurnTimelineItems(input: {
	sessionId: string | null;
	turns: SessionTurnRecord[];
	streaming?: {
		sessionId: string;
		turnId?: string | null;
		anchorUserMessageId?: string | null;
		contentBlocks: ContentBlock[];
		intermediateMessages?: StoredIntermediateMessage[];
		truncatedStart?: boolean;
		status?: string;
	} | null;
}): TimelineItem[] {
	const renderCreatedAt = new Date().toISOString();
	const items: TimelineItem[] = [];
	const streamingTurnId = input.streaming?.turnId ?? null;
	const hasStreamingState = Boolean(
		input.streaming &&
			(input.streaming.status === "pending" ||
				input.streaming.status === "streaming"),
	);
	let streamingProcessInserted = false;
	let streamingAssistantInserted = false;
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
			if (streamingTurnId === turn.id) streamingProcessInserted = true;
		} else if (
			hasStreamingState &&
			turn.status === "running" &&
			(!streamingTurnId || streamingTurnId === turn.id)
		) {
			const intermediateMessages =
				input.streaming?.intermediateMessages ??
				buildStreamingIntermediateMessages({
					sessionId:
						input.streaming?.sessionId ?? input.sessionId ?? turn.sessionId,
					turnId: input.streaming?.turnId ?? turn.id,
					contentBlocks: input.streaming?.contentBlocks ?? [],
					createdAt: renderCreatedAt,
				});
			const processIntermediateMessages = intermediateMessages.slice(0, -1);
			const summary = {
				messageCount: processIntermediateMessages.length,
				toolCallCount: processIntermediateMessages.reduce(
					(count, message) =>
						count +
						message.content.filter((block) => block.type === "tool_use").length,
					0,
				),
			} satisfies SessionTurnIntermediateSummary;
			items.push({
				id: `turn:${turn.id}:process:streaming`,
				kind: "process",
				turn,
				summary,
				intermediateMessages: processIntermediateMessages,
				streaming: true,
			});
			streamingProcessInserted = true;
		}
		const assistant = turnToAssistantMessage(turn);
		if (assistant) {
			if (streamingTurnId === turn.id) {
				streamingProcessInserted = true;
				streamingAssistantInserted = true;
			}
			items.push({
				id: `turn:${turn.id}:assistant`,
				kind: "message",
				message: assistant,
			});
		}
	}
	const fallbackSequence = (input.turns.at(-1)?.sequence ?? 0) * 10 + 10;
	if (hasStreamingState && !streamingProcessInserted) {
		const fallbackTurn = input.turns.at(-1);
		const sessionId = input.streaming?.sessionId ?? input.sessionId ?? "active";
		const turn = fallbackTurn
			? { ...fallbackTurn, status: "running" as const }
			: ({
					id: input.streaming?.turnId ?? `streaming:${sessionId}`,
					sessionId,
					userUuid: null,
					sequence: Math.max(1, Math.floor(fallbackSequence / 10)),
					status: "running",
					intent: "steer",
					userContent: [],
					userText: null,
					assistantContent: null,
					assistantText: null,
					provider: null,
					model: null,
					stopReason: null,
					errorMessage: null,
					usage: null,
					summary: null,
					intermediateIndex: null,
					intermediateSummary: null,
					meta: null,
					startedAt: null,
					completedAt: null,
					createdAt: renderCreatedAt,
					updatedAt: renderCreatedAt,
				} satisfies SessionTurnRecord);
		const intermediateMessages =
			input.streaming?.intermediateMessages ??
			buildStreamingIntermediateMessages({
				sessionId,
				turnId: input.streaming?.turnId ?? turn.id,
				contentBlocks: input.streaming?.contentBlocks ?? [],
				createdAt: renderCreatedAt,
			});
		const processIntermediateMessages = intermediateMessages.slice(0, -1);
		items.push({
			id: `turn:${turn.id}:process:streaming`,
			kind: "process",
			turn,
			summary: {
				messageCount: processIntermediateMessages.length,
				toolCallCount: processIntermediateMessages.reduce(
					(count, message) =>
						count +
						message.content.filter((block) => block.type === "tool_use").length,
					0,
				),
			},
			intermediateMessages: processIntermediateMessages,
			streaming: true,
		});
	}
	const streamingBlocks = input.streaming?.contentBlocks ?? [];
	const latestStreamingMessage = input.streaming?.intermediateMessages?.at(-1);
	const showPendingPlaceholder =
		input.streaming?.status === "pending" && streamingBlocks.length === 0;
	if (
		!streamingAssistantInserted &&
		(latestStreamingMessage || showPendingPlaceholder)
	) {
		const renderKey = getStreamingRenderKey(
			input.streaming?.turnId ?? input.streaming?.anchorUserMessageId ?? null,
			input.streaming?.sessionId ?? "active",
		);
		const blocks = latestStreamingMessage
			? buildStreamingPreviewBlocks(latestStreamingMessage.content, {
					truncatedStart: input.streaming?.truncatedStart,
				})
			: [];
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
				createdAt: renderCreatedAt,
				meta: { messageKind: "assistant_streaming_preview" },
			},
		});
	}
	return items;
}
