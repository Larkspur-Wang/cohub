import type {
	MessageToolCallsFile,
	StoredIntermediateMessage,
	TurnIntermediateMessagesFile,
} from "@neta-art/cohub-protocol/model";
import { sdk } from "$lib/sdk";

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url);
	if (!response.ok)
		throw new Error(`Failed to fetch turn object ${response.status}`);
	return response.json() as Promise<T>;
}

export async function loadTurnIntermediate(input: {
	spaceId: string;
	sessionId: string;
	turnId: string;
	messagesObjectKey: string | null;
}): Promise<StoredIntermediateMessage[]> {
	if (!input.messagesObjectKey) return [];
	const { urls } = await sdk
		.space(input.spaceId)
		.session(input.sessionId)
		.turns.signedUrls(input.turnId, [input.messagesObjectKey]);
	const url = urls[input.messagesObjectKey];
	if (!url) throw new Error("Missing signed URL for intermediate messages");
	const file = await fetchJson<TurnIntermediateMessagesFile>(url);
	return file.messages;
}

export async function loadMessageToolCalls(input: {
	spaceId: string;
	sessionId: string;
	turnId: string;
	message: StoredIntermediateMessage;
}): Promise<MessageToolCallsFile | null> {
	if (!input.message.toolCallsObjectKey) return null;
	const { urls } = await sdk
		.space(input.spaceId)
		.session(input.sessionId)
		.turns.signedUrls(input.turnId, [input.message.toolCallsObjectKey]);
	const url = urls[input.message.toolCallsObjectKey];
	if (!url) throw new Error("Missing signed URL for tool calls");
	return fetchJson<MessageToolCallsFile>(url);
}
