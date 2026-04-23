import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { MessageRecord } from "@neta-art/cohub-protocol/model";

export type ChatMessage = {
	id: string;
	role: "user" | "assistant" | "system";
	content: ContentBlock[];
	text: string;
	sequence: number;
	blocks?: ContentBlock[];
	authorUuid?: string | null;
	authorName?: string | null;
	authorAvatar?: string | null;
	createdAt: string;
	meta?: {
		messageKind?: string | null;
		model?: string | null;
		provider?: string | null;
		usage?: MessageRecord["usage"];
	};
};

export type ToolState = {
	id: string;
	name: string;
	input?: Record<string, unknown>;
	status: "running" | "done" | "failed";
	output: string;
};

export type TimelineItem =
	| {
			id: string;
			kind: "message";
			message: ChatMessage;
	  }
	| {
			id: string;
			kind: "tool";
			tool: ToolState;
	  }
	| {
			id: string;
			kind: "process";
			messages: ChatMessage[];
	  };

export const stringifyUnknown = (value: unknown) => {
	if (typeof value === "string") {
		return value;
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
};

export const renderToolPreview = (
	name: string,
	input?: Record<string, unknown>,
) => {
	if (name === "bash" && typeof input?.command === "string") {
		return `$ ${input.command}`;
	}

	if (name === "read" && typeof input?.path === "string") {
		return `read ${input.path}`;
	}

	if (name === "find" && typeof input?.pattern === "string") {
		return `find ${input.pattern}`;
	}

	if (name === "grep" && typeof input?.pattern === "string") {
		return `grep ${input.pattern}`;
	}

	if (name === "write" && typeof input?.path === "string") {
		return `write ${input.path}`;
	}

	if (name === "edit" && typeof input?.path === "string") {
		return `edit ${input.path}`;
	}

	return stringifyUnknown(input ?? {});
};

export const toChatMessages = (messages: MessageRecord[]): ChatMessage[] => {
	return messages.map((message) => {
		const msgMeta = message.meta as Record<string, unknown> | null | undefined;
		return {
			id: message.id,
			role: message.role,
			content: message.content,
			text: message.text ?? "",
			sequence: message.sequence,
			blocks: [...(message.content ?? [])],
			authorUuid: (msgMeta?.authorUuid as string | undefined) ?? null,
			authorName: (msgMeta?.authorName as string | undefined) ?? null,
			authorAvatar: (msgMeta?.authorAvatar as string | undefined) ?? null,
			createdAt: message.createdAt,
			meta:
				message.role === "assistant"
					? {
							messageKind: msgMeta?.messageKind as string | null,
							model: message.model,
							provider: message.provider,
							usage: message.usage,
						}
					: undefined,
		} satisfies ChatMessage;
	});
};
