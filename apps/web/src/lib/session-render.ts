import type { ContentBlock, MessageRecord } from "@cohub/protocol";
import type { ChatMessage, TimelineItem } from "$lib/session-tree";
import type { PendingSessionMessage } from "$lib/stores/session-pending.svelte";

export function extractSessionRenderState(content: ContentBlock[]) {
	const thinkingBlocks = content.filter(
		(block): block is Extract<ContentBlock, { type: "thinking" }> =>
			block.type === "thinking",
	);
	const textBlocks = content.filter(
		(block): block is Extract<ContentBlock, { type: "text" }> =>
			block.type === "text",
	);
	const toolUseBlocks = content.filter(
		(block): block is Extract<ContentBlock, { type: "tool_use" }> =>
			block.type === "tool_use",
	);

	const thinking = thinkingBlocks
		.map((block) => block.thinking)
		.join("\n")
		.trim();
	const answer = textBlocks
		.map((block) => block.text)
		.join("\n")
		.trim();
	const toolCalls = toolUseBlocks.map((block) => ({
		toolCallId: block.id,
		toolName: block.name,
		status:
			(block._meta as { toolStatus?: string } | undefined)?.toolStatus ??
			"queued",
		summary: (block._meta as { summary?: string } | undefined)?.summary ?? "",
	}));

	return { thinking, answer, toolCalls };
}

function getClientMessageId(meta: Record<string, unknown> | null | undefined) {
	const clientMessageId = meta?.clientMessageId;
	return typeof clientMessageId === "string" && clientMessageId.trim()
		? clientMessageId.trim()
		: null;
}

function getAnchorUserMessageId(
	meta: Record<string, unknown> | null | undefined,
) {
	const anchorUserMessageId = meta?.anchorUserMessageId;
	return typeof anchorUserMessageId === "string" && anchorUserMessageId.trim()
		? anchorUserMessageId.trim()
		: null;
}

export function getPersistedRenderKey(message: MessageRecord): string {
	const meta = message.meta as Record<string, unknown> | null | undefined;
	const clientMessageId = getClientMessageId(meta);
	const anchorUserMessageId = getAnchorUserMessageId(meta);
	const messageKind =
		typeof meta?.messageKind === "string" ? meta.messageKind : null;

	if (message.role === "user" && clientMessageId) {
		return `user:${clientMessageId}`;
	}

	if (
		message.role === "assistant" &&
		messageKind === "assistant_final" &&
		anchorUserMessageId
	) {
		return `assistant-final:${anchorUserMessageId}`;
	}

	return `persisted:${message.id}`;
}

export function getStreamingRenderKey(
	anchorUserMessageId: string | null,
	sessionId: string,
) {
	return anchorUserMessageId?.trim()
		? `assistant-final:${anchorUserMessageId.trim()}`
		: `assistant-streaming:${sessionId}`;
}

function toChatMessage(message: MessageRecord, renderKey: string): ChatMessage {
	const msgMeta = message.meta as Record<string, unknown> | null | undefined;
	return {
		id: renderKey,
		role: message.role,
		content: message.content,
		text: message.text ?? "",
		sequence: message.sequence,
		blocks: [...(message.content ?? [])],
		authorUuid: (msgMeta?.authorUuid as string | undefined) ?? null,
		authorName: (msgMeta?.authorName as string | undefined) ?? null,
		authorAvatar: (msgMeta?.authorAvatar as string | undefined) ?? null,
		meta:
			message.role === "assistant"
				? {
						messageKind: msgMeta?.messageKind as string | null,
						model: message.model,
						provider: message.provider,
						usageInput: message.usageInput,
						usageOutput: message.usageOutput,
						costTotal: message.costTotal,
					}
				: {
						messageKind: msgMeta?.messageKind as string | null,
					},
	} satisfies ChatMessage;
}

function buildPendingMessage(
	sessionId: string,
	pending: PendingSessionMessage,
	fallbackSequence: number,
): MessageRecord {
	const pendingText =
		pending.status === "failed"
			? `${pending.text}\n\n（发送失败）`
			: pending.text;
	const stableSequence =
		typeof pending.sequenceHint === "number"
			? pending.sequenceHint
			: fallbackSequence;

	return {
		id: `pending-${pending.clientMessageId}`,
		sessionId,
		role: "user",
		content: pending.content,
		text: pendingText,
		sequence: stableSequence,
		provider: null,
		model: null,
		stopReason: null,
		errorMessage:
			pending.status === "failed"
				? (pending.error ?? "Failed to send message")
				: null,
		usageInput: null,
		usageOutput: null,
		costTotal: null,
		meta: {
			messageKind: "user_pending",
			clientMessageId: pending.clientMessageId,
			pendingStatus: pending.status,
		},
		createdAt: pending.createdAt,
	};
}

export function buildRenderableChatMessages(
	persisted: MessageRecord[],
	pending: PendingSessionMessage[],
): ChatMessage[] {
	const entries = new Map<string, ChatMessage>();
	const persistedClientMessageIds = new Set(
		persisted
			.map((message) =>
				getClientMessageId(
					message.meta as Record<string, unknown> | null | undefined,
				),
			)
			.filter((value): value is string => Boolean(value)),
	);

	for (const message of persisted) {
		const renderKey = getPersistedRenderKey(message);
		entries.set(renderKey, toChatMessage(message, renderKey));
	}

	let nextSequence = (persisted.at(-1)?.sequence ?? 0) + 1;
	for (const pendingMessage of pending) {
		if (persistedClientMessageIds.has(pendingMessage.clientMessageId)) continue;
		const renderable = buildPendingMessage(
			pendingMessage.sessionId,
			pendingMessage,
			nextSequence++,
		);
		const renderKey = `user:${pendingMessage.clientMessageId}`;
		entries.set(renderKey, toChatMessage(renderable, renderKey));
	}

	return Array.from(entries.values()).sort((a, b) => a.sequence - b.sequence);
}

export function buildStreamingPreviewBlocks(
	streamingContentBlocks: ContentBlock[],
	options?: { truncatedStart?: boolean },
): ContentBlock[] {
	let accText = "";
	let accThinking = "";

	for (const block of streamingContentBlocks) {
		if (block.type === "thinking") {
			accThinking += (accThinking ? "\n" : "") + block.thinking;
		} else if (block.type === "text") {
			accText += (accText ? "\n\n" : "") + block.text;
		}
	}

	const trimmedText = accText.trim();
	const trimmedThinking = accThinking.trim();
	if (!trimmedText && !trimmedThinking) return [];

	const blocks: ContentBlock[] = [];
	if (trimmedThinking)
		blocks.push({ type: "thinking", thinking: trimmedThinking });
	if (trimmedText) {
		blocks.push({
			type: "text",
			text: options?.truncatedStart ? `…${trimmedText}` : trimmedText,
		});
	}
	return blocks;
}

function isIntermediate(message: ChatMessage) {
	if (message.meta?.messageKind === "assistant_intermediate") return true;
	return message.content?.some((block) => block.type === "tool_use") ?? false;
}

function groupIntermediateMessages(parts: TimelineItem[]) {
	const result: TimelineItem[] = [];
	let buffer: ChatMessage[] = [];
	const flush = () => {
		if (buffer.length === 0) return;
		result.push({
			id: `process-${buffer.map((message) => message.id).join("|")}`,
			kind: "process",
			messages: [...buffer],
		});
		buffer = [];
	};

	for (const item of parts) {
		if (item.kind !== "message") {
			flush();
			result.push(item);
			continue;
		}
		const message = item.message;
		if (message.role !== "assistant" || !isIntermediate(message)) {
			flush();
			result.push(item);
		} else {
			buffer.push(message);
		}
	}

	flush();
	return result;
}

export function buildTimelineItems(input: {
	messages: ChatMessage[];
	streaming?: {
		sessionId: string;
		anchorUserMessageId?: string | null;
		contentBlocks: ContentBlock[];
		truncatedStart?: boolean;
	} | null;
}): TimelineItem[] {
	const items: TimelineItem[] = input.messages
		.filter((message) => message.meta?.messageKind !== "assistant_error")
		.map((message) => ({ id: message.id, kind: "message", message }));

	const lastUserIndex = (() => {
		for (let index = items.length - 1; index >= 0; index -= 1) {
			const item = items[index];
			if (item?.kind === "message" && item.message.role === "user")
				return index;
		}
		return -1;
	})();

	if (lastUserIndex < 0) return items;

	const historyItems = items.slice(0, lastUserIndex + 1);
	const groupedHistory = groupIntermediateMessages(historyItems);
	const currentItems = items.slice(lastUserIndex + 1);

	// Group intermediate messages in the current turn into process cards,
	// so that only non-intermediate items (e.g. streaming preview) are visible.
	{
		let buffer: TimelineItem[] = [];
		const flush = () => {
			if (buffer.length === 0) return;
			const grouped = groupIntermediateMessages(buffer);
			for (const item of grouped) groupedHistory.push(item);
			buffer = [];
		};
		for (const item of currentItems) {
			if (
				item.kind === "message" &&
				item.message.role === "assistant" &&
				isIntermediate(item.message)
			) {
				buffer.push(item);
			} else {
				flush();
				groupedHistory.push(item);
			}
		}
		flush();
	}

	const streamingBlocks = input.streaming?.contentBlocks ?? [];
	if (streamingBlocks.length > 0) {
		const renderKey = getStreamingRenderKey(
			input.streaming?.anchorUserMessageId ?? null,
			input.streaming?.sessionId ?? "active",
		);
		const alreadyRendered = groupedHistory.some(
			(item) =>
				(item.kind === "message" && item.message.id === renderKey) ||
				(item.kind === "process" &&
					item.messages.some((m) => m.id === renderKey)),
		);

		if (!alreadyRendered) {
			const previewBlocks = buildStreamingPreviewBlocks(streamingBlocks, {
				truncatedStart: input.streaming?.truncatedStart,
			});
			if (previewBlocks.length > 0) {
				const previewText =
					previewBlocks.find((block) => block.type === "text")?.text?.trim() ??
					"";
				groupedHistory.push({
					id: renderKey,
					kind: "message",
					message: {
						id: renderKey,
						role: "assistant",
						content: previewBlocks,
						text: previewText,
						sequence: (input.messages.at(-1)?.sequence ?? 0) + 1,
					},
				});
			}
		}
	}

	const result = groupIntermediateMessages(groupedHistory);

	// Safety: deduplicate by ID to guard against any edge-case collisions.
	const seen = new Set<string>();
	return result.filter((item) => {
		if (seen.has(item.id)) return false;
		seen.add(item.id);
		return true;
	});
}
