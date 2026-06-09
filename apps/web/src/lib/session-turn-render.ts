import type { ContentBlock } from "@cohub/protocol/core";
import type {
	SessionTurnIntermediateSummary,
	SessionTurnRecord,
	StoredIntermediateMessage,
} from "@cohub/protocol/model";
import { getStreamingRenderKey } from "./session-streaming";
import type { ChatMessage, TimelineItem } from "./session-tree";

function getTurnContextWindow(turn: SessionTurnRecord) {
	const raw = turn.meta?.contextWindow;
	return typeof raw === "number" && raw > 0 ? raw : null;
}

function getTurnClientMessageId(turn: Pick<SessionTurnRecord, "meta">) {
	const value = turn.meta?.clientMessageId;
	return typeof value === "string" && value.trim() ? value : null;
}

function isOptimisticTurn(turn: Pick<SessionTurnRecord, "meta">) {
	return turn.meta?.optimistic === true;
}

function isTerminalTurn(turn: SessionTurnRecord) {
	return (
		turn.status === "completed" ||
		turn.status === "failed" ||
		turn.status === "interrupted" ||
		turn.status === "merged" ||
		turn.status === "cancelled"
	);
}

function parseTurnUpdatedAt(turn: SessionTurnRecord) {
	const value = Date.parse(turn.updatedAt);
	return Number.isFinite(value) ? value : 0;
}

function shouldPreferRenderableTurn(
	current: SessionTurnRecord,
	incoming: SessionTurnRecord,
) {
	if (isOptimisticTurn(current) && !isOptimisticTurn(incoming)) return true;
	if (!isOptimisticTurn(current) && isOptimisticTurn(incoming)) return false;
	if (!isTerminalTurn(current) && isTerminalTurn(incoming)) return true;
	if (isTerminalTurn(current) && !isTerminalTurn(incoming)) return false;
	return parseTurnUpdatedAt(incoming) >= parseTurnUpdatedAt(current);
}

function dedupeRenderableTurnsByClientMessageId(turns: SessionTurnRecord[]) {
	const byClientMessageId = new Map<string, SessionTurnRecord>();
	const withoutClientMessageId: SessionTurnRecord[] = [];
	for (const turn of turns) {
		const clientMessageId = getTurnClientMessageId(turn);
		if (!clientMessageId) {
			withoutClientMessageId.push(turn);
			continue;
		}
		const current = byClientMessageId.get(clientMessageId);
		if (!current || shouldPreferRenderableTurn(current, turn)) {
			byClientMessageId.set(clientMessageId, turn);
		}
	}
	return [...withoutClientMessageId, ...byClientMessageId.values()].sort(
		(a, b) => a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt),
	);
}

function getFinalMessageDurationMs(turn: SessionTurnRecord) {
	const raw = turn.meta?.finalMessageDurationMs;
	return typeof raw === "number" && raw > 0 ? raw : null;
}

export function turnToUserMessage(turn: SessionTurnRecord): ChatMessage {
	const meta = turn.meta ?? {};
	return {
		id: `turn:${turn.id}:user`,
		sourceId: turn.id,
		role: "user",
		content: turn.userContent,
		text: turn.userText ?? "",
		sequence: turn.sequence * 10,
		blocks: [...turn.userContent],
		authorUuid: (meta.userId as string | undefined) ?? turn.userUuid,
		authorProfile: turn.authorProfile ?? null,
		createdAt: turn.startedAt ?? turn.createdAt,
		meta: {
			messageKind: "turn_user",
			turnId: turn.id,
			turn,
		},
	};
}

export function turnToAssistantMessage(
	turn: SessionTurnRecord,
): ChatMessage | null {
	const isAborted = turn.stopReason === "aborted";
	if (
		!turn.assistantContent &&
		!turn.errorMessage &&
		!turn.assistantText &&
		!isAborted
	)
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
		text: isAborted
			? (turn.assistantText ?? "")
			: (turn.assistantText ?? turn.errorMessage ?? ""),
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
			turn,
			model: turn.model,
			provider: turn.provider,
			contextWindow: getTurnContextWindow(turn),
			usage: turn.finalUsage,
			durationMs: getFinalMessageDurationMs(turn),
			stopReason: turn.stopReason,
			errorMessage: isAborted ? null : turn.errorMessage,
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
			const text = block.text;
			if (!text.trim()) return [];
			const nextText =
				options?.truncatedStart && !appliedTruncatedPrefix
					? `…${text.trimStart()}`
					: text;
			appliedTruncatedPrefix = true;
			return [{ ...block, text: nextText }];
		}
		if (block.type === "thinking") {
			const thinking = block.thinking;
			return thinking.trim() ? [{ ...block, thinking }] : [];
		}
		return [block];
	});
}

function isQueuedFollowupTurn(turn: SessionTurnRecord) {
	return turn.status === "queued" && turn.intent === "followup";
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
		runtimePhase?: "llm_call_started" | null;
		runtimeProvider?: string | null;
		runtimeModel?: string | null;
		finalizedPreview?: boolean;
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
	for (const turn of dedupeRenderableTurnsByClientMessageId(input.turns)) {
		if (isQueuedFollowupTurn(turn)) continue;
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
			(!streamingTurnId || streamingTurnId === turn.id)
		) {
			const processIntermediateMessages =
				input.streaming?.intermediateMessages ?? [];
			const showRuntimeStatus =
				input.streaming?.runtimePhase === "llm_call_started";
			const showStartingStatus =
				input.streaming?.status === "pending" &&
				(input.streaming?.contentBlocks.length ?? 0) === 0;
			streamingProcessInserted = true;
			if (
				processIntermediateMessages.length > 0 ||
				showRuntimeStatus ||
				showStartingStatus
			) {
				const summary = {
					messageCount: processIntermediateMessages.length,
					toolCallCount: processIntermediateMessages.reduce(
						(count, message) =>
							count +
							message.content.filter((block) => block.type === "tool_use")
								.length,
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
					runtimePhase: input.streaming?.runtimePhase ?? null,
					runtimeProvider: input.streaming?.runtimeProvider ?? null,
					runtimeModel: input.streaming?.runtimeModel ?? null,
				});
			}
		}
		const assistant = turnToAssistantMessage(turn);
		if (assistant) {
			if (hasStreamingState && streamingTurnId === turn.id) {
				// Keep the live streaming preview as the visual source of truth until
				// generation is marked terminal. Finalized / reconciled turn patches can
				// arrive before the full persisted turn is available, and temporarily
				// swapping to those partial records makes blocks such as thinking vanish
				// and then reappear on the next fetch.
			} else {
				items.push({
					id: `turn:${turn.id}:assistant`,
					kind: "message",
					message: assistant,
				});
			}
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
					finalUsage: null,
					totalUsage: null,
					summary: null,
					intermediateIndex: null,
					intermediateSummary: null,
					meta: null,
					startedAt: null,
					completedAt: null,
					durationMs: null,
					createdAt: renderCreatedAt,
					updatedAt: renderCreatedAt,
				} satisfies SessionTurnRecord);
		const processIntermediateMessages =
			input.streaming?.intermediateMessages ?? [];
		const showRuntimeStatus =
			input.streaming?.runtimePhase === "llm_call_started";
		const showStartingStatus =
			input.streaming?.status === "pending" &&
			(input.streaming?.contentBlocks.length ?? 0) === 0;
		if (
			processIntermediateMessages.length > 0 ||
			showRuntimeStatus ||
			showStartingStatus
		) {
			items.push({
				id: `turn:${turn.id}:process:streaming`,
				kind: "process",
				turn,
				summary: {
					messageCount: processIntermediateMessages.length,
					toolCallCount: processIntermediateMessages.reduce(
						(count, message) =>
							count +
							message.content.filter((block) => block.type === "tool_use")
								.length,
						0,
					),
				},
				intermediateMessages: processIntermediateMessages,
				streaming: true,
				runtimePhase: input.streaming?.runtimePhase ?? null,
				runtimeProvider: input.streaming?.runtimeProvider ?? null,
				runtimeModel: input.streaming?.runtimeModel ?? null,
			});
		}
	}
	const streamingBlocks = input.streaming?.contentBlocks ?? [];
	const showPendingPlaceholder = false;
	if (streamingBlocks.length > 0 || showPendingPlaceholder) {
		const renderKey = getStreamingRenderKey(
			input.streaming?.anchorUserMessageId ?? null,
			input.streaming?.sessionId ?? "active",
			input.streaming?.turnId ?? null,
		);
		const blocks = buildStreamingPreviewBlocks(streamingBlocks, {
			truncatedStart: input.streaming?.truncatedStart,
		});
		const effectiveBlocks =
			blocks.length > 0
				? blocks
				: ([
						{ type: "thinking", thinking: "Starting agent…" },
					] as ContentBlock[]);
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
