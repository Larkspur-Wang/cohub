import type { ContentBlock } from "@cohub/protocol/core";
import type {
	GenerationStreamEvent,
	GenerationStreamLifecycleEvent,
	GenerationStreamStateEvent,
} from "@neta-art/cohub";
import type { StreamingIntermediateMessage } from "./session-generation.svelte";
import { sessionGenerationStore } from "./session-generation.svelte";
import {
	failGeneration,
	interruptGeneration,
} from "./session-generation-controller";

type HandledGenerationRealtimeEffect = {
	handled: true;
	shouldScroll: boolean;
	shouldReconcile: boolean;
	shouldRestoreSnapshot: boolean;
	shouldRefreshSessions: boolean;
};

export type GenerationRealtimeEffect =
	| HandledGenerationRealtimeEffect
	| {
			handled: false;
			shouldScroll: false;
			shouldReconcile: false;
			shouldRestoreSnapshot: false;
			shouldRefreshSessions: false;
	  };

const ignoredEffect: GenerationRealtimeEffect = {
	handled: false,
	shouldScroll: false,
	shouldReconcile: false,
	shouldRestoreSnapshot: false,
	shouldRefreshSessions: false,
};

function handledEffect(
	input: Omit<HandledGenerationRealtimeEffect, "handled">,
): GenerationRealtimeEffect {
	return {
		handled: true,
		...input,
	};
}

/**
 * Extract visible text from content blocks, normalizing for comparison.
 * Empty/whitespace-only thinking and text blocks are excluded to match
 * the behavior of `buildStreamingPreviewBlocks`, which filters them out
 * during streaming.
 */
function getVisibleTextContent(blocks: ContentBlock[]): string {
	return blocks
		.map((block) => {
			if (block.type === "text") return block.text.trim();
			if (block.type === "thinking") return block.thinking.trim();
			return "";
		})
		.filter(Boolean)
		.join("\n\n");
}

/**
 * Compare two sets of content blocks by their visible text content.
 * Used to avoid replacing streaming-accumulated blocks with the server's
 * final blocks when the rendered text is already identical.
 */
function isContentTextuallySame(a: ContentBlock[], b: ContentBlock[]): boolean {
	return getVisibleTextContent(a) === getVisibleTextContent(b);
}

function resolveStreamMessageId(input: {
	sessionId: string;
	turnId?: string | null;
	anchorUserMessageId?: string | null;
	messageId?: string | null;
	messageOrdinal?: number | null;
}) {
	if (input.messageId?.trim()) return input.messageId.trim();
	if (input.messageOrdinal == null) return null;
	if (input.turnId?.trim()) {
		return `turn:${input.turnId.trim()}:assistant:${input.messageOrdinal}`;
	}
	return `session:${input.sessionId}:assistant:${input.messageOrdinal}:${input.anchorUserMessageId ?? "unknown"}`;
}

function normalizeIntermediateMessages(
	messages:
		| GenerationStreamStateEvent["intermediateMessages"]
		| StreamingIntermediateMessage[]
		| undefined,
): StreamingIntermediateMessage[] {
	return (messages ?? [])
		.filter((message) => Array.isArray(message.content))
		.map((message) => ({
			...message,
			messageId: message.messageId ?? null,
			messageOrdinal: message.messageOrdinal ?? null,
			content: message.content,
		}));
}

function getIntermediateMessageKey(message: StreamingIntermediateMessage) {
	if (message.messageOrdinal != null)
		return `ordinal:${message.messageOrdinal}`;
	if (message.messageId) return `message:${message.messageId}`;
	if (message.id) return `id:${message.id}`;
	try {
		return `content:${JSON.stringify(message.content)}`;
	} catch {
		return null;
	}
}

function compactIntermediateMessages(messages: StreamingIntermediateMessage[]) {
	const merged: StreamingIntermediateMessage[] = [];
	const indexByKey = new Map<string, number>();
	for (const message of messages) {
		const key = getIntermediateMessageKey(message);
		if (!key) {
			merged.push(message);
			continue;
		}
		const index = indexByKey.get(key);
		if (index == null) {
			indexByKey.set(key, merged.length);
			merged.push(message);
			continue;
		}
		merged[index] = { ...merged[index], ...message };
	}
	// DEBUG(each_key_duplicate 排查): 合并后再次全量掃描 ordinal 重复，确认去重是否真正收敛。
	const ordinalOwners = new Map<number, number>();
	for (const message of merged) {
		if (message.messageOrdinal == null) continue;
		ordinalOwners.set(
			message.messageOrdinal,
			(ordinalOwners.get(message.messageOrdinal) ?? 0) + 1,
		);
	}
	const dupOrdinals = [...ordinalOwners.entries()].filter(
		([, count]) => count > 1,
	);
	if (dupOrdinals.length > 0) {
		console.log(
			"[each_key_duplicate DEBUG] web compactIntermediateMessages produced duplicate ordinals",
			{
				inputCount: messages.length,
				inputOrdinals: messages.map((m) => m.messageOrdinal),
				inputKeys: messages.map((m) => getIntermediateMessageKey(m)),
				mergedCount: merged.length,
				mergedOrdinals: merged.map((m) => m.messageOrdinal),
				dupOrdinals,
			},
		);
	}
	return merged;
}

function mergeIntermediateMessages(
	current: StreamingIntermediateMessage[],
	incoming: StreamingIntermediateMessage[],
) {
	if (current.length === 0) return compactIntermediateMessages(incoming);
	if (incoming.length === 0) return compactIntermediateMessages(current);
	return compactIntermediateMessages([...current, ...incoming]);
}

function resolveIntermediateMessagesForState(
	sessionId: string,
	event: GenerationStreamStateEvent,
) {
	const incoming = normalizeIntermediateMessages(event.intermediateMessages);
	const current = sessionGenerationStore.get(sessionId);
	const sameTurn = Boolean(
		current?.turnId &&
			event.state.turnId &&
			current.turnId === event.state.turnId,
	);
	// DEBUG(each_key_duplicate 排查): 核心疑点——页面刷新时存在两条并行的快照恢复路径：
	// (1) SDK 内部 SessionGenerationStreamClient.subscribe({recover:true}) -> seedFromSnapshot
	//     -> emit type:"state",source:"snapshot" -> 运行到这里
	// (2) SpaceWorkspacePage 的 syncGenerationStateFromTail -> resumePending(不清空
	//     intermediateMessages) + restoreSessionStreamSnapshot -> applyGenerationStreamSnapshot
	// 两者都写同一个 sessionGenerationStore。如果路径(2)先把 turnId/intermediateMessages
	// 写入 store，路径(1)的 state 事件后到达时 sameTurn 会为 true，触发 current+incoming 拼接，
	// 如果两边相同 ordinal 的记录 key 计算结果不一致(比如字段缺失导致 fallback 到不同 key)，
	// 就会导致 compactIntermediateMessages 去重失败，最终在 ProcessCard 产生重复 msg.id。
	console.log(
		"[each_key_duplicate DEBUG] resolveIntermediateMessagesForState",
		{
			sessionId,
			eventSource: event.source,
			eventTurnId: event.state.turnId,
			currentTurnId: current?.turnId ?? null,
			sameTurn,
			currentIntermediateOrdinals: (current?.intermediateMessages ?? []).map(
				(m) => m.messageOrdinal,
			),
			currentIntermediateKeys: (current?.intermediateMessages ?? []).map((m) =>
				getIntermediateMessageKey(m),
			),
			incomingOrdinals: incoming.map((m) => m.messageOrdinal),
			incomingKeys: incoming.map((m) => getIntermediateMessageKey(m)),
		},
	);
	return sameTurn
		? mergeIntermediateMessages(current?.intermediateMessages ?? [], incoming)
		: incoming;
}

function applyGenerationState(
	sessionId: string,
	event: GenerationStreamStateEvent,
) {
	sessionGenerationStore.applyProgress(sessionId, {
		spaceId: event.state.spaceId,
		contentBlocks: event.state.contentBlocks,
		intermediateMessages: resolveIntermediateMessagesForState(sessionId, event),
		streamMessageId: event.messageId,
		messageOrdinal: event.messageOrdinal,
		anchorUserMessageId: event.state.anchorUserMessageId,
		truncatedStart: shouldMarkTruncatedStart(sessionId, event),
		patchSeq: event.state.patchSeq,
		turnId: event.state.turnId,
	});
}

function shouldMarkTruncatedStart(
	sessionId: string,
	event: GenerationStreamStateEvent,
) {
	const current = sessionGenerationStore.get(sessionId);
	if (current?.status !== "pending") return false;
	if (event.source === "patch") {
		return event.state.patchSeq > 0 && current.contentBlocks.length === 0;
	}
	return false;
}

export function applyGenerationStreamSnapshot(
	sessionId: string,
	input: {
		spaceId?: string | null;
		turnId?: string | null;
		seq: number;
		anchorUserMessageId?: string | null;
		current: {
			messageId?: string | null;
			messageOrdinal?: number | null;
			content: ContentBlock[];
		};
		intermediateMessages?: StreamingIntermediateMessage[];
		lifecycle?: {
			phase: "llm_call_started";
			llmRound: number;
			provider: string | null;
			model: string | null;
			at: string;
		} | null;
	},
) {
	const current = sessionGenerationStore.get(sessionId);
	const resolvedTurnId = input.turnId ?? current?.turnId ?? null;
	if (
		current?.turnId &&
		resolvedTurnId &&
		current.turnId === resolvedTurnId &&
		current.patchSeq > input.seq
	) {
		return { applied: false, reason: "stale_snapshot" as const };
	}
	const hasSnapshotContent =
		input.current.content.length > 0 ||
		(input.intermediateMessages?.length ?? 0) > 0;
	if (!hasSnapshotContent) {
		if (input.lifecycle?.phase === "llm_call_started") {
			sessionGenerationStore.markRuntimePhase(sessionId, {
				phase: "llm_call_started",
				at: input.lifecycle.at,
				llmRound: input.lifecycle.llmRound,
				provider: input.lifecycle.provider,
				model: input.lifecycle.model,
				spaceId: input.spaceId ?? current?.spaceId ?? null,
				turnId: resolvedTurnId,
				anchorUserMessageId:
					input.anchorUserMessageId ?? current?.anchorUserMessageId ?? null,
			});
		}
		return input.lifecycle
			? { applied: true as const }
			: { applied: false as const, reason: "empty_snapshot" as const };
	}
	// Skip contentBlocks update when textually identical to avoid
	// resetting the StreamingMarkdownController's typing animation.
	const currentBlocks = current?.contentBlocks ?? [];
	const snapshotBlocks = input.current.content;
	const skipContentUpdate =
		snapshotBlocks.length > 0 &&
		isContentTextuallySame(currentBlocks, snapshotBlocks);
	const currentIntermediateMessages = current?.intermediateMessages ?? [];
	const incomingIntermediateMessages = normalizeIntermediateMessages(
		input.intermediateMessages,
	);
	// DEBUG(each_key_duplicate 排查): 核心疑点——这是路径(2)：页面初始化时
	// syncGenerationStateFromTail -> resumePending + restoreSessionStreamSnapshot 最终调到
	// 这里。如果此时 current.turnId 已被 resumePending 提前设为本次 turn(但
	// intermediateMessages 还是旧的/空的)，会触发 mergeIntermediateMessages 拼接，
	// 与另一条并行路径(SDK seedFromSnapshot -> resolveIntermediateMessagesForState)
	// 存在竟态，可能导致同一批 ordinal 被两条路径各自写入一遍。
	console.log("[each_key_duplicate DEBUG] applyGenerationStreamSnapshot", {
		sessionId,
		inputTurnId: input.turnId,
		currentTurnId: current?.turnId ?? null,
		resolvedTurnId,
		sameTurnAsCurrent: Boolean(
			current?.turnId && resolvedTurnId && current.turnId === resolvedTurnId,
		),
		currentIntermediateOrdinals: currentIntermediateMessages.map(
			(m) => m.messageOrdinal,
		),
		incomingIntermediateOrdinals: incomingIntermediateMessages.map(
			(m) => m.messageOrdinal,
		),
	});
	sessionGenerationStore.applyProgress(sessionId, {
		spaceId: input.spaceId ?? current?.spaceId ?? null,
		contentBlocks: skipContentUpdate ? currentBlocks : snapshotBlocks,
		intermediateMessages:
			current?.turnId && resolvedTurnId && current.turnId === resolvedTurnId
				? mergeIntermediateMessages(
						currentIntermediateMessages,
						incomingIntermediateMessages,
					)
				: incomingIntermediateMessages,
		streamMessageId: resolveStreamMessageId({
			sessionId,
			turnId: resolvedTurnId,
			anchorUserMessageId:
				input.anchorUserMessageId ?? current?.anchorUserMessageId,
			messageId: input.current.messageId,
			messageOrdinal: input.current.messageOrdinal,
		}),
		messageOrdinal: input.current.messageOrdinal ?? null,
		anchorUserMessageId:
			input.anchorUserMessageId ?? current?.anchorUserMessageId ?? null,
		truncatedStart: false,
		patchSeq: input.seq,
		turnId: resolvedTurnId,
	});
	if (input.lifecycle?.phase === "llm_call_started") {
		sessionGenerationStore.markRuntimePhase(sessionId, {
			phase: "llm_call_started",
			at: input.lifecycle.at,
			llmRound: input.lifecycle.llmRound,
			provider: input.lifecycle.provider,
			model: input.lifecycle.model,
			spaceId: input.spaceId ?? current?.spaceId ?? null,
			turnId: resolvedTurnId,
			anchorUserMessageId:
				input.anchorUserMessageId ?? current?.anchorUserMessageId ?? null,
		});
	}
	return { applied: true as const };
}

function applyGenerationLifecycle(
	sessionId: string,
	event: GenerationStreamLifecycleEvent,
) {
	sessionGenerationStore.markRuntimePhase(sessionId, {
		phase: event.phase,
		at: event.at,
		llmRound: event.llmRound,
		provider: event.provider,
		model: event.model,
		turnId: event.turnId,
		anchorUserMessageId: event.anchorUserMessageId,
	});
}

export function applyGenerationStreamEvent(
	sessionId: string,
	event: GenerationStreamEvent,
): GenerationRealtimeEffect {
	if (event.type === "lifecycle") {
		applyGenerationLifecycle(sessionId, event);
		return handledEffect({
			shouldScroll: false,
			shouldReconcile: false,
			shouldRestoreSnapshot: false,
			shouldRefreshSessions: false,
		});
	}

	if (event.type === "state") {
		applyGenerationState(sessionId, event);
		return handledEffect({
			shouldScroll: true,
			shouldReconcile: false,
			shouldRestoreSnapshot: false,
			shouldRefreshSessions: false,
		});
	}

	if (event.type === "commit") {
		if (event.commit.kind === "final" || event.commit.kind === "error") {
			// Apply the full content blocks from the persisted message
			// (session.message.persisted) which carries complete content
			// including thinking, tool_use, tool_result, etc.
			const commitContent = event.commit.message.content;
			if (Array.isArray(commitContent) && commitContent.length > 0) {
				const current = sessionGenerationStore.get(sessionId);
				const currentBlocks = current?.contentBlocks ?? [];
				if (!isContentTextuallySame(currentBlocks, commitContent)) {
					sessionGenerationStore.applyProgress(sessionId, {
						contentBlocks: commitContent,
						finalizedPreview: true,
					});
				}
			}
			return handledEffect({
				shouldScroll: true,
				shouldReconcile: true,
				shouldRestoreSnapshot: false,
				shouldRefreshSessions: true,
			});
		}
		return handledEffect({
			shouldScroll: false,
			shouldReconcile: false,
			shouldRestoreSnapshot: false,
			shouldRefreshSessions: false,
		});
	}

	if (event.type === "finalized") {
		if (
			event.turn.status === "interrupted" ||
			event.turn.status === "merged" ||
			event.turn.status === "cancelled"
		) {
			interruptGeneration(sessionId);
			return handledEffect({
				shouldScroll: false,
				shouldReconcile: true,
				shouldRestoreSnapshot: false,
				shouldRefreshSessions: true,
			});
		}
		// Content blocks are NOT updated here — session.turn.finalized
		// strips assistantContent (via toRealtimeTurnRecord). The full
		// content is applied by the preceding commit event
		// (session.message.persisted) which arrives a few ms earlier.
		return handledEffect({
			shouldScroll: true,
			shouldReconcile: true,
			shouldRestoreSnapshot: false,
			shouldRefreshSessions: true,
		});
	}

	if (event.type === "error") {
		failGeneration(sessionId, event.message);
		return handledEffect({
			shouldScroll: false,
			shouldReconcile: false,
			shouldRestoreSnapshot: false,
			shouldRefreshSessions: false,
		});
	}

	if (event.type === "out_of_sync") {
		const shouldRestoreSnapshot =
			event.reason === "version_mismatch" && event.source === "patch";
		return handledEffect({
			shouldScroll: false,
			shouldReconcile: true,
			shouldRestoreSnapshot,
			shouldRefreshSessions: false,
		});
	}

	return ignoredEffect;
}
